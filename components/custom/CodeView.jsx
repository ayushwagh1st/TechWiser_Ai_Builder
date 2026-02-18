"use client"
import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Lookup from '@/data/Lookup';
import { MessagesContext } from '@/context/MessagesContext';
import Prompt from '@/data/Prompt';
import { useConvex, useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import { Loader2Icon, Download, Rocket, Sparkles, Code, Eye, RefreshCw } from 'lucide-react';
import JSZip from 'jszip';
import { useSandpack } from "@codesandbox/sandpack-react";
import ErrorBoundary from './ErrorBoundary';

// --- Constants ---
const MAX_CLIENT_RETRIES = 3;             // Auto-retry up to 3 times on client side
const CLIENT_RETRY_DELAYS = [2000, 4000, 6000]; // Progressive backoff
const INACTIVITY_MS = 180_000;            // 3 min inactivity timeout
const ABSOLUTE_TIMEOUT_MS = 600_000;      // 10 min absolute max

/** Sanitize error messages so internal details are never shown to users */
function friendlyError(raw) {
    if (!raw || typeof raw !== 'string') return 'Something went wrong. Please try again.';
    const l = raw.toLowerCase();
    if (l.includes('busy') || l.includes('rate') || l.includes('429') || l.includes('temporarily')) return 'Our AI servers are busy right now. Please wait a moment and try again.';
    if (l.includes('timeout') || l.includes('timed out') || l.includes('function timed out')) return 'The request took too long. Please try again or simplify your prompt.';
    if (l.includes('network') || l.includes('connection') || l.includes('fetch')) return 'Network error — please check your connection and try again.';
    if (l.includes('malformed') || l.includes('parse') || l.includes('json')) return 'The AI response was malformed. Please try again.';
    if (l.includes('please') && !l.includes('http') && !l.includes('api') && !l.includes('key')) return raw;
    return 'Something went wrong. Please try again.';
}

const SandpackProvider = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackProvider), { ssr: false });
const SandpackLayout = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackLayout), { ssr: false });
const SandpackCodeEditor = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackCodeEditor), { ssr: false });
const SandpackPreview = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackPreview), { ssr: false });
const SandpackFileExplorer = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackFileExplorer), { ssr: false });

function CodeView() {
    const { id } = useParams();
    const [activeTab, setActiveTab] = useState('code');
    const [files, setFiles] = useState(Lookup?.DEFAULT_FILE);
    const { messages, setMessages, setPreviewError, buildOptions } = useContext(MessagesContext);
    const UpdateFiles = useMutation(api.workspace.UpdateFiles);
    const convex = useConvex();
    const [loading, setLoading] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [loadingStatus, setLoadingStatus] = useState('Writing code & config...');
    const elapsedRef = useRef(null);
    const retryCountRef = useRef(0); // Track which client retry we're on

    // Elapsed time counter for loading overlay
    useEffect(() => {
        if (loading) {
            setElapsedTime(0);
            elapsedRef.current = setInterval(() => setElapsedTime(t => t + 1), 1000);
        } else {
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            setElapsedTime(0);
            setLoadingStatus('Writing code & config...');
        }
        return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
    }, [loading]);

    const preprocessFiles = useCallback((files) => {
        const processed = {};
        Object.entries(files).forEach(([path, content]) => {
            let normalizedPath = path;
            if (normalizedPath.startsWith('/src/')) {
                normalizedPath = '/' + normalizedPath.slice(5);
            } else if (normalizedPath.startsWith('src/')) {
                normalizedPath = '/' + normalizedPath.slice(4);
            }
            if (!normalizedPath.startsWith('/')) {
                normalizedPath = '/' + normalizedPath;
            }

            if (typeof content === 'string') {
                processed[normalizedPath] = { code: content };
            } else if (content && typeof content === 'object') {
                if (!content.code && typeof content === 'object') {
                    processed[normalizedPath] = { code: JSON.stringify(content, null, 2) };
                } else {
                    processed[normalizedPath] = content;
                }
            }
        });
        return processed;
    }, []);

    const GetFiles = useCallback(async () => {
        const result = await convex.query(api.workspace.GetWorkspace, {
            workspaceId: id
        });
        const processedFiles = preprocessFiles(result?.fileData || {});
        const mergedFiles = { ...Lookup.DEFAULT_FILE, ...processedFiles };
        setFiles(mergedFiles);
    }, [id, convex, preprocessFiles]);

    useEffect(() => {
        id && GetFiles();
    }, [id, GetFiles]);

    /**
     * Core function: makes a single API call to /api/gen-ai-code and processes the SSE stream.
     * Returns { success: true, data } or { success: false, error }.
     */
    const callCodeGenAPI = useCallback(async (msgs, currentFilePaths, signal) => {
        const response = await fetch('/api/gen-ai-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                messages: msgs,
                currentFilePaths: currentFilePaths.length > 0 ? currentFilePaths : undefined,
                includeSupabase: buildOptions?.includeSupabase,
                deployToVercel: buildOptions?.deployToVercel,
            }),
        });

        // Detect server-side failures (Vercel timeout = 504, gateway errors)
        if (!response.ok) {
            const statusCode = response.status;
            if (statusCode === 502 || statusCode === 504) {
                return { success: false, error: 'Server function timed out. Retrying...', retryable: true };
            }
            return { success: false, error: `Server error (${statusCode})`, retryable: statusCode >= 500 };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let finalData = null;
        let streamError = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        // Keepalive ping — ignore
                        if (data.ping) continue;

                        // Retry progress from server
                        if (data.retry && data.maxRetries) {
                            setLoadingStatus(`AI model retry ${data.retry}/${data.maxRetries}...`);
                        }

                        // Progress update
                        if (data.progress) {
                            setLoadingStatus(`Generating code (${Math.round(data.progress / 1024)}KB received)...`);
                        }

                        // Final result
                        if (data.done && data.final) {
                            finalData = data.final;
                        }

                        // Server-side error
                        if (data.error) {
                            streamError = data.rawError || data.error;
                        }
                    } catch (_) { }
                }
            }
        }

        if (finalData?.files) {
            return { success: true, data: finalData };
        }

        return {
            success: false,
            error: streamError || 'No valid code received from AI',
            retryable: true,
        };
    }, [buildOptions]);

    /**
     * Main code generation function with client-side auto-retry.
     */
    const GenerateAiCode = useCallback(async () => {
        setLoading(true);
        setLoadingStatus('Writing code & config...');
        retryCountRef.current = 0;

        const currentFilePaths = Object.keys(files || {}).filter(k => k.startsWith('/'));
        const controller = new AbortController();
        const absoluteTimeout = setTimeout(() => controller.abort(), ABSOLUTE_TIMEOUT_MS);

        let success = false;

        try {
            for (let clientAttempt = 0; clientAttempt < MAX_CLIENT_RETRIES; clientAttempt++) {
                retryCountRef.current = clientAttempt;

                if (clientAttempt > 0) {
                    const delay = CLIENT_RETRY_DELAYS[clientAttempt - 1] || 5000;
                    setLoadingStatus(`Retrying (attempt ${clientAttempt + 1}/${MAX_CLIENT_RETRIES})...`);
                    await new Promise(r => setTimeout(r, delay));
                }

                try {
                    const result = await callCodeGenAPI(messages, currentFilePaths, controller.signal);

                    if (result.success) {
                        // SUCCESS — apply files
                        const processedAiFiles = preprocessFiles(result.data.files || {});
                        const mergedFiles = { ...Lookup.DEFAULT_FILE, ...processedAiFiles };
                        setFiles(mergedFiles);

                        await UpdateFiles({
                            workspaceId: id,
                            files: result.data.files
                        });

                        setActiveTab('preview');
                        success = true;
                        console.log(`[CodeView] ✓ Code generation succeeded on client attempt ${clientAttempt + 1}`);
                        break;
                    } else {
                        // FAILED — check if retryable
                        console.warn(`[CodeView] Attempt ${clientAttempt + 1} failed: ${result.error}`);

                        if (!result.retryable || clientAttempt === MAX_CLIENT_RETRIES - 1) {
                            // Non-retryable or last attempt — show error
                            setMessages(prev => [...prev, {
                                role: 'ai',
                                content: `⚠️ ${friendlyError(result.error)}`
                            }]);
                            break;
                        }
                        // Otherwise loop continues to retry
                    }
                } catch (fetchError) {
                    if (fetchError.name === 'AbortError') {
                        // Absolute timeout hit
                        setMessages(prev => [...prev, {
                            role: 'ai',
                            content: '⚠️ The request took too long. Please try again or simplify your prompt.'
                        }]);
                        break;
                    }

                    console.warn(`[CodeView] Attempt ${clientAttempt + 1} fetch error:`, fetchError.message);

                    if (clientAttempt === MAX_CLIENT_RETRIES - 1) {
                        setMessages(prev => [...prev, {
                            role: 'ai',
                            content: `⚠️ ${friendlyError(fetchError.message)}`
                        }]);
                    }
                    // Otherwise loop continues to retry
                }
            }

            if (!success) {
                console.error(`[CodeView] All ${MAX_CLIENT_RETRIES} client attempts failed`);
            }
        } finally {
            clearTimeout(absoluteTimeout);
            setLoading(false);
        }
    }, [messages, id, UpdateFiles, preprocessFiles, files, buildOptions, setMessages, callCodeGenAPI]);

    useEffect(() => {
        if (messages?.length > 0) {
            const role = messages[messages?.length - 1].role;
            if (role === 'user') {
                GenerateAiCode();
            }
        }
    }, [messages, GenerateAiCode]);

    const downloadFiles = useCallback(async () => {
        try {
            const zip = new JSZip();

            Object.entries(files).forEach(([filename, content]) => {
                let fileContent;
                if (typeof content === 'string') {
                    fileContent = content;
                } else if (content && typeof content === 'object') {
                    if (content.code) {
                        fileContent = content.code;
                    } else {
                        fileContent = JSON.stringify(content, null, 2);
                    }
                }

                if (fileContent) {
                    const cleanFileName = filename.startsWith('/') ? filename.slice(1) : filename;
                    zip.file(cleanFileName, fileContent);
                }
            });

            const packageJson = {
                name: "generated-project",
                version: "1.0.0",
                private: true,
                dependencies: Lookup.DEPENDANCY,
                scripts: {
                    "dev": "vite",
                    "build": "vite build",
                    "preview": "vite preview"
                }
            };
            zip.file("package.json", JSON.stringify(packageJson, null, 2));

            const blob = await zip.generateAsync({ type: "blob" });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'project-files.zip';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading files:', error);
        }
    }, [files]);

    const deployToVercel = useCallback(async () => {
        setDeploying(true);
        try {
            const filePayload = {};
            Object.entries(files || {}).forEach(([path, content]) => {
                let code;
                if (typeof content === 'string') code = content;
                else if (content?.code) code = content.code;
                else code = JSON.stringify(content, null, 2);
                filePayload[path.replace(/^\//, '')] = code;
            });
            const res = await fetch('/api/deploy-vercel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: filePayload }),
            });
            const data = await res.json();
            if (data.url) window.open(data.url, '_blank');
            else if (data.error) alert(data.error);
        } catch (e) {
            alert('Deploy failed: ' + (e.message || 'Unknown error'));
        } finally {
            setDeploying(false);
        }
    }, [files]);

    const SandpackLoadingOverlay = () => {
        const { sandpack } = useSandpack();
        const { status } = sandpack;
        const [show, setShow] = useState(true);

        useEffect(() => {
            if (status === 'running' || status === 'done') {
                const timer = setTimeout(() => setShow(false), 500);
                return () => clearTimeout(timer);
            } else {
                setShow(true);
            }
        }, [status]);

        if (!show) return null;

        return (
            <div className="absolute inset-0 z-40 bg-[#0a0a0a] flex flex-col items-center justify-center animate-out fade-out duration-500">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-violet-500/20 blur-xl rounded-full animate-pulse" />
                        <Loader2Icon className="relative h-8 w-8 text-violet-400 animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-zinc-400 animate-pulse">Initializing Preview...</p>
                </div>
            </div>
        );
    };

    const SandpackErrorListener = () => {
        const { sandpack } = useSandpack();
        const [errorMsg, setErrorMsg] = useState(null);

        useEffect(() => {
            if (sandpack?.error) {
                const err = sandpack.error;
                const message = typeof err === "string" ? err : (err?.message || err?.title || JSON.stringify(err));
                setErrorMsg(message);
                setPreviewError(message);
            } else {
                setErrorMsg(null);
                setPreviewError(null);
            }
        }, [sandpack?.error, setPreviewError]);

        if (!errorMsg) return null;

        return (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="glass-strong rounded-2xl border border-red-500/20 bg-[#0a0a0a]/90 p-5 lg:p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
                    <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20 shadow-inner shrink-0">
                            <Rocket className="h-6 w-6 text-red-500 rotate-180" />
                        </div>

                        <div>
                            <h3 className="text-lg font-semibold text-white mb-1">Runtime Error Detected</h3>
                            <p className="text-sm text-zinc-400">The app crashed while running.</p>
                        </div>

                        <div className="w-full bg-red-950/30 rounded-lg p-3 border border-red-500/10 text-left relative overflow-hidden group">
                            <code className="text-xs font-mono text-red-200 block max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                                {errorMsg}
                            </code>
                        </div>

                        <div className="flex w-full gap-3 mt-2">
                            <button
                                onClick={() => {
                                    setMessages(prev => [...prev, {
                                        role: 'user',
                                        content: `The app has a runtime error:\n\n${errorMsg}\n\nPlease fix this code.`
                                    }]);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white px-4 py-3 rounded-xl transition-all font-medium shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98] min-h-[48px]"
                            >
                                <Sparkles className="h-4 w-4" />
                                Fix with AI
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const PreviewWithErrorHandler = () => (
        <SandpackPreview
            style={{ height: '100%' }}
            showNavigator={true}
            showOpenInCodeSandbox={false}
            showRefreshButton={true}
        />
    );

    return (
        <div className='relative h-full bg-[#0a0a0a] border-0 lg:border border-white/[0.06] rounded-none lg:rounded-2xl overflow-hidden flex flex-col'>
            {/* Header with tabs and actions */}
            <div className='flex items-center justify-between px-2 lg:px-4 py-2 lg:py-2.5 border-b border-white/[0.06]'>
                {/* Pill Tab Switcher */}
                <div className='flex items-center gap-0.5 p-1 rounded-xl glass'>
                    <button
                        onClick={() => setActiveTab('code')}
                        className={`flex items-center gap-1.5 px-3 lg:px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 min-h-[40px] ${activeTab === 'code'
                            ? 'bg-white/[0.1] text-white shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        <Code className="h-4 w-4" />
                        <span>Code</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`flex items-center gap-1.5 px-3 lg:px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 min-h-[40px] ${activeTab === 'preview'
                            ? 'bg-white/[0.1] text-white shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        <Eye className="h-4 w-4" />
                        <span>Preview</span>
                    </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 lg:gap-2">
                    <button
                        onClick={downloadFiles}
                        className="flex items-center gap-1.5 text-zinc-500 hover:text-white px-2 lg:px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-all text-[13px] font-medium min-h-[40px] min-w-[40px] justify-center"
                        title="Download Project"
                    >
                        <Download className="h-4 w-4" />
                        <span className="hidden lg:inline">Export</span>
                    </button>
                    <button
                        onClick={deployToVercel}
                        disabled={deploying}
                        className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white px-3 lg:px-3.5 py-2 rounded-lg transition-all shadow-lg shadow-violet-600/20 text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] active:scale-95"
                    >
                        {deploying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                        <span className="hidden lg:inline">Deploy</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                <SandpackProvider
                    files={files}
                    template="react"
                    theme={'dark'}
                    customSetup={{
                        dependencies: {
                            ...Lookup.DEPENDANCY
                        },
                        entry: '/index.js'
                    }}
                    options={{
                        externalResources: ['https://cdn.tailwindcss.com'],
                        bundlerTimeoutSecs: 120,
                        recompileMode: "delayed",
                        recompileDelay: 500
                    }}
                >
                    <SandpackErrorListener />
                    <SandpackLayout style={{ height: '100%', border: 'none', borderRadius: 0 }}>
                        <div className={`h-full w-full ${activeTab === 'code' ? 'flex' : 'hidden'}`}>
                            <div className="hidden lg:block">
                                <SandpackFileExplorer style={{ height: '100%', borderRight: '1px solid rgba(255,255,255,0.06)' }} />
                            </div>
                            <SandpackCodeEditor
                                style={{ height: '100%' }}
                                showTabs
                                showLineNumbers
                                showInlineErrors
                                wrapContent
                                closableTabs
                            />
                        </div>
                        <div className={`h-full w-full ${activeTab === 'preview' ? 'flex' : 'hidden'} relative`}>
                            <ErrorBoundary>
                                <SandpackLoadingOverlay />
                                <PreviewWithErrorHandler />
                                {messages?.length > 0 && (
                                    <div className="absolute bottom-4 right-4 z-50">
                                        <SandpackErrorListener />
                                    </div>
                                )}
                            </ErrorBoundary>
                        </div>
                    </SandpackLayout>
                </SandpackProvider>

                {/* Loading Overlay */}
                {loading && (
                    <div className='absolute inset-0 bg-[#0a0a0a]/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-in fade-in duration-300'>
                        <div className="glass-strong p-6 lg:p-8 rounded-2xl flex flex-col items-center gap-4 lg:gap-5 text-center max-w-sm mx-4">
                            <div className="relative">
                                <div className="absolute inset-0 bg-violet-500 blur-2xl opacity-20 rounded-full" />
                                <Loader2Icon className='relative animate-spin h-8 lg:h-10 w-8 lg:w-10 text-violet-400' />
                            </div>
                            <div>
                                <h2 className='text-base font-semibold text-white mb-1'>Building your app</h2>
                                <p className="text-sm text-zinc-500">{loadingStatus}</p>
                                <p className="text-xs text-zinc-600 mt-1 tabular-nums">
                                    {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')} elapsed
                                </p>
                                {retryCountRef.current > 0 && (
                                    <p className="text-xs text-amber-500/80 mt-1.5 flex items-center justify-center gap-1">
                                        <RefreshCw className="h-3 w-3" />
                                        Auto-retrying ({retryCountRef.current + 1}/{MAX_CLIENT_RETRIES})
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CodeView;
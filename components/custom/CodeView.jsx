"use client"
import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Lookup from '@/data/Lookup';
import { MessagesContext } from '@/context/MessagesContext';
import Prompt from '@/data/Prompt';
import { useConvex, useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import { Loader2Icon, Download, Rocket, Sparkles, Code, Eye } from 'lucide-react';
import JSZip from 'jszip';
import { useSandpack } from "@codesandbox/sandpack-react";
import ErrorBoundary from './ErrorBoundary';

/** Sanitize error messages so internal details are never shown to users */
function friendlyError(raw) {
    if (!raw || typeof raw !== 'string') return 'Something went wrong. Please try again.';
    const l = raw.toLowerCase();
    if (l.includes('busy') || l.includes('rate') || l.includes('429') || l.includes('temporarily')) return 'Our AI servers are busy right now. Please wait a moment and try again.';
    if (l.includes('timeout') || l.includes('timed out') || l.includes('90 seconds')) return 'The request took too long. Please try again or simplify your prompt.';
    if (l.includes('network') || l.includes('connection')) return 'Network error — please check your connection and try again.';
    if (l.includes('malformed') || l.includes('parse') || l.includes('json')) return 'The AI response was malformed. Please try again.';
    // If the server already sanitized it, pass through; otherwise use generic
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
    const elapsedRef = useRef(null);

    // Elapsed time counter for loading overlay
    useEffect(() => {
        if (loading) {
            setElapsedTime(0);
            elapsedRef.current = setInterval(() => setElapsedTime(t => t + 1), 1000);
        } else {
            if (elapsedRef.current) clearInterval(elapsedRef.current);
            setElapsedTime(0);
        }
        return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
    }, [loading]);

    const preprocessFiles = useCallback((files) => {
        const processed = {};
        Object.entries(files).forEach(([path, content]) => {
            if (typeof content === 'string') {
                processed[path] = { code: content };
            } else if (content && typeof content === 'object') {
                if (!content.code && typeof content === 'object') {
                    processed[path] = { code: JSON.stringify(content, null, 2) };
                } else {
                    processed[path] = content;
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

    const GenerateAiCode = useCallback(async () => {
        setLoading(true);
        const currentFilePaths = Object.keys(files || {}).filter(k => k.startsWith('/'));

        const controller = new AbortController();
        // Absolute max timeout: 10 minutes (safety net)
        const absoluteTimeout = setTimeout(() => controller.abort(), 600_000);
        // Inactivity timeout: abort if no data received for 180 seconds (3 mins)
        const INACTIVITY_MS = 180_000;
        let inactivityTimeout = setTimeout(() => controller.abort(), INACTIVITY_MS);
        const resetInactivity = () => {
            clearTimeout(inactivityTimeout);
            inactivityTimeout = setTimeout(() => controller.abort(), INACTIVITY_MS);
        };

        try {
            const response = await fetch('/api/gen-ai-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
                body: JSON.stringify({
                    messages,
                    currentFilePaths: currentFilePaths.length > 0 ? currentFilePaths : undefined,
                    includeSupabase: buildOptions?.includeSupabase,
                    deployToVercel: buildOptions?.deployToVercel,
                }),
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let finalData = null;
            let streamError = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Data received — reset inactivity timer
                resetInactivity();

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.done && data.final) {
                                finalData = data.final;
                            }
                            if (data.error) {
                                streamError = data.rawError || data.error;
                                console.warn('AI code gen error:', data.error, 'Raw:', data.rawError);
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }

            if (finalData && finalData.files) {
                const processedAiFiles = preprocessFiles(finalData.files || {});
                const mergedFiles = { ...Lookup.DEFAULT_FILE, ...processedAiFiles };
                setFiles(mergedFiles);

                await UpdateFiles({
                    workspaceId: id,
                    files: finalData.files
                });

                setActiveTab('preview');
            } else {
                console.error('Code generation failed:', streamError || 'No valid files received');
                setMessages(prev => [...prev, {
                    role: 'ai',
                    content: `⚠️ ${friendlyError(streamError)}` + (streamError ? `\n\n**Debug Details:**\n\`${streamError}\`` : '')
                }]);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Code generation timed out (inactivity or absolute limit)');
                setMessages(prev => [...prev, {
                    role: 'ai',
                    content: '⚠️ The request took too long. Please try again or simplify your prompt.'
                }]);
            } else {
                console.error('Error generating AI code:', error);
            }
        } finally {
            clearTimeout(absoluteTimeout);
            clearTimeout(inactivityTimeout);
            setLoading(false);
        }
    }, [messages, id, UpdateFiles, preprocessFiles, files, buildOptions, setMessages]);

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
                // Add a small delay to ensure the iframe has actually painted
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
                <div className="glass-strong rounded-2xl border border-red-500/20 bg-[#0a0a0a]/90 p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
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
                            {/* Add a dismiss/retry button if needed, but 'Fix with AI' is the main action */}
                            <button
                                onClick={() => {
                                    setMessages(prev => [...prev, {
                                        role: 'user',
                                        content: `The app has a runtime error:\n\n${errorMsg}\n\nPlease fix this code.`
                                    }]);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white px-4 py-2.5 rounded-xl transition-all font-medium shadow-lg shadow-red-600/20 hover:scale-[1.02] active:scale-[0.98]"
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
            style={{ height: '80vh' }}
            showNavigator={true}
            showOpenInCodeSandbox={false}
            showRefreshButton={true}
        />
    );

    return (
        <div className='relative h-full bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden flex flex-col'>
            {/* Header with tabs and actions */}
            <div className='flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-white/[0.06]'>
                {/* Pill Tab Switcher */}
                <div className='flex items-center gap-0.5 p-1 rounded-xl glass'>
                    <button
                        onClick={() => setActiveTab('code')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${activeTab === 'code'
                            ? 'bg-white/[0.1] text-white shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        <Code className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Code</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('preview')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${activeTab === 'preview'
                            ? 'bg-white/[0.1] text-white shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                    >
                        <Eye className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Preview</span>
                    </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={downloadFiles}
                        className="flex items-center gap-1.5 text-zinc-500 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] transition-all text-[13px] font-medium"
                        title="Download Project"
                    >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <button
                        onClick={deployToVercel}
                        disabled={deploying}
                        className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white px-3.5 py-1.5 rounded-lg transition-all shadow-lg shadow-violet-600/20 text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {deploying ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                        <span className="hidden sm:inline">Deploy</span>
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
                            <div className="hidden sm:block">
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
                        <div className="glass-strong p-8 rounded-2xl flex flex-col items-center gap-5 text-center max-w-sm mx-4">
                            <div className="relative">
                                <div className="absolute inset-0 bg-violet-500 blur-2xl opacity-20 rounded-full" />
                                <Loader2Icon className='relative animate-spin h-10 w-10 text-violet-400' />
                            </div>
                            <div>
                                <h2 className='text-base font-semibold text-white mb-1'>Building your app</h2>
                                <p className="text-sm text-zinc-500">Writing code & config...</p>
                                <p className="text-xs text-zinc-600 mt-1 tabular-nums">
                                    {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')} elapsed
                                </p>
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
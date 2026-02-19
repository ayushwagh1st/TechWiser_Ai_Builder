"use client"
import React, { useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Lookup from '@/data/Lookup';
import { MessagesContext } from '@/context/MessagesContext';
import { useConvex, useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import { Loader2Icon, Download, Rocket, Sparkles, Code, Eye, RefreshCw, CheckCircle2, FileCode2 } from 'lucide-react';
import JSZip from 'jszip';
import { useSandpack } from "@codesandbox/sandpack-react";
import ErrorBoundary from './ErrorBoundary';

// --- Constants ---
const MAX_CLIENT_RETRIES = 3;
const CLIENT_RETRY_DELAYS = [3000, 5000, 8000];

const SandpackProvider = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackProvider), { ssr: false });
const SandpackLayout = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackLayout), { ssr: false });
const SandpackCodeEditor = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackCodeEditor), { ssr: false });
const SandpackPreview = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackPreview), { ssr: false });
const SandpackFileExplorer = dynamic(() => import("@codesandbox/sandpack-react").then(mod => mod.SandpackFileExplorer), { ssr: false });

function friendlyError(raw) {
    if (!raw || typeof raw !== 'string') return 'Something went wrong. Please try again.';
    const l = raw.toLowerCase();
    if (l.includes('busy') || l.includes('rate') || l.includes('429')) return 'AI servers are busy. Please wait a moment and try again.';
    if (l.includes('timeout') || l.includes('timed out')) return 'Request took too long. Please try again or simplify your prompt.';
    if (l.includes('network') || l.includes('connection')) return 'Network error — check your connection.';
    if (l.includes('please') && !l.includes('http')) return raw;
    return 'Something went wrong. Please try again.';
}

function CodeView() {
    const { id } = useParams();
    const [activeTab, setActiveTab] = useState('code');
    const [filesData, setFilesData] = useState(null);
    const { messages, setMessages, setPreviewError, buildOptions } = useContext(MessagesContext);
    const UpdateFiles = useMutation(api.workspace.UpdateFiles);
    const convex = useConvex();
    const [loading, setLoading] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [deploySuccess, setDeploySuccess] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const elapsedRef = useRef(null);

    // Phase-aware loading state
    const [genPhase, setGenPhase] = useState('idle');
    const [genStatus, setGenStatus] = useState('');
    const [genProgress, setGenProgress] = useState(0);
    const [genTotal, setGenTotal] = useState(0);
    const [genCurrentFile, setGenCurrentFile] = useState('');
    const [genPlan, setGenPlan] = useState([]);
    const [clientRetry, setClientRetry] = useState(0);

    // ── MEMOIZE files to prevent Sandpack re-mount blinking ──
    const files = useMemo(() => {
        return { ...Lookup.DEFAULT_FILE, ...(filesData || {}) };
    }, [filesData]);

    // Stable JSON key for SandpackProvider — only changes when file *paths* change
    const sandpackKey = useMemo(() => {
        return Object.keys(files).sort().join('|');
    }, [files]);

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

    const preprocessFiles = useCallback((rawFiles) => {
        const processed = {};
        Object.entries(rawFiles).forEach(([path, content]) => {
            let np = path;
            if (np.startsWith('/src/')) np = '/' + np.slice(5);
            else if (np.startsWith('src/')) np = '/' + np.slice(4);
            if (!np.startsWith('/')) np = '/' + np;
            if (typeof content === 'string') processed[np] = { code: content };
            else if (content && typeof content === 'object') {
                processed[np] = content.code ? content : { code: JSON.stringify(content, null, 2) };
            }
        });
        return processed;
    }, []);

    const GetFiles = useCallback(async () => {
        const result = await convex.query(api.workspace.GetWorkspace, { workspaceId: id });
        const processedFiles = preprocessFiles(result?.fileData || {});
        setFilesData(processedFiles);
    }, [id, convex, preprocessFiles]);

    useEffect(() => { id && GetFiles(); }, [id, GetFiles]);

    const processStream = useCallback(async (signal) => {
        const currentFilePaths = Object.keys(files || {}).filter(k => k.startsWith('/'));

        const response = await fetch('/api/gen-ai-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                messages,
                currentFilePaths: currentFilePaths.length > 0 ? currentFilePaths : undefined,
                includeSupabase: buildOptions?.includeSupabase,
                deployToVercel: buildOptions?.deployToVercel,
            }),
        });

        if (!response.ok) {
            const sc = response.status;
            return { success: false, error: `Server error (${sc})`, retryable: sc >= 500 };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let finalData = null;
        let streamError = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.ping) continue;
                    if (data.phase) {
                        setGenPhase(data.phase);
                        if (data.status) setGenStatus(data.status);
                        if (data.currentFile) setGenCurrentFile(data.currentFile);
                        if (data.progress !== undefined) setGenProgress(data.progress);
                        if (data.total !== undefined) setGenTotal(data.total);
                        if (data.plan) setGenPlan(data.plan);
                    }
                    if (data.done && data.final) finalData = data.final;
                    if (data.error) streamError = data.error;
                } catch (_) { }
            }
        }

        if (finalData?.files) return { success: true, data: finalData };
        return { success: false, error: streamError || 'No code received', retryable: true };
    }, [messages, buildOptions]);

    const GenerateAiCode = useCallback(async () => {
        setLoading(true);
        setGenPhase('planning');
        setGenStatus('Starting...');
        setGenProgress(0);
        setGenTotal(0);
        setGenCurrentFile('');
        setGenPlan([]);
        setClientRetry(0);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600_000);

        try {
            for (let attempt = 0; attempt < MAX_CLIENT_RETRIES; attempt++) {
                setClientRetry(attempt);

                if (attempt > 0) {
                    const delay = CLIENT_RETRY_DELAYS[attempt - 1] || 5000;
                    setGenPhase('planning');
                    setGenStatus(`Retrying (attempt ${attempt + 1}/${MAX_CLIENT_RETRIES})...`);
                    await new Promise(r => setTimeout(r, delay));
                }

                try {
                    const result = await processStream(controller.signal);

                    if (result.success) {
                        const processedAiFiles = preprocessFiles(result.data.files || {});
                        setFilesData(processedAiFiles);
                        await UpdateFiles({ workspaceId: id, files: result.data.files });
                        setActiveTab('preview');
                        setGenPhase('done');
                        setGenStatus('Done!');
                        break;
                    } else {
                        console.warn(`[CodeView] Attempt ${attempt + 1}: ${result.error}`);
                        if (!result.retryable || attempt === MAX_CLIENT_RETRIES - 1) {
                            setMessages(prev => [...prev, { role: 'ai', content: `⚠️ ${friendlyError(result.error)}` }]);
                            break;
                        }
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        setMessages(prev => [...prev, { role: 'ai', content: '⚠️ Request took too long. Please try a simpler prompt.' }]);
                        break;
                    }
                    if (attempt === MAX_CLIENT_RETRIES - 1) {
                        setMessages(prev => [...prev, { role: 'ai', content: `⚠️ ${friendlyError(e.message)}` }]);
                    }
                }
            }
        } finally {
            clearTimeout(timeout);
            setLoading(false);
            setGenPhase('idle');
        }
    }, [messages, id, UpdateFiles, preprocessFiles, buildOptions, setMessages, processStream]);

    useEffect(() => {
        if (messages?.length > 0 && messages[messages.length - 1].role === 'user') {
            GenerateAiCode();
        }
    }, [messages, GenerateAiCode]);

    const downloadFiles = useCallback(async () => {
        try {
            const zip = new JSZip();
            Object.entries(files).forEach(([filename, content]) => {
                let fileContent = typeof content === 'string' ? content : (content?.code || JSON.stringify(content, null, 2));
                if (fileContent) zip.file(filename.startsWith('/') ? filename.slice(1) : filename, fileContent);
            });
            zip.file("package.json", JSON.stringify({
                name: "generated-project", version: "1.0.0", private: true,
                dependencies: Lookup.DEPENDANCY,
                scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" }
            }, null, 2));
            const blob = await zip.generateAsync({ type: "blob" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'project-files.zip';
            document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); document.body.removeChild(a);
        } catch (error) { console.error('Download error:', error); }
    }, [files]);

    const deployToVercel = useCallback(async () => {
        setDeploying(true);
        setDeploySuccess(false);
        try {
            const filePayload = {};
            Object.entries(files || {}).forEach(([path, content]) => {
                const code = typeof content === 'string' ? content : (content?.code || JSON.stringify(content, null, 2));
                filePayload[path.replace(/^\//, '')] = code;
            });
            const res = await fetch('/api/deploy-vercel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: filePayload }),
            });
            const data = await res.json();
            if (data.url) {
                setDeploySuccess(true);
                setTimeout(() => setDeploySuccess(false), 3000);
                window.open(data.url, '_blank');
            } else if (data.error) alert(data.error);
        } catch (e) { alert('Deploy failed: ' + (e.message || 'Unknown error')); }
        finally { setDeploying(false); }
    }, [files]);

    // ─── Sub-components ──────────────────────────────────────────────

    const SandpackLoadingOverlay = () => {
        const { sandpack } = useSandpack();
        const [show, setShow] = useState(true);
        useEffect(() => {
            if (sandpack.status === 'running' || sandpack.status === 'done') {
                const t = setTimeout(() => setShow(false), 600);
                return () => clearTimeout(t);
            } else setShow(true);
        }, [sandpack.status]);
        if (!show) return null;
        return (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center" style={{ background: 'var(--bg-primary, #060608)' }}>
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-violet-500/20 blur-xl rounded-full animate-pulse" />
                        <Loader2Icon className="relative h-7 w-7 text-violet-400 animate-spin" />
                    </div>
                    <p className="text-sm font-medium text-zinc-500 animate-pulse">Initializing Preview...</p>
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
            } else { setErrorMsg(null); setPreviewError(null); }
        }, [sandpack?.error, setPreviewError]);
        if (!errorMsg) return null;
        return (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                <div className="glass-premium rounded-2xl p-5 lg:p-6 shadow-2xl max-w-md w-full scale-in-animation border-red-500/20">
                    <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                            <Rocket className="h-6 w-6 text-red-500 rotate-180" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white mb-1">Runtime Error</h3>
                            <p className="text-sm text-zinc-500">The app crashed while running.</p>
                        </div>
                        <div className="w-full bg-red-950/30 rounded-xl p-3 border border-red-500/10 text-left">
                            <code className="text-xs font-mono text-red-200 block max-h-32 overflow-y-auto">{errorMsg}</code>
                        </div>
                        <button
                            onClick={() => setMessages(prev => [...prev, { role: 'user', content: `Fix this runtime error:\n\n${errorMsg}\n\nPlease fix the code.` }])}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white px-4 py-3 rounded-xl transition-all font-medium shadow-lg min-h-[48px] btn-press"
                        >
                            <Sparkles className="h-4 w-4" />Fix with AI
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ─── Phase-aware Loading Overlay ─────────────────────────────────

    const PhaseLoadingOverlay = () => {
        const phaseLabels = {
            planning: '📋 Planning project structure...',
            planned: '📋 Project planned!',
            generating: '⚡ Generating files...',
            fallback: '🔄 Trying alternative approach...',
            done: '✅ Done!',
        };

        return (
            <div className='absolute inset-0 backdrop-blur-md flex flex-col items-center justify-center z-50' style={{ background: 'rgba(6,6,8,0.92)' }}>
                <div className="glass-premium p-6 lg:p-8 rounded-2xl flex flex-col items-center gap-4 lg:gap-5 text-center max-w-sm mx-4 w-full max-w-[340px] scale-in-animation">
                    {/* Spinner */}
                    <div className="relative">
                        <div className="absolute inset-0 bg-violet-500 blur-2xl opacity-20 rounded-full" />
                        <Loader2Icon className='relative animate-spin h-8 lg:h-10 w-8 lg:w-10 text-violet-400' />
                    </div>

                    {/* Main status */}
                    <div>
                        <h2 className='text-base font-semibold text-white mb-1'>Building your app</h2>
                        <p className="text-sm text-zinc-500">{phaseLabels[genPhase] || genStatus || 'Working...'}</p>
                        <p className="text-xs text-zinc-700 mt-1.5 tabular-nums font-mono">
                            {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                        </p>
                    </div>

                    {/* File progress bar */}
                    {(genPhase === 'generating' || genPhase === 'planned') && genTotal > 0 && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-xs text-zinc-600">
                                <span className="truncate mr-2">{genCurrentFile || 'Starting...'}</span>
                                <span className="tabular-nums font-mono whitespace-nowrap">{genProgress + 1}/{genTotal}</span>
                            </div>
                            <div className="w-full bg-white/[0.04] rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${Math.max(5, ((genProgress + 1) / genTotal) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* File list */}
                    {genPlan.length > 0 && (
                        <div className="w-full text-left space-y-1 max-h-32 overflow-y-auto hide-scrollbar">
                            {genPlan.map((filePath, i) => (
                                <div key={filePath} className="flex items-center gap-2 text-xs">
                                    {genPhase === 'generating' && genProgress > i ? (
                                        <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                                    ) : genPhase === 'generating' && genProgress === i ? (
                                        <Loader2Icon className="h-3 w-3 text-violet-400 animate-spin shrink-0" />
                                    ) : (
                                        <FileCode2 className="h-3 w-3 text-zinc-700 shrink-0" />
                                    )}
                                    <span className={
                                        genProgress > i ? 'text-zinc-500 line-through' :
                                            genProgress === i ? 'text-white font-medium' :
                                                'text-zinc-700'
                                    }>{filePath}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Retry indicator */}
                    {clientRetry > 0 && (
                        <p className="text-xs text-amber-500/80 flex items-center gap-1.5">
                            <RefreshCw className="h-3 w-3" />
                            Auto-retrying ({clientRetry + 1}/{MAX_CLIENT_RETRIES})
                        </p>
                    )}

                    {/* Dots */}
                    <div className="flex gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className='relative h-full border-0 lg:border border-white/[0.06] rounded-none lg:rounded-2xl overflow-hidden flex flex-col' style={{ background: 'var(--bg-primary, #060608)' }}>
            {/* Header */}
            <div className='flex items-center justify-between px-2 lg:px-4 py-2 lg:py-2.5 border-b border-white/[0.06]'>
                {/* Tab switcher */}
                <div className='flex items-center gap-0.5 p-1 rounded-xl glass'>
                    {[
                        { id: 'code', icon: Code, label: 'Code' },
                        { id: 'preview', icon: Eye, label: 'Preview' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative flex items-center gap-1.5 px-3 lg:px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 min-h-[40px] btn-press ${activeTab === tab.id
                                    ? 'text-white'
                                    : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            {activeTab === tab.id && (
                                <div className="absolute inset-0 bg-white/[0.1] rounded-lg tab-pill-animate" />
                            )}
                            <tab.icon className="relative h-4 w-4" />
                            <span className="relative">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 lg:gap-2">
                    <button
                        onClick={downloadFiles}
                        className="flex items-center gap-1.5 text-zinc-500 hover:text-white px-2 lg:px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-all text-[13px] font-medium min-h-[40px] min-w-[40px] justify-center btn-press"
                        title="Download Project"
                    >
                        <Download className="h-4 w-4" />
                        <span className="hidden lg:inline">Export</span>
                    </button>
                    <button
                        onClick={deployToVercel}
                        disabled={deploying}
                        className={`flex items-center gap-1.5 text-white px-3 lg:px-3.5 py-2 rounded-xl transition-all text-[13px] font-medium disabled:opacity-50 min-h-[40px] btn-press ${deploySuccess
                                ? 'bg-gradient-to-r from-emerald-600 to-green-600 shadow-lg shadow-emerald-600/20'
                                : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-600/20'
                            }`}
                    >
                        {deploying ? (
                            <Loader2Icon className="h-4 w-4 animate-spin" />
                        ) : deploySuccess ? (
                            <CheckCircle2 className="h-4 w-4" />
                        ) : (
                            <Rocket className="h-4 w-4" />
                        )}
                        <span className="hidden lg:inline">{deploySuccess ? 'Deployed!' : 'Deploy'}</span>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                <SandpackProvider
                    key={sandpackKey}
                    files={files}
                    template="react"
                    theme={'dark'}
                    customSetup={{ dependencies: { ...Lookup.DEPENDANCY }, entry: '/index.js' }}
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
                            <SandpackCodeEditor style={{ height: '100%' }} showTabs showLineNumbers showInlineErrors wrapContent closableTabs />
                        </div>
                        <div className={`h-full w-full ${activeTab === 'preview' ? 'flex' : 'hidden'} relative`}>
                            <ErrorBoundary>
                                <SandpackLoadingOverlay />
                                <SandpackPreview style={{ height: '100%' }} showNavigator showOpenInCodeSandbox={false} showRefreshButton />
                                {messages?.length > 0 && <div className="absolute bottom-4 right-4 z-50"><SandpackErrorListener /></div>}
                            </ErrorBoundary>
                        </div>
                    </SandpackLayout>
                </SandpackProvider>

                {loading && <PhaseLoadingOverlay />}
            </div>
        </div>
    );
}

export default CodeView;
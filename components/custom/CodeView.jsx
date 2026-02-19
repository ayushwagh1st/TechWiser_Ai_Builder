"use client"
import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
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
    const [files, setFiles] = useState(Lookup?.DEFAULT_FILE);
    const { messages, setMessages, setPreviewError, buildOptions } = useContext(MessagesContext);
    const UpdateFiles = useMutation(api.workspace.UpdateFiles);
    const convex = useConvex();
    const [loading, setLoading] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const elapsedRef = useRef(null);

    // Phase-aware loading state
    const [genPhase, setGenPhase] = useState('idle');    // idle | planning | generating | assembling | done | error
    const [genStatus, setGenStatus] = useState('');       // Human-readable status
    const [genProgress, setGenProgress] = useState(0);    // Current file index
    const [genTotal, setGenTotal] = useState(0);          // Total files
    const [genCurrentFile, setGenCurrentFile] = useState(''); // Currently generating file
    const [genPlan, setGenPlan] = useState([]);           // List of planned files
    const [clientRetry, setClientRetry] = useState(0);    // Which client retry

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
        setFiles({ ...Lookup.DEFAULT_FILE, ...processedFiles });
    }, [id, convex, preprocessFiles]);

    useEffect(() => { id && GetFiles(); }, [id, GetFiles]);

    /**
     * Process one SSE stream attempt. Returns { success, data, retryable, error }
     */
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

                    // Phase updates from server
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
    }, [messages, files, buildOptions]);

    /**
     * Main generation function with client-side auto-retry
     */
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
        const timeout = setTimeout(() => controller.abort(), 600_000); // 10 min absolute max
        let success = false;

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
                        const mergedFiles = { ...Lookup.DEFAULT_FILE, ...processedAiFiles };
                        setFiles(mergedFiles);
                        await UpdateFiles({ workspaceId: id, files: result.data.files });
                        setActiveTab('preview');
                        setGenPhase('done');
                        setGenStatus('Done!');
                        success = true;
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
    }, [messages, id, UpdateFiles, preprocessFiles, files, buildOptions, setMessages, processStream]);

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
            if (data.url) window.open(data.url, '_blank');
            else if (data.error) alert(data.error);
        } catch (e) { alert('Deploy failed: ' + (e.message || 'Unknown error')); }
        finally { setDeploying(false); }
    }, [files]);

    // ─── Sub-components ──────────────────────────────────────────────

    const SandpackLoadingOverlay = () => {
        const { sandpack } = useSandpack();
        const [show, setShow] = useState(true);
        useEffect(() => {
            if (sandpack.status === 'running' || sandpack.status === 'done') {
                const t = setTimeout(() => setShow(false), 500);
                return () => clearTimeout(t);
            } else setShow(true);
        }, [sandpack.status]);
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
            } else { setErrorMsg(null); setPreviewError(null); }
        }, [sandpack?.error, setPreviewError]);
        if (!errorMsg) return null;
        return (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="glass-strong rounded-2xl border border-red-500/20 bg-[#0a0a0a]/90 p-5 lg:p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95 duration-200">
                    <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20"><Rocket className="h-6 w-6 text-red-500 rotate-180" /></div>
                        <div><h3 className="text-lg font-semibold text-white mb-1">Runtime Error</h3><p className="text-sm text-zinc-400">The app crashed while running.</p></div>
                        <div className="w-full bg-red-950/30 rounded-lg p-3 border border-red-500/10 text-left"><code className="text-xs font-mono text-red-200 block max-h-32 overflow-y-auto">{errorMsg}</code></div>
                        <button onClick={() => setMessages(prev => [...prev, { role: 'user', content: `Fix this runtime error:\n\n${errorMsg}\n\nPlease fix the code.` }])} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white px-4 py-3 rounded-xl transition-all font-medium shadow-lg min-h-[48px]"><Sparkles className="h-4 w-4" />Fix with AI</button>
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
            <div className='absolute inset-0 bg-[#0a0a0a]/90 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-in fade-in duration-300'>
                <div className="glass-strong p-6 lg:p-8 rounded-2xl flex flex-col items-center gap-4 lg:gap-5 text-center max-w-sm mx-4 w-full max-w-[340px]">
                    {/* Spinner */}
                    <div className="relative">
                        <div className="absolute inset-0 bg-violet-500 blur-2xl opacity-20 rounded-full" />
                        <Loader2Icon className='relative animate-spin h-8 lg:h-10 w-8 lg:w-10 text-violet-400' />
                    </div>

                    {/* Main status */}
                    <div>
                        <h2 className='text-base font-semibold text-white mb-1'>Building your app</h2>
                        <p className="text-sm text-zinc-400">{phaseLabels[genPhase] || genStatus || 'Working...'}</p>
                        <p className="text-xs text-zinc-600 mt-1 tabular-nums">
                            {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                        </p>
                    </div>

                    {/* File progress bar (only during generating phase) */}
                    {(genPhase === 'generating' || genPhase === 'planned') && genTotal > 0 && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-xs text-zinc-500">
                                <span>{genCurrentFile || 'Starting...'}</span>
                                <span>{genProgress + 1}/{genTotal}</span>
                            </div>
                            <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${Math.max(5, ((genProgress + 1) / genTotal) * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* File list (show planned files) */}
                    {genPlan.length > 0 && (
                        <div className="w-full text-left space-y-1 max-h-32 overflow-y-auto">
                            {genPlan.map((filePath, i) => (
                                <div key={filePath} className="flex items-center gap-2 text-xs">
                                    {genPhase === 'generating' && genProgress > i ? (
                                        <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                                    ) : genPhase === 'generating' && genProgress === i ? (
                                        <Loader2Icon className="h-3 w-3 text-violet-400 animate-spin shrink-0" />
                                    ) : (
                                        <FileCode2 className="h-3 w-3 text-zinc-600 shrink-0" />
                                    )}
                                    <span className={
                                        genProgress > i ? 'text-zinc-400 line-through' :
                                            genProgress === i ? 'text-white font-medium' :
                                                'text-zinc-600'
                                    }>{filePath}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Retry indicator */}
                    {clientRetry > 0 && (
                        <p className="text-xs text-amber-500/80 flex items-center gap-1">
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
        <div className='relative h-full bg-[#0a0a0a] border-0 lg:border border-white/[0.06] rounded-none lg:rounded-2xl overflow-hidden flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between px-2 lg:px-4 py-2 lg:py-2.5 border-b border-white/[0.06]'>
                <div className='flex items-center gap-0.5 p-1 rounded-xl glass'>
                    <button onClick={() => setActiveTab('code')} className={`flex items-center gap-1.5 px-3 lg:px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 min-h-[40px] ${activeTab === 'code' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        <Code className="h-4 w-4" /><span>Code</span>
                    </button>
                    <button onClick={() => setActiveTab('preview')} className={`flex items-center gap-1.5 px-3 lg:px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 min-h-[40px] ${activeTab === 'preview' ? 'bg-white/[0.1] text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        <Eye className="h-4 w-4" /><span>Preview</span>
                    </button>
                </div>
                <div className="flex items-center gap-1.5 lg:gap-2">
                    <button onClick={downloadFiles} className="flex items-center gap-1.5 text-zinc-500 hover:text-white px-2 lg:px-2.5 py-2 rounded-lg hover:bg-white/[0.05] transition-all text-[13px] font-medium min-h-[40px] min-w-[40px] justify-center" title="Download Project">
                        <Download className="h-4 w-4" /><span className="hidden lg:inline">Export</span>
                    </button>
                    <button onClick={deployToVercel} disabled={deploying} className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white px-3 lg:px-3.5 py-2 rounded-lg transition-all shadow-lg shadow-violet-600/20 text-[13px] font-medium disabled:opacity-50 min-h-[40px] active:scale-95">
                        {deploying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}<span className="hidden lg:inline">Deploy</span>
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                <SandpackProvider files={files} template="react" theme={'dark'}
                    customSetup={{ dependencies: { ...Lookup.DEPENDANCY }, entry: '/index.js' }}
                    options={{ externalResources: ['https://cdn.tailwindcss.com'], bundlerTimeoutSecs: 120, recompileMode: "delayed", recompileDelay: 500 }}>
                    <SandpackErrorListener />
                    <SandpackLayout style={{ height: '100%', border: 'none', borderRadius: 0 }}>
                        <div className={`h-full w-full ${activeTab === 'code' ? 'flex' : 'hidden'}`}>
                            <div className="hidden lg:block"><SandpackFileExplorer style={{ height: '100%', borderRight: '1px solid rgba(255,255,255,0.06)' }} /></div>
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
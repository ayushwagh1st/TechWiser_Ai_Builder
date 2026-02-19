"use client"
import Lookup from '@/data/Lookup';
import { MessagesContext } from '@/context/MessagesContext';
import { useUser } from '@/hooks/useUser';
import { ArrowRight, Sparkles, Send, Link, Wand2, Download, Code, Database, Layers } from 'lucide-react';
import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useRouter } from 'next/navigation';

function Hero() {
    const [userInput, setUserInput] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const { messages, setMessages } = useContext(MessagesContext);
    const { user } = useUser();
    const CreateWorkspace = useMutation(api.workspace.CreateWorkspace);
    const router = useRouter();
    const [installPrompt, setInstallPrompt] = useState(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);
    const textareaRef = useRef(null);
    const containerRef = useRef(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const handler = (e) => {
            e.preventDefault();
            setInstallPrompt(e);
            setShowInstallBanner(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + 'px';
        }
    }, [userInput]);

    // Mouse tracking for spotlight
    const handleMouseMove = (e) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        setMousePosition({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    };

    const handleInstall = useCallback(async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const result = await installPrompt.userChoice;
        if (result.outcome === 'accepted') setShowInstallBanner(false);
        setInstallPrompt(null);
    }, [installPrompt]);

    const onGenerate = async (input) => {
        if (!input?.trim()) return;
        const msg = { role: 'user', content: input };
        setMessages(msg);
        const workspaceID = await CreateWorkspace({
            messages: [msg],
            userToken: user?.token
        });
        router.push('/workspace/' + workspaceID);
    }

    return (
        <div
            className="relative min-h-[100dvh] flex flex-col items-center justify-center overflow-hidden text-white selection:bg-violet-500/30"
            style={{ background: 'var(--bg-primary, #060608)' }}
            onMouseMove={handleMouseMove}
        >
            {/* Background Effects */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-30%] left-[10%] w-[600px] h-[600px] bg-violet-600/[0.05] rounded-full blur-[150px]" />
                <div className="absolute bottom-[-20%] right-[5%] w-[500px] h-[500px] bg-fuchsia-600/[0.04] rounded-full blur-[150px]" />
                <div className="absolute top-[20%] right-[30%] w-[300px] h-[300px] bg-blue-600/[0.03] rounded-full blur-[120px]" />

                {/* Floating Icons */}
                <div className="absolute top-[20%] left-[15%] opacity-20 float-animation">
                    <Code className="w-12 h-12 text-violet-400 rotate-12" />
                </div>
                <div className="absolute bottom-[25%] right-[15%] opacity-20 float-animation-delay-1">
                    <Database className="w-10 h-10 text-fuchsia-400 -rotate-12" />
                </div>
                <div className="absolute top-[30%] right-[20%] opacity-10 float-animation-delay-2">
                    <Layers className="w-14 h-14 text-blue-400 rotate-6" />
                </div>
            </div>

            {/* Install App Banner */}
            {showInstallBanner && (
                <div className="fixed top-16 left-4 right-4 z-50 animate-in slide-in-from-top-4 duration-300 lg:hidden">
                    <div className="glass-premium rounded-2xl px-4 py-3 flex items-center gap-3 shadow-2xl border-violet-500/20">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/20">
                            <Download className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-white">Install TechWiser App</p>
                            <p className="text-[11px] text-zinc-600">Add to your home screen for the best experience</p>
                        </div>
                        <button
                            onClick={handleInstall}
                            className="px-3.5 py-2 text-[12px] font-semibold rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/20 whitespace-nowrap min-h-[40px] btn-press"
                        >
                            Install
                        </button>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="relative z-10 w-full max-w-3xl px-4 sm:px-8 flex flex-col items-center text-center pt-16 md:pt-0" ref={containerRef}>
                {/* Badge */}
                <div className="animate-in fade-in slide-in-from-bottom-3 duration-500 mb-5 sm:mb-8">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass text-[13px] font-medium text-zinc-500 cursor-default">
                        <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                        <span>Powered by AI</span>
                        <ArrowRight className="h-3 w-3 text-zinc-700" />
                    </div>
                </div>

                {/* Headline */}
                <h1 className="text-[2rem] sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 mb-3 sm:mb-5 text-balance">
                    What do you want
                    <br />
                    <span className="text-gradient">to build?</span>
                </h1>

                {/* Subtitle */}
                <p className="text-[15px] sm:text-lg text-zinc-600 max-w-lg animate-in fade-in slide-in-from-bottom-5 duration-700 delay-150 mb-6 sm:mb-10 leading-relaxed text-balance">
                    Describe your app and TechWiser will generate production-ready code in seconds.
                </p>

                {/* Prompt Input */}
                <div className="w-full animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200 group">
                    <div
                        className={`relative rounded-2xl transition-all duration-300 ${isFocused ? 'glow-border-focus' : 'glow-border'}`}
                        style={{
                            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(139, 92, 246, 0.15), transparent 40%)`
                        }}
                    >
                        {/* Spotlight Border */}
                        <div
                            className="absolute inset-0 rounded-2xl pointer-events-none opacity-50 transition-opacity duration-500 group-hover:opacity-100"
                            style={{
                                background: `radial-gradient(500px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(255, 255, 255, 0.1), transparent 40%)`
                            }}
                        />

                        <div className="glass-premium rounded-2xl overflow-hidden relative z-10">
                            <textarea
                                ref={textareaRef}
                                placeholder="Describe your app idea..."
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        onGenerate(userInput);
                                    }
                                }}
                                className="w-full bg-transparent text-[15px] sm:text-base px-4 sm:px-5 py-4 min-h-[56px] max-h-[140px] text-white placeholder-zinc-700 focus:ring-0 resize-none outline-none leading-relaxed"
                                rows={2}
                            />
                            <div className="flex items-center justify-between px-3 py-2.5 border-t border-white/[0.04]">
                                <div className="flex items-center gap-2">
                                    <button className="p-2.5 text-zinc-700 hover:text-zinc-400 rounded-xl hover:bg-white/[0.04] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center btn-press" title="Attach">
                                        <Link className="h-4 w-4" />
                                    </button>
                                    <span className="text-[11px] font-semibold text-zinc-700 border border-zinc-800/60 rounded-md px-1.5 py-0.5">
                                        Plan
                                    </span>
                                </div>
                                <button
                                    onClick={() => onGenerate(userInput)}
                                    disabled={!userInput.trim()}
                                    className={`p-2.5 rounded-xl transition-all duration-200 min-w-[48px] min-h-[48px] flex items-center justify-center btn-press ${userInput.trim()
                                        ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/25 hover:shadow-violet-600/40 pulse-glow'
                                        : 'bg-zinc-800/40 text-zinc-700 cursor-not-allowed'
                                        }`}
                                >
                                    <Send className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Suggestion Chips */}
                <div className="w-full mt-5 sm:mt-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
                    <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-center gap-2 sm:gap-2.5">
                        {Lookup?.SUGGSTIONS?.slice(0, 4).map((suggestion, index) => (
                            <button
                                key={index}
                                onClick={() => setUserInput(suggestion)}
                                className="px-3.5 py-2.5 rounded-xl glass text-[13px] text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06] hover:border-white/[0.10] transition-all duration-200 text-left sm:text-center truncate min-h-[44px] btn-press"
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="absolute bottom-6 sm:bottom-8 text-zinc-800 text-xs font-medium tracking-wide pb-safe">
                Built with TechWiser AI
            </div>
        </div>
    );
}

export default Hero;
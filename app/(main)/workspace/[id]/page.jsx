"use client";

import dynamic from 'next/dynamic';
import React, { useState, useCallback } from 'react';
import { MessageSquare, Code, Eye, History } from 'lucide-react';
import { AppSidebar } from '@/components/custom/AppSidebar';

const ChatView = dynamic(() => import('@/components/custom/ChatView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-white/[0.02] rounded-2xl h-full" />,
});

const CodeView = dynamic(() => import('@/components/custom/CodeView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-white/[0.02] rounded-2xl h-full" />,
});

const mobileNavItems = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'code', label: 'Code', icon: Code },
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'history', label: 'History', icon: History },
];

const Workspace = () => {
    const [mobileTab, setMobileTab] = useState('chat');
    const [prevTab, setPrevTab] = useState(null);

    const switchTab = useCallback((newTab) => {
        setPrevTab(mobileTab);
        setMobileTab(newTab);
    }, [mobileTab]);

    return (
        <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary, #060608)' }}>
            {/* Subtle ambient background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-600/[0.02] rounded-full blur-[150px]" />
                <div className="absolute bottom-0 right-0 w-[500px] h-[300px] bg-fuchsia-600/[0.015] rounded-full blur-[120px]" />
            </div>

            {/* ─── Desktop Layout ─── */}
            <div className="hidden lg:flex flex-row h-full">
                <AppSidebar />
                <div className="flex-1 flex relative z-10 gap-4 p-4 pt-[72px] overflow-hidden">
                    {/* Chat sidebar */}
                    <div className="w-[340px] min-w-[300px] flex-shrink-0 h-full">
                        <ChatView />
                    </div>
                    {/* Code/Preview panel */}
                    <div className="flex-1 h-full">
                        <CodeView />
                    </div>
                </div>
            </div>

            {/* ─── Mobile Layout ─── */}
            <div className="lg:hidden flex flex-col h-full">
                {/* Content area */}
                <div className="flex-1 relative z-10 overflow-hidden">
                    {/* Chat Tab */}
                    <div className={`absolute inset-0 transition-all duration-250 ${mobileTab === 'chat' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-2 z-0 pointer-events-none'
                        }`} style={{ transitionTimingFunction: 'var(--ease-out-expo)' }}>
                        <ChatView />
                    </div>

                    {/* Code Tab */}
                    <div className={`absolute inset-0 transition-all duration-250 ${mobileTab === 'code' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-2 z-0 pointer-events-none'
                        }`} style={{ transitionTimingFunction: 'var(--ease-out-expo)' }}>
                        <CodeView />
                    </div>

                    {/* Preview Tab */}
                    <div className={`absolute inset-0 transition-all duration-250 ${mobileTab === 'preview' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-2 z-0 pointer-events-none'
                        }`} style={{ transitionTimingFunction: 'var(--ease-out-expo)' }}>
                        <CodeView />
                    </div>

                    {/* History Tab */}
                    <div className={`absolute inset-0 transition-all duration-250 ${mobileTab === 'history' ? 'opacity-100 translate-y-0 z-10' : 'opacity-0 translate-y-2 z-0 pointer-events-none'
                        }`} style={{ transitionTimingFunction: 'var(--ease-out-expo)' }}>
                        <AppSidebar />
                    </div>
                </div>

                {/* ─── Bottom Navigation Bar ─── */}
                <div className="relative z-50 flex-shrink-0">
                    <div className="backdrop-blur-2xl backdrop-saturate-150 border-t border-white/[0.06]" style={{ background: 'rgba(6,6,8,0.85)' }}>
                        <div className="flex items-stretch pb-safe">
                            {mobileNavItems.map(({ id, label, icon: Icon }) => {
                                const isActive = mobileTab === id;
                                return (
                                    <button
                                        key={id}
                                        onClick={() => switchTab(id)}
                                        className="flex-1 flex flex-col items-center justify-center gap-1.5 py-2.5 min-h-[60px] relative transition-all duration-200 btn-press"
                                    >
                                        {/* Active indicator pill */}
                                        {isActive && (
                                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 nav-pill-animate shadow-sm shadow-violet-500/40" />
                                        )}

                                        {/* Icon */}
                                        <div className={`p-1.5 rounded-xl transition-all duration-250 ${isActive
                                            ? 'bg-violet-500/10 text-violet-400 scale-110'
                                            : 'text-zinc-700 hover:text-zinc-500'
                                            }`} style={{ transitionTimingFunction: 'var(--ease-spring)' }}>
                                            <Icon className="h-5 w-5" />
                                        </div>

                                        {/* Label */}
                                        <span className={`text-[10px] font-semibold tracking-wide transition-all duration-200 ${isActive
                                            ? 'text-violet-400'
                                            : 'text-zinc-700'
                                            }`}>
                                            {label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Workspace;
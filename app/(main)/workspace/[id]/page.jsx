"use client";

import dynamic from 'next/dynamic';
import React, { useState } from 'react';
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

    return (
        <div className="h-[100dvh] bg-[#0a0a0a] flex flex-col overflow-hidden">
            {/* Subtle background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-600/[0.03] rounded-full blur-[120px]" />
            </div>

            {/* ─── Desktop Layout ─── */}
            <div className="hidden lg:flex flex-row h-full">
                <AppSidebar />
                <div className="flex-1 flex relative z-10 gap-4 p-4 pt-[72px] overflow-hidden">
                    {/* Chat sidebar — fixed width */}
                    <div className="w-[340px] min-w-[300px] flex-shrink-0 h-full">
                        <ChatView />
                    </div>
                    {/* Code/Preview panel — remaining width */}
                    <div className="flex-1 h-full">
                        <CodeView />
                    </div>
                </div>
            </div>

            {/* ─── Mobile Layout ─── */}
            <div className="lg:hidden flex flex-col h-full">
                {/* Content area — fills space above bottom nav */}
                <div className="flex-1 relative z-10 overflow-hidden">
                    {/* Chat Tab */}
                    <div className={`h-full ${mobileTab === 'chat' ? 'block tab-content-animate' : 'hidden'}`}>
                        <ChatView />
                    </div>

                    {/* Code Tab */}
                    <div className={`h-full ${mobileTab === 'code' ? 'block tab-content-animate' : 'hidden'}`}>
                        <CodeView />
                    </div>

                    {/* Preview Tab — full screen, no padding */}
                    <div className={`h-full ${mobileTab === 'preview' ? 'block tab-content-animate' : 'hidden'}`}>
                        <CodeView />
                    </div>

                    {/* History Tab */}
                    <div className={`h-full ${mobileTab === 'history' ? 'block tab-content-animate' : 'hidden'}`}>
                        <AppSidebar />
                    </div>
                </div>

                {/* ─── Bottom Navigation Bar ─── */}
                <div className="relative z-50 flex-shrink-0">
                    <div className="bg-[#0a0a0a]/80 backdrop-blur-2xl border-t border-white/[0.06]">
                        <div className="flex items-stretch pb-safe">
                            {mobileNavItems.map(({ id, label, icon: Icon }) => {
                                const isActive = mobileTab === id;
                                return (
                                    <button
                                        key={id}
                                        onClick={() => setMobileTab(id)}
                                        className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] relative transition-all duration-200 active:scale-95"
                                    >
                                        {/* Active indicator pill */}
                                        {isActive && (
                                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 nav-pill-animate" />
                                        )}

                                        {/* Icon */}
                                        <div className={`p-1.5 rounded-xl transition-all duration-200 ${isActive
                                            ? 'bg-violet-500/10 text-violet-400'
                                            : 'text-zinc-600'
                                            }`}>
                                            <Icon className="h-5 w-5" />
                                        </div>

                                        {/* Label */}
                                        <span className={`text-[10px] font-semibold tracking-wide transition-colors duration-200 ${isActive
                                            ? 'text-violet-400'
                                            : 'text-zinc-600'
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
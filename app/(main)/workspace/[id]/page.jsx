"use client";

import dynamic from 'next/dynamic';
import React, { useState } from 'react';
import { MessageSquare, Code, Eye } from 'lucide-react';

const ChatView = dynamic(() => import('@/components/custom/ChatView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-white/[0.02] rounded-2xl h-full" />
});

const CodeView = dynamic(() => import('@/components/custom/CodeView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-white/[0.02] rounded-2xl h-full" />
});

const Workspace = () => {
    const [mobileTab, setMobileTab] = useState('chat');

    return (
        <div className="h-[100dvh] bg-[#0a0a0a] flex flex-col overflow-hidden">
            {/* Subtle background */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-violet-600/[0.03] rounded-full blur-[120px]" />
            </div>

            {/* Mobile Tab Bar */}
            <div className="lg:hidden relative z-20 flex items-center gap-1 px-3 pt-[62px] pb-2 bg-[#0a0a0a] border-b border-white/[0.06]">
                {[
                    { id: 'chat', label: 'Chat', icon: MessageSquare },
                    { id: 'code', label: 'Code', icon: Code },
                ].map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setMobileTab(id)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium transition-all ${mobileTab === id
                            ? 'bg-white/[0.08] text-white'
                            : 'text-zinc-600 hover:text-zinc-400'
                            }`}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Desktop Layout */}
            <div className="hidden lg:flex relative z-10 flex-1 gap-4 p-4 pt-[72px] overflow-hidden">
                {/* Chat sidebar — 25% width */}
                <div className="w-[340px] min-w-[300px] flex-shrink-0 h-full">
                    <ChatView />
                </div>
                {/* Code/Preview panel — remaining width */}
                <div className="flex-1 h-full">
                    <CodeView />
                </div>
            </div>

            {/* Mobile Layout */}
            <div className="lg:hidden relative z-10 flex-1 p-3 overflow-hidden">
                <div className={`h-full ${mobileTab === 'chat' ? 'block' : 'hidden'}`}>
                    <ChatView />
                </div>
                <div className={`h-full ${mobileTab === 'code' ? 'block' : 'hidden'}`}>
                    <CodeView />
                </div>
            </div>
        </div>
    );
};

export default Workspace;
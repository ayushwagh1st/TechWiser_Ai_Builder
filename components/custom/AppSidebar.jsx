"use client"
import React from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUser } from '@/hooks/useUser';
import { MessageSquare, Plus, LayoutGrid, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export function AppSidebar() {
    const { user } = useUser();
    const { id } = useParams();
    const workspaceList = useQuery(api.workspace.GetAllWorkspaces, {
        userToken: user?.token
    });

    return (
        <div className="flex flex-col h-full w-full lg:w-[260px] flex-shrink-0 border-r border-white/[0.08] bg-[#0a0a0a]">
            {/* Header */}
            <div className="p-4">
                <Link href="/" className="flex items-center gap-2.5 mb-6 group">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-1.5 rounded-lg shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition-all duration-300 group-hover:scale-105">
                        <LayoutGrid className="h-4 w-4 text-white" />
                    </div>
                    <span className="font-semibold text-lg text-white tracking-tight group-hover:text-zinc-100 transition-colors">TechWiser</span>
                </Link>
                <Link href="/">
                    <Button className="w-full bg-white/[0.05] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.05] hover:border-white/[0.1] justify-start gap-2.5 h-10 text-[13px] font-medium transition-all shadow-sm hover:shadow-md">
                        <Plus className="h-4 w-4 text-violet-400" />
                        Start New Chat
                    </Button>
                </Link>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-2 py-2 mb-2 custom-scrollbar">
                <div className="px-3 py-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                    Recent Chats
                </div>

                {workspaceList === undefined ? (
                    // Loading state
                    <div className="space-y-1.5 px-2 mt-1">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-9 rounded-lg bg-white/[0.03] animate-pulse" />
                        ))}
                    </div>
                ) : workspaceList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center opacity-60">
                        <div className="w-10 h-10 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
                            <MessageSquare className="h-5 w-5 text-zinc-600" />
                        </div>
                        <p className="text-xs text-zinc-500 font-medium">No history yet</p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {workspaceList.slice().reverse().map((workspace) => {
                            const isActive = workspace._id === id;
                            // Extract first user message for title, or fallback
                            const firstUserMsg = workspace.messages?.find(m => m.role === 'user')?.content;
                            const title = firstUserMsg ? (firstUserMsg.length > 28 ? firstUserMsg.substring(0, 28) + '...' : firstUserMsg) : 'Untitled Workspace';

                            return (
                                <Link
                                    key={workspace._id}
                                    href={`/workspace/${workspace._id}`}
                                    className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] transition-all duration-200 ${isActive
                                        ? 'bg-white/[0.08] text-white font-medium'
                                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
                                        }`}
                                >
                                    {isActive && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-violet-500 rounded-r-full shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
                                    )}
                                    <MessageSquare className={`h-4 w-4 flex-shrink-0 transition-colors ${isActive ? 'text-violet-400' : 'text-zinc-600 group-hover:text-zinc-400'}`} />
                                    <span className="truncate flex-1">{title}</span>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-white/[0.06] bg-[#0a0a0a]">
                <div className="group flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors cursor-pointer border border-transparent hover:border-white/[0.04]">
                    <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                            {user?.name?.charAt(0) || 'U'}
                        </div>
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#0a0a0a] rounded-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate group-hover:text-violet-200 transition-colors">
                            {user?.name || 'Guest User'}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate group-hover:text-zinc-400">
                            {user?.email || 'Free Plan'}
                        </p>
                    </div>
                    <LogOut className="h-4 w-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                </div>
            </div>
        </div>
    );
}

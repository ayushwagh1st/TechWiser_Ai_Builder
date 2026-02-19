"use client"
import React, { useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUser } from '@/hooks/useUser';
import { MessageSquare, Plus, LayoutGrid, LogOut, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

export function AppSidebar() {
    const { user } = useUser();
    const { id } = useParams();
    const router = useRouter();
    const workspaceList = useQuery(api.workspace.GetAllWorkspaces, {
        userToken: user?.token
    });
    const deleteWorkspace = useMutation(api.workspace.DeleteWorkspace);
    const [deletingId, setDeletingId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const handleDelete = useCallback(async (workspaceId) => {
        setDeletingId(workspaceId);
        try {
            await deleteWorkspace({ workspaceId });
            // If deleting the active workspace, redirect home
            if (workspaceId === id) {
                router.push('/');
            }
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setDeletingId(null);
            setConfirmDeleteId(null);
        }
    }, [deleteWorkspace, id, router]);

    return (
        <div className="flex flex-col h-full w-full lg:w-[260px] flex-shrink-0 border-r-0 lg:border-r border-white/[0.06]" style={{ background: 'var(--bg-primary, #060608)' }}>
            {/* Header */}
            <div className="p-4">
                <Link href="/" className="flex items-center gap-2.5 mb-5 lg:mb-6 group">
                    <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 p-1.5 rounded-xl shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition-all duration-300 group-hover:scale-105 group-hover:rotate-3">
                        <LayoutGrid className="h-4 w-4 text-white" />
                    </div>
                    <span className="font-semibold text-lg text-white tracking-tight group-hover:text-zinc-100 transition-colors">TechWiser</span>
                </Link>
                <Link href="/">
                    <Button className="w-full bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 hover:text-white border border-white/[0.06] hover:border-white/[0.10] justify-start gap-2.5 h-12 lg:h-10 text-[13px] font-medium transition-all shadow-sm hover:shadow-md rounded-xl btn-press">
                        <Plus className="h-4 w-4 text-violet-400" />
                        Start New Chat
                    </Button>
                </Link>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-2 py-2 mb-2 hide-scrollbar">
                <div className="px-3 py-2 flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-wider">Recent Chats</span>
                    <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" />
                </div>

                {workspaceList === undefined ? (
                    <div className="space-y-1.5 px-2 mt-1">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-11 lg:h-9 rounded-xl bg-white/[0.02] animate-pulse" />
                        ))}
                    </div>
                ) : workspaceList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                        <div className="w-10 h-10 rounded-full bg-white/[0.03] flex items-center justify-center mb-3 float-animation">
                            <MessageSquare className="h-5 w-5 text-zinc-700" />
                        </div>
                        <p className="text-xs text-zinc-600 font-medium">No chats yet</p>
                        <p className="text-[10px] text-zinc-700 mt-1">Start a conversation to begin</p>
                    </div>
                ) : (
                    <div className="space-y-0.5 mt-1">
                        {workspaceList.slice().reverse().map((workspace) => {
                            const isActive = workspace._id === id;
                            const isDeleting = deletingId === workspace._id;
                            const isConfirming = confirmDeleteId === workspace._id;
                            const firstUserMsg = workspace.messages?.find(m => m.role === 'user')?.content;
                            const title = firstUserMsg ? (firstUserMsg.length > 26 ? firstUserMsg.substring(0, 26) + '...' : firstUserMsg) : 'Untitled Workspace';

                            return (
                                <div
                                    key={workspace._id}
                                    className={`group relative flex items-center rounded-xl lg:rounded-lg transition-all duration-200 ${isDeleting ? 'opacity-40 scale-95 pointer-events-none' : ''
                                        } ${isActive
                                            ? 'bg-white/[0.08]'
                                            : 'hover:bg-white/[0.04]'
                                        }`}
                                >
                                    {/* Active indicator */}
                                    {isActive && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-gradient-to-b from-violet-400 to-fuchsia-500 rounded-r-full glow-accent" />
                                    )}

                                    <Link
                                        href={`/workspace/${workspace._id}`}
                                        className={`flex-1 flex items-center gap-2.5 px-3 py-3 lg:py-2.5 text-[13px] min-h-[44px] ${isActive ? 'text-white font-medium' : 'text-zinc-500 hover:text-zinc-200'
                                            }`}
                                    >
                                        <MessageSquare className={`h-4 w-4 flex-shrink-0 transition-colors ${isActive ? 'text-violet-400' : 'text-zinc-700 group-hover:text-zinc-500'}`} />
                                        <span className="truncate flex-1">{title}</span>
                                    </Link>

                                    {/* Delete button — visible on hover */}
                                    {isConfirming ? (
                                        <div className="flex items-center gap-1 pr-2 delete-reveal">
                                            <button
                                                onClick={() => handleDelete(workspace._id)}
                                                className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center btn-press"
                                                title="Confirm delete"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => setConfirmDeleteId(null)}
                                                className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.05] transition-all min-w-[32px] min-h-[32px] flex items-center justify-center btn-press"
                                                title="Cancel"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setConfirmDeleteId(workspace._id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 mr-2 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center btn-press"
                                            title="Delete chat"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer — User profile */}
            <div className="p-3 border-t border-white/[0.06]" style={{ background: 'var(--bg-primary, #060608)' }}>
                <div className="group flex items-center gap-3 px-2.5 py-3 lg:py-2.5 rounded-xl hover:bg-white/[0.04] transition-all cursor-pointer border border-transparent hover:border-white/[0.04] min-h-[48px]">
                    <div className="relative">
                        <div className="w-9 h-9 lg:w-8 lg:h-8 rounded-full bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center text-xs font-bold text-white shadow-inner ring-2 ring-white/[0.06]">
                            {user?.name?.charAt(0) || 'U'}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2" style={{ ringColor: 'var(--bg-primary, #060608)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white truncate group-hover:text-violet-200 transition-colors">
                            {user?.name || 'Guest User'}
                        </p>
                        <p className="text-[11px] text-zinc-600 truncate group-hover:text-zinc-500 transition-colors">
                            {user?.email || 'Free Plan'}
                        </p>
                    </div>
                    <LogOut className="h-4 w-4 text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                </div>
            </div>
        </div>
    );
}

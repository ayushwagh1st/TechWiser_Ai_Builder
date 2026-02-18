"use client"
import { MessagesContext } from '@/context/MessagesContext';
import { Loader2Icon, Send, AlertCircle, X, Database, Rocket, Link, Wand2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useParams } from 'next/navigation';
import { useContext, useEffect, useState, useCallback, memo, useRef } from 'react';
import { useMutation } from 'convex/react';
import ReactMarkdown from 'react-markdown';

const MessageItem = memo(({ msg }) => (
    <div className={`group animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
        <div
            className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${msg.role === 'user'
                ? 'bg-gradient-to-br from-violet-600/90 to-fuchsia-600/90 text-white rounded-br-md shadow-lg shadow-violet-600/10'
                : 'glass text-zinc-300 rounded-bl-md'
                }`}
        >
            <ReactMarkdown className="prose prose-invert prose-sm max-w-none 
                prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-[#0a0a0a]/50 prose-pre:rounded-xl prose-pre:border prose-pre:border-white/[0.08] prose-pre:shadow-sm
                prose-code:text-violet-300 prose-code:bg-white/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none
                prose-headings:text-white prose-a:text-violet-400 prose-strong:text-white prose-ul:my-2 prose-li:my-0.5">
                {msg.content}
            </ReactMarkdown>
        </div>
    </div>
));

MessageItem.displayName = 'MessageItem';

function ChatView() {
    const { id } = useParams();
    const convex = useConvex();
    const { messages, setMessages, previewError, buildOptions, setBuildOptions } = useContext(MessagesContext);
    const [userInput, setUserInput] = useState('');
    const [showErrorPopup, setShowErrorPopup] = useState(true);
    const [loading, setLoading] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const UpdateMessages = useMutation(api.workspace.UpdateWorkspace);
    const messagesEndRef = useRef(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading, scrollToBottom]);

    const GetWorkSpaceData = useCallback(async () => {
        const result = await convex.query(api.workspace.GetWorkspace, {
            workspaceId: id
        });
        setMessages(result?.messages);
    }, [id, convex, setMessages]);

    useEffect(() => {
        id && GetWorkSpaceData();
    }, [id, GetWorkSpaceData]);

    useEffect(() => {
        if (previewError) setShowErrorPopup(true);
    }, [previewError]);

    const GetAiResponse = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/ai-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messages }),
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            const aiMessageIndex = messages.length;
            setMessages(prev => [...prev, { role: 'ai', content: '' }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk) {
                                fullText += data.chunk;
                                setMessages(prev => {
                                    const updated = [...prev];
                                    updated[aiMessageIndex] = { role: 'ai', content: fullText };
                                    return updated;
                                });
                            }
                            if (data.done && data.result) {
                                fullText = data.result;
                                setMessages(prev => {
                                    const updated = [...prev];
                                    updated[aiMessageIndex] = { role: 'ai', content: fullText };
                                    return updated;
                                });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }

            const finalMessages = [...messages, { role: 'ai', content: fullText }];
            await UpdateMessages({
                messages: finalMessages,
                workspaceId: id
            });
        } catch (error) {
            console.error('Error getting AI response:', error);
        } finally {
            setLoading(false);
        }
    }, [messages, id, UpdateMessages, setMessages]);

    useEffect(() => {
        if (messages?.length > 0) {
            const role = messages[messages?.length - 1].role;
            if (role === 'user') {
                GetAiResponse();
            }
        }
    }, [messages, GetAiResponse]);

    const onGenerate = useCallback((input) => {
        setMessages(prev => [...prev, {
            role: 'user',
            content: input
        }]);
        setUserInput('');
    }, [setMessages]);

    const onFixPreviewError = useCallback(() => {
        if (!previewError) return;
        const fixPrompt = `The live preview of the generated project is failing with the following runtime or build error:\n\n${previewError}\n\nPlease update the generated React + Vite code to fix this error and keep the project production-ready. Only change what is necessary to resolve the issue.`;
        setMessages(prev => [...prev, {
            role: 'user',
            content: fixPrompt
        }]);
        setShowErrorPopup(false);
    }, [previewError, setMessages]);

    const dismissErrorPopup = useCallback(() => {
        setShowErrorPopup(false);
    }, []);

    return (
        <div className="relative h-full flex flex-col bg-[#0a0a0a] rounded-2xl overflow-hidden border border-white/[0.06]">
            {/* Error Popup Modal */}
            {previewError && showErrorPopup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={dismissErrorPopup}>
                    <div
                        className="glass-strong rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200 border-red-500/20"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 p-4 border-b border-red-500/10 bg-red-950/20">
                            <div className="p-2 rounded-full bg-red-500/10 text-red-400">
                                <AlertCircle className="h-5 w-5" />
                            </div>
                            <h3 className="font-semibold text-red-200 flex-1 text-sm">Preview error detected</h3>
                            <button onClick={dismissErrorPopup} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="text-xs font-mono text-red-200 bg-red-950/30 p-3 rounded-xl border border-red-500/10 overflow-auto max-h-32">
                                {previewError}
                            </div>
                            <p className="text-sm text-zinc-500">
                                TechWiser can try to fix this error automatically.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={dismissErrorPopup}
                                    className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                                >
                                    Dismiss
                                </button>
                                <button
                                    onClick={onFixPreviewError}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 text-white text-sm font-medium transition-all shadow-lg shadow-red-500/20"
                                >
                                    <Wand2 className="h-4 w-4" />
                                    Fix it for me
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[13px] font-medium text-zinc-400">Chat</span>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 hide-scrollbar">
                <div className="space-y-4">
                    {/* Empty State */}
                    {(!messages || messages.length === 0) && (
                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-4">
                            <div className="p-4 rounded-2xl glass mb-4">
                                <Wand2 className="h-6 w-6 text-violet-400" />
                            </div>
                            <h2 className="text-lg font-semibold text-white mb-1.5">
                                What would you like to build?
                            </h2>
                            <p className="text-sm text-zinc-600 max-w-[240px]">
                                Describe the app you're imagining and AI will generate it for you.
                            </p>
                        </div>
                    )}

                    {/* Inline fix banner */}
                    {previewError && !showErrorPopup && (
                        <div className="flex justify-center animate-in fade-in slide-in-from-top-2">
                            <button
                                onClick={onFixPreviewError}
                                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all"
                            >
                                <AlertCircle className="h-3.5 w-3.5" />
                                Fix preview error
                            </button>
                        </div>
                    )}

                    {/* Messages */}
                    {Array.isArray(messages) && messages?.map((msg, index) => (
                        <MessageItem key={index} msg={msg} />
                    ))}

                    {/* Typing Indicator */}
                    {loading && (
                        <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="glass rounded-2xl rounded-bl-md px-5 py-3.5 flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-violet-400 typing-dot" />
                                <div className="w-2 h-2 rounded-full bg-violet-400 typing-dot" />
                                <div className="w-2 h-2 rounded-full bg-violet-400 typing-dot" />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="p-2 sm:p-3 border-t border-white/[0.06]">
                {/* Build Options */}
                <div className="flex flex-wrap gap-1.5 mb-2 px-1">
                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all border ${buildOptions?.includeSupabase
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-transparent border-white/[0.06] text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.03]'
                        }`}>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={buildOptions?.includeSupabase ?? false}
                            onChange={(e) => setBuildOptions?.((prev) => ({ ...(prev || {}), includeSupabase: e.target.checked }))}
                        />
                        <Database className="h-3 w-3" />
                        Supabase
                    </label>
                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all border ${buildOptions?.deployToVercel
                        ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
                        : 'bg-transparent border-white/[0.06] text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.03]'
                        }`}>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={buildOptions?.deployToVercel ?? false}
                            onChange={(e) => setBuildOptions?.((prev) => ({ ...(prev || {}), deployToVercel: e.target.checked }))}
                        />
                        <Rocket className="h-3 w-3" />
                        Vercel
                    </label>
                </div>

                {/* Input Field */}
                <div className={`relative rounded-xl transition-all duration-200 ${isFocused ? 'glow-border-focus' : ''}`}>
                    <div className="glass rounded-xl overflow-hidden">
                        <textarea
                            placeholder="Ask anything..."
                            value={userInput}
                            onChange={(event) => setUserInput(event.target.value)}
                            onFocus={() => setIsFocused(true)}
                            onBlur={() => setIsFocused(false)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (userInput.trim()) onGenerate(userInput);
                                }
                            }}
                            className="w-full bg-transparent text-[14px] text-zinc-100 pl-4 pr-12 py-3 focus:ring-0 outline-none resize-none min-h-[44px] max-h-[120px] placeholder-zinc-600"
                            rows={1}
                        />
                        <div className="absolute right-2 bottom-2">
                            {userInput.trim() ? (
                                <button
                                    onClick={() => onGenerate(userInput)}
                                    className="p-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/20 transition-all hover:scale-105 active:scale-95"
                                >
                                    <Send className="h-4 w-4" />
                                </button>
                            ) : (
                                <div className="p-2 text-zinc-700">
                                    <Link className="h-4 w-4" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-center text-[10px] text-zinc-700 mt-2 font-medium">
                    AI can make mistakes. Check generated code.
                </p>
            </div>
        </div>
    );
}

export default ChatView;
"use client"
import { MessagesContext } from '@/context/MessagesContext';
import { Loader2Icon, Send, AlertCircle, X, Database, Rocket, Link, Wand2, Sparkles } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useParams } from 'next/navigation';
import { useContext, useEffect, useState, useCallback, memo, useRef } from 'react';
import { useMutation } from 'convex/react';
import ReactMarkdown from 'react-markdown';

const AiAvatar = () => (
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/15 ring-2 ring-white/[0.04]">
        <Sparkles className="h-3.5 w-3.5 text-white" />
    </div>
);

const MessageItem = memo(({ msg, isFirstInGroup, isLastInGroup }) => (
    <div className={`group animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start items-end gap-2'}`}>
        {/* AI Avatar — only on last message in group */}
        {msg.role !== 'user' && isLastInGroup && <AiAvatar />}
        {msg.role !== 'user' && !isLastInGroup && <div className="w-7 flex-shrink-0" />}

        <div
            className={`max-w-[82%] px-4 py-3 text-[14px] leading-relaxed transition-all ${msg.role === 'user'
                ? `bg-gradient-to-br from-violet-600/90 to-fuchsia-600/90 text-white shadow-lg shadow-violet-600/10
                   ${isFirstInGroup ? 'rounded-2xl rounded-br-md' : isLastInGroup ? 'rounded-2xl rounded-tr-md' : 'rounded-xl rounded-r-md'}`
                : `glass text-zinc-300
                   ${isFirstInGroup ? 'rounded-2xl rounded-bl-md' : isLastInGroup ? 'rounded-2xl rounded-tl-md' : 'rounded-xl rounded-l-md'}`
                }`}
        >
            <ReactMarkdown className="prose prose-invert prose-sm max-w-none 
                prose-p:leading-relaxed prose-p:my-1.5
                prose-pre:p-0 prose-pre:bg-black/30 prose-pre:rounded-xl prose-pre:border prose-pre:border-white/[0.06] prose-pre:shadow-sm
                prose-code:text-violet-300 prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none
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
    const textareaRef = useRef(null);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, loading, scrollToBottom]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [userInput]);

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
                headers: { 'Content-Type': 'application/json' },
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
                        } catch (e) { /* skip */ }
                    }
                }
            }

            const finalMessages = [...messages, { role: 'ai', content: fullText }];
            await UpdateMessages({ messages: finalMessages, workspaceId: id });
        } catch (error) {
            console.error('Error getting AI response:', error);
        } finally {
            setLoading(false);
        }
    }, [messages, id, UpdateMessages, setMessages]);

    useEffect(() => {
        if (messages?.length > 0) {
            const role = messages[messages.length - 1].role;
            if (role === 'user') GetAiResponse();
        }
    }, [messages, GetAiResponse]);

    const onGenerate = useCallback((input) => {
        setMessages(prev => [...prev, { role: 'user', content: input }]);
        setUserInput('');
    }, [setMessages]);

    const onFixPreviewError = useCallback(() => {
        if (!previewError) return;
        const fixPrompt = `The live preview of the generated project is failing with the following runtime or build error:\n\n${previewError}\n\nPlease update the generated React + Vite code to fix this error and keep the project production-ready. Only change what is necessary to resolve the issue.`;
        setMessages(prev => [...prev, { role: 'user', content: fixPrompt }]);
        setShowErrorPopup(false);
    }, [previewError, setMessages]);

    const dismissErrorPopup = useCallback(() => setShowErrorPopup(false), []);

    // Check if message is first/last in a group of same-role messages
    const getGroupInfo = useCallback((index) => {
        if (!messages) return { isFirstInGroup: true, isLastInGroup: true };
        const currRole = messages[index]?.role;
        const prevRole = index > 0 ? messages[index - 1]?.role : null;
        const nextRole = index < messages.length - 1 ? messages[index + 1]?.role : null;
        return {
            isFirstInGroup: prevRole !== currRole,
            isLastInGroup: nextRole !== currRole,
        };
    }, [messages]);

    return (
        <div className="relative h-full flex flex-col rounded-none lg:rounded-2xl overflow-hidden border-0 lg:border border-white/[0.06]" style={{ background: 'var(--bg-primary, #060608)' }}>
            {/* Error Popup Modal */}
            {previewError && showErrorPopup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={dismissErrorPopup}>
                    <div
                        className="glass-premium rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden scale-in-animation border-red-500/20"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 p-4 border-b border-red-500/10 bg-red-950/20">
                            <div className="p-2 rounded-full bg-red-500/10 text-red-400">
                                <AlertCircle className="h-5 w-5" />
                            </div>
                            <h3 className="font-semibold text-red-200 flex-1 text-sm">Preview error detected</h3>
                            <button onClick={dismissErrorPopup} className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center btn-press">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="text-xs font-mono text-red-200 bg-red-950/30 p-3 rounded-xl border border-red-500/10 overflow-auto max-h-32">
                                {previewError}
                            </div>
                            <p className="text-sm text-zinc-600">
                                TechWiser can try to fix this error automatically.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button onClick={dismissErrorPopup} className="px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-500 hover:text-white hover:bg-white/[0.05] transition-colors min-h-[44px] btn-press">
                                    Dismiss
                                </button>
                                <button
                                    onClick={onFixPreviewError}
                                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 text-white text-sm font-medium transition-all shadow-lg shadow-red-500/20 min-h-[44px] btn-press"
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
            <div className="flex items-center gap-3 px-4 py-2.5 lg:py-3 border-b border-white/[0.06]">
                <div className="relative">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <div className="absolute inset-0 h-2 w-2 rounded-full bg-emerald-500 animate-ping opacity-40" />
                </div>
                <span className="text-[13px] font-semibold text-zinc-400 tracking-tight">Chat</span>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-3 lg:px-4 py-3 lg:py-4 hide-scrollbar">
                <div className="space-y-2 lg:space-y-2.5">
                    {/* Empty State */}
                    {(!messages || messages.length === 0) && (
                        <div className="flex flex-col items-center justify-center h-full min-h-[250px] lg:min-h-[300px] text-center px-4">
                            <div className="p-4 rounded-2xl glass-premium mb-4 float-animation">
                                <Wand2 className="h-6 w-6 text-violet-400" />
                            </div>
                            <h2 className="text-lg font-semibold text-white mb-1.5">
                                What would you like to build?
                            </h2>
                            <p className="text-sm text-zinc-600 max-w-[240px] leading-relaxed">
                                Describe the app you're imagining and AI will generate it for you.
                            </p>
                        </div>
                    )}

                    {/* Inline fix banner */}
                    {previewError && !showErrorPopup && (
                        <div className="flex justify-center animate-in fade-in slide-in-from-top-2">
                            <button
                                onClick={onFixPreviewError}
                                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all min-h-[44px] btn-press"
                            >
                                <AlertCircle className="h-3.5 w-3.5" />
                                Fix preview error
                            </button>
                        </div>
                    )}

                    {/* Messages */}
                    {Array.isArray(messages) && messages.map((msg, index) => {
                        const { isFirstInGroup, isLastInGroup } = getGroupInfo(index);
                        return (
                            <MessageItem
                                key={index}
                                msg={msg}
                                isFirstInGroup={isFirstInGroup}
                                isLastInGroup={isLastInGroup}
                            />
                        );
                    })}

                    {/* Typing Indicator */}
                    {loading && (
                        <div className="flex justify-start items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <AiAvatar />
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
            <div className="p-2 lg:p-3 border-t border-white/[0.06] pb-safe">
                {/* Build Options */}
                <div className="flex flex-wrap gap-1.5 mb-2 px-1">
                    <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all border min-h-[36px] btn-press ${buildOptions?.includeSupabase
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-transparent border-white/[0.05] text-zinc-700 hover:text-zinc-400 hover:bg-white/[0.03]'
                        }`}>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={buildOptions?.includeSupabase ?? false}
                            onChange={(e) => setBuildOptions?.((prev) => ({ ...(prev || {}), includeSupabase: e.target.checked }))}
                        />
                        <Database className="h-3.5 w-3.5" />
                        Supabase
                    </label>
                    <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all border min-h-[36px] btn-press ${buildOptions?.deployToVercel
                        ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
                        : 'bg-transparent border-white/[0.05] text-zinc-700 hover:text-zinc-400 hover:bg-white/[0.03]'
                        }`}>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={buildOptions?.deployToVercel ?? false}
                            onChange={(e) => setBuildOptions?.((prev) => ({ ...(prev || {}), deployToVercel: e.target.checked }))}
                        />
                        <Rocket className="h-3.5 w-3.5" />
                        Vercel
                    </label>
                </div>

                {/* Input Field */}
                <div className={`relative rounded-xl transition-all duration-300 ${isFocused ? 'glow-border-focus' : ''}`}>
                    <div className="glass rounded-xl overflow-hidden">
                        <textarea
                            ref={textareaRef}
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
                            className="w-full bg-transparent text-[14px] text-zinc-100 pl-4 pr-14 py-3 focus:ring-0 outline-none resize-none min-h-[48px] max-h-[120px] placeholder-zinc-700"
                            rows={1}
                        />
                        <div className="absolute right-2 bottom-2">
                            {userInput.trim() ? (
                                <button
                                    onClick={() => onGenerate(userInput)}
                                    className="p-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/20 transition-all hover:shadow-violet-600/40 min-w-[44px] min-h-[44px] flex items-center justify-center btn-press pulse-glow"
                                >
                                    <Send className="h-4 w-4" />
                                </button>
                            ) : (
                                <div className="p-2.5 text-zinc-800 min-w-[44px] min-h-[44px] flex items-center justify-center">
                                    <Link className="h-4 w-4" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <p className="text-center text-[10px] text-zinc-700 mt-1.5 font-medium tracking-wide">
                    AI can make mistakes. Check generated code.
                </p>
            </div>
        </div>
    );
}

export default ChatView;
"use client"
import React from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { MessagesContext } from '@/context/MessagesContext';

class ErrorBoundary extends React.Component {
    static contextType = MessagesContext;

    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Preview Side Error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    resetError = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    render() {
        if (this.state.hasError) {
            let errorMsg = this.state.error?.message || "Something went wrong";

            // Fix for the specific "Cannot assign to read only property 'message'" crash
            // which happens when a frozen SyntaxError object is mutated by some tool
            if (errorMsg.includes("Cannot assign to read only property 'message'")) {
                errorMsg = "Syntax Error: The generated code contains invalid syntax. Please try fixing it with AI.";
            }

            return (
                <div className="h-full w-full flex items-center justify-center p-6 relative overflow-hidden bg-[#0a0a0a]">
                    {/* Ambient Background */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                        <div className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-red-900/10 via-[#0a0a0a] to-[#0a0a0a]" />
                    </div>

                    <div className="relative z-10 max-w-lg w-full">
                        <div className="glass-strong border border-red-500/20 bg-red-500/5 rounded-2xl p-6 md:p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
                            <div className="flex flex-col items-center text-center">
                                <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4 border border-red-500/20 shadow-inner">
                                    <AlertTriangle className="h-6 w-6 text-red-400" />
                                </div>

                                <h3 className="text-lg font-semibold text-white mb-2">
                                    Preview Error
                                </h3>

                                <p className="text-sm text-zinc-400 mb-6 leading-relaxed max-w-sm">
                                    {errorMsg}
                                </p>

                                <div className="w-full bg-black/40 rounded-lg p-3 mb-6 border border-white/5 text-left overflow-auto max-h-40">
                                    <code className="text-xs font-mono text-red-300/90 break-words">
                                        {this.state.error?.toString()}
                                    </code>
                                </div>

                                <div className="flex w-full gap-3">
                                    <button
                                        onClick={this.resetError}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium"
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                        Retry
                                    </button>

                                    <button
                                        onClick={() => {
                                            if (this.context && this.context.setMessages) {
                                                this.context.setMessages(prev => [...prev, {
                                                    role: 'user',
                                                    content: `I encountered this error in the preview:\n\n${errorMsg}\n\nPlease fix the code.`
                                                }]);
                                                // Reset error so user can see the fix being applied (optional, or keep showing error until code changes)
                                                // For now, let's keep showing error until code updates, but user might want to switch tabs.
                                            }
                                        }}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg shadow-red-600/20 transition-all text-sm font-medium"
                                    >
                                        <Sparkles className="h-4 w-4" />
                                        Fix with AI
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

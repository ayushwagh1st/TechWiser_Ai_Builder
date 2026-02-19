"use client"
import React, { memo, useMemo } from 'react';
import { Loader2Icon, CheckCircle2, FileCode2 } from 'lucide-react';

const PhaseLoadingOverlay = memo(({ genPhase, genStatus, genProgress, genTotal, genPlan, genCurrentFile, elapsedTime }) => {
    const phaseLabels = {
        planning: '📋 Planning project structure...',
        planned: '📋 Project planned!',
        generating: '⚡ Generating files...',
        fallback: '🔄 Trying alternative approach...',
        done: '✅ Done!',
    };

    // Calculate progress with safe fallback
    const progressPercent = useMemo(() => {
        if (!genTotal) return 5;
        return Math.min(100, Math.max(5, ((genProgress) / genTotal) * 100)); // genProgress is index, usually progress lags 1 behind total until done
    }, [genProgress, genTotal]);

    return (
        <div className='absolute inset-0 backdrop-blur-md flex flex-col items-center justify-center z-50 animate-in fade-in duration-300' style={{ background: 'rgba(6,6,8,0.92)' }}>
            <div className="glass-premium p-6 lg:p-8 rounded-2xl flex flex-col items-center gap-4 lg:gap-5 text-center max-w-sm mx-4 w-full max-w-[340px] scale-in-animation">
                {/* Spinner */}
                <div className="relative">
                    <div className="absolute inset-0 bg-violet-500 blur-2xl opacity-20 rounded-full" />
                    <Loader2Icon className='relative animate-spin h-8 lg:h-10 w-8 lg:w-10 text-violet-400' />
                </div>

                {/* Main status */}
                <div>
                    <h2 className='text-base font-semibold text-white mb-1'>Building your app</h2>
                    <p className="text-sm text-zinc-500 animate-pulse">{phaseLabels[genPhase] || genStatus || 'Working...'}</p>
                    <p className="text-xs text-zinc-700 mt-1.5 tabular-nums font-mono opacity-60">
                        {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                    </p>
                </div>

                {/* File Progress (if generating) */}
                {(genPhase === 'generating' || genPhase === 'planned') && genTotal > 0 && (
                    <div className="w-full space-y-2.5">
                        <div className="flex justify-between text-xs text-zinc-500 items-baseline">
                            <span className="truncate max-w-[180px] text-zinc-400">{genCurrentFile || 'Starting...'}</span>
                            <span className="tabular-nums font-mono opacity-80">{genProgress}/{genTotal}</span>
                        </div>
                        <div className="w-full bg-white/[0.04] rounded-full h-1.5 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* File List for visual context */}
                {genPlan && genPlan.length > 0 && (
                    <div className="w-full mt-2 pt-4 border-t border-white/[0.04] text-left max-h-[160px] overflow-y-auto hide-scrollbar space-y-1.5">
                        {genPlan.map((path, idx) => {
                            // Status logic
                            const isCompleted = genProgress > idx;
                            const isCurrent = genProgress === idx;
                            const isPending = genProgress < idx;

                            return (
                                <div key={path} className={`flex items-center gap-2.5 text-xs transition-all duration-300 ${isCurrent ? 'opacity-100 translate-x-1' : isCompleted ? 'opacity-50' : 'opacity-30'}`}>
                                    {isCompleted ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    ) : isCurrent ? (
                                        <Loader2Icon className="h-3.5 w-3.5 text-violet-500 animate-spin shrink-0" />
                                    ) : (
                                        <FileCode2 className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                                    )}
                                    <span className={`truncate font-medium ${isCurrent ? 'text-white' : isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-600'}`}>
                                        {path}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
});

PhaseLoadingOverlay.displayName = 'PhaseLoadingOverlay';

export default PhaseLoadingOverlay;

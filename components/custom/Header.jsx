"use client"
import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { Code, Menu, X } from 'lucide-react';

function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const buttonRef = useRef(null);
    const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e) => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        // Intensity of the magnetic effect
        setButtonPosition({ x: x * 0.2, y: y * 0.2 });
    };

    const handleMouseLeave = () => {
        setButtonPosition({ x: 0, y: 0 });
    };

    return (
        <header className="fixed top-0 left-0 right-0 z-50 glass-premium border-b border-white/[0.04]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between h-14">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2.5 group">
                        <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 p-1.5 rounded-xl shadow-lg shadow-violet-500/20 transition-all duration-300 group-hover:shadow-violet-500/40 group-hover:scale-105 group-hover:rotate-3">
                            <Code className="h-4 w-4 text-white" />
                        </div>
                        <span className="text-[15px] font-semibold text-white tracking-tight group-hover:text-violet-200 transition-colors duration-200">
                            TechWiser
                        </span>
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-1">
                        <Link href="/" className="px-3.5 py-2 text-sm text-zinc-500 hover:text-white rounded-xl hover:bg-white/[0.05] transition-all duration-200 font-medium">
                            Home
                        </Link>
                        <button
                            ref={buttonRef}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                            style={{
                                transform: `translate(${buttonPosition.x}px, ${buttonPosition.y}px)`,
                                transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                            }}
                            className="ml-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-xl hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-600/20 hover:shadow-violet-600/35 btn-press shimmer relative overflow-hidden"
                        >
                            Get Started
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2.5 text-zinc-500 hover:text-white rounded-xl hover:bg-white/[0.05] transition-all min-w-[44px] min-h-[44px] flex items-center justify-center btn-press"
                    >
                        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden bg-[#060608]/95 backdrop-blur-2xl border-t border-white/[0.06] animate-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 space-y-1.5">
                        <Link href="/" className="block px-3 py-2.5 text-sm text-zinc-400 hover:text-white rounded-xl hover:bg-white/[0.05] transition-all font-medium min-h-[44px] flex items-center">
                            Home
                        </Link>
                        <button className="w-full mt-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-xl shadow-lg shadow-violet-600/20 min-h-[44px] btn-press shimmer">
                            Get Started
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
}

export default Header;
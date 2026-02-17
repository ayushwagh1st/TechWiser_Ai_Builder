import React, { useState } from 'react';
import Link from 'next/link';
import { Code, Menu, X } from 'lucide-react';

function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.06]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between h-14">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                        <div className="bg-gradient-to-br from-violet-500 to-fuchsia-500 p-1.5 rounded-lg shadow-lg shadow-violet-500/20">
                            <Code className="h-4 w-4 text-white" />
                        </div>
                        <span className="text-[15px] font-semibold text-white tracking-tight">
                            TechWiser
                        </span>
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-1">
                        <Link href="/" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition-all">
                            Home
                        </Link>
                        <button className="ml-2 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-lg hover:from-violet-500 hover:to-fuchsia-500 transition-all shadow-lg shadow-violet-600/20">
                            Get Started
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden glass-strong border-t border-white/[0.06] animate-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 space-y-1">
                        <Link href="/" className="block px-3 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition-all">
                            Home
                        </Link>
                        <button className="w-full mt-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-lg">
                            Get Started
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
}

export default Header;
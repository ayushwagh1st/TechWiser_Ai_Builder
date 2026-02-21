"use client"
import React, { useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import Header from '@/components/custom/Header';
import { MessagesContext } from '@/context/MessagesContext';
import { usePathname } from 'next/navigation';

function Provider({ children }) {
  const [messages, setMessages] = useState();
  const [previewError, setPreviewError] = useState(null);
  const [buildOptions, setBuildOptions] = useState({
    includeSupabase: false,
    deployToVercel: false,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = React.useRef(null);

  const abortGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  const pathname = usePathname();
  // Hide the header on workspace pages on mobile to maximize space (bottom nav replaces it)
  const isWorkspace = pathname?.startsWith('/workspace');

  return (
    <div>
      <MessagesContext.Provider value={{
        messages, setMessages,
        previewError, setPreviewError,
        buildOptions, setBuildOptions,
        isGenerating, setIsGenerating,
        abortControllerRef, abortGeneration
      }}>
        <NextThemesProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* On workspace pages: hide header on mobile (lg:block shows it on desktop) */}
          {isWorkspace ? (
            <div className="hidden lg:block">
              <Header />
            </div>
          ) : (
            <Header />
          )}
          {children}
        </NextThemesProvider>
      </MessagesContext.Provider>
    </div>
  );
}

export default Provider;
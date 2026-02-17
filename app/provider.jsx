"use client"
import React, { useState } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import Header from '@/components/custom/Header';
import { MessagesContext } from '@/context/MessagesContext';

function Provider({children}) {
  const [messages, setMessages] = useState();
  const [previewError, setPreviewError] = useState(null);
  const [buildOptions, setBuildOptions] = useState({
    includeSupabase: false,
    deployToVercel: false,
  });
  return (
    <div>
      <MessagesContext.Provider value={{ messages, setMessages, previewError, setPreviewError, buildOptions, setBuildOptions }}>
        <NextThemesProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem 
            disableTransitionOnChange
            >
              <Header />
            {children}
        </NextThemesProvider>
      </MessagesContext.Provider>
    </div>
  );
}

export default Provider;
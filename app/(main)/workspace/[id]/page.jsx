"use client";

import dynamic from 'next/dynamic';
import React from 'react';

const ChatView = dynamic(() => import('@/components/custom/ChatView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-gray-800 rounded-lg h-full" />
});

const CodeView = dynamic(() => import('@/components/custom/CodeView'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-gray-800 rounded-lg h-full" />
});

const BackgroundPattern = React.memo(() => (
    <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px]">
        <div className="absolute left-1/2 top-0 h-[500px] w-[1000px] -translate-x-1/2 bg-[radial-gradient(circle_400px_at_50%_300px,#3b82f625,transparent)]" />
    </div>
));

BackgroundPattern.displayName = 'BackgroundPattern';

const Workspace = () => {
    return (
        <div className="min-h-screen bg-gray-950 relative overflow-hidden">
            <BackgroundPattern />
            <div className='relative z-10 px-4 py-6 md:p-10'>
                <div className='grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-10'>
                    <div className="min-h-[50vh] lg:min-h-[80vh]">
                        <ChatView />
                    </div>
                    <div className='lg:col-span-3 min-h-[50vh] lg:min-h-[80vh]'>
                        <CodeView />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Workspace;
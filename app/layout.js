import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Provider from "./provider";
import ConvexClientProvider from "./ConvexClientProvider";


export const metadata = {
  title: "TechWiser – AI Website & App Builder",
  description:
    "TechWiser turns your ideas into production-ready React websites and web apps using AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning >
      <body>
        <ConvexClientProvider>
        <Provider>
        {children}
        </Provider>
        </ConvexClientProvider>
        
      </body>
    </html>
  );
}

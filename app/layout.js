import { Inter } from "next/font/google";
import "./globals.css";
import Provider from "./provider";
import ConvexClientProvider from "./ConvexClientProvider";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "TechWiser – AI Website & App Builder",
  description:
    "TechWiser turns your ideas into production-ready React websites and web apps using AI.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TechWiser",
  },
  themeColor: "#7c3aed",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <ConvexClientProvider>
          <Provider>
            {children}
          </Provider>
        </ConvexClientProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}

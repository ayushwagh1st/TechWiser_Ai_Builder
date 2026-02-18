/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: removeConsole was removed — logs are needed for debugging on Netlify/Vercel
  experimental: {
    optimizePackageImports: [
      "@codesandbox/sandpack-react",
      "lucide-react",
      "react-markdown",
    ],
  },
};

export default nextConfig;

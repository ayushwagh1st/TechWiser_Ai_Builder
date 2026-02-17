# Deployment Guide for TechWiser AI Builder

This guide covers how to deploy your TechWiser AI Builder application to production. Since this is a **Next.js** application with a **Convex** backend, the recommended hosting platform is **Vercel**, but it can also be deployed to Netlify or other platforms supporting Next.js.

## Prerequisites

1.  **GitHub Repository**: Push your code to a GitHub repository.
2.  **Convex Account**: Ensure you have a Convex account and your project is set up.

## Option 1: Deploying to Vercel (Recommended)

Vercel is the creators of Next.js and provides the best integration.

1.  **Create a Vercel Account**: Go to [vercel.com](https://vercel.com) and sign up/login.
2.  **Import Project**:
    *   Click "Add New..." -> "Project".
    *   Select your GitHub repository `TechWiser_Ai_Builder`.
3.  **Configure Project**:
    *   **Framework Preset**: Should automatically detect "Next.js".
    *   **Root Directory**: `./` (default).
4.  **Environment Variables**:
    *   You need to add your Convex deployment URL.
    *   Go to your local project, open `.env.local`.
    *   Copy `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT`.
    *   In Vercel project settings, paste these into the "Environment Variables" section.
    *   *Note*: For production, you should ideally use a Production deployment in Convex. Run `npx convex deploy` to get production credentials.
5.  **Deploy**: Click "Deploy".

### specific Convex Production Setup
For a true production setup:
1.  Run `npx convex deploy` in your terminal. This will push your Convex functions to a production environment.
2.  It will verify your schema and functions.
3.  Update the environment variables in Vercel with the *Production* URL provided by the command (it usually starts with `https://...`).

## Option 2: Deploying to Netlify

1.  **Create a Netlify Account**: Go to [netlify.com](https://netlify.com).
2.  **Import Project**:
    *   "Add new site" -> "Import an existing project".
    *   Connect GitHub and select your repo.
3.  **Build Settings**:
    *   **Build command**: `npm run build`
    *   **Publish directory**: `.next` (Netlify usually auto-detects Next.js and handles this via a plugin).
4.  **Environment Variables**:
    *   Go to "Site configuration" -> "Environment variables".
    *   Add `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT`.
5.  **Deploy**: Click "Deploy site".

## Post-Deployment Checks

1.  **Verify convex integration**: Open your live site link. Ensure data loads correctly.
2.  **Check Console**: Open browser developer tools (F12) to ensure no errors appear in the console.
3.  **Test AI Features**: Try generating a simple app to verify the AI API keys (if any are stored in env vars) work in production. Note: If you use API keys for AI services (OpenAI, Gemini, etc.), ensure those are also added to Vercel/Netlify environment variables!

## Important: API Keys

If your application uses `NEXT_PUBLIC_` keys for client-side AI calls (not recommended for security but common in prototypes), make sure they are added to Vercel/Netlify.

If you use server-side API calls (via Convex or Next.js API routes), add the non-prefixed keys (e.g., `OPENAI_API_KEY`) to the environment variables.

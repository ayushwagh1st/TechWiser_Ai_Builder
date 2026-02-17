import { NextResponse } from "next/server";

// Deploy generated project to Vercel (Lovable/Emergent style)
// Requires VERCEL_TOKEN and optionally VERCEL_TEAM_ID in .env.local
export async function POST(req) {
  try {
    const { files } = await req.json();
    const token = process.env.VERCEL_TOKEN;

    if (!token) {
      return NextResponse.json(
        {
          error:
            "Vercel deploy is not configured. Add VERCEL_TOKEN to .env.local (create one at vercel.com/account/tokens).",
        },
        { status: 400 }
      );
    }

    if (!files || typeof files !== "object") {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Build file list for Vercel: { [path]: content }
    const vercelFiles = {};
    for (const [path, content] of Object.entries(files)) {
      const cleanPath = path.startsWith("/") ? path.slice(1) : path;
      vercelFiles[cleanPath] = typeof content === "string" ? content : String(content);
    }

    // Ensure package.json exists for Vite/React
    if (!vercelFiles["package.json"]) {
      vercelFiles["package.json"] = JSON.stringify(
        {
          name: "techwiser-project",
          version: "1.0.0",
          private: true,
          type: "module",
          scripts: {
            dev: "vite",
            build: "vite build",
            preview: "vite preview",
          },
          dependencies: {
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            "react-router-dom": "^6.20.0",
            "lucide-react": "latest",
            "framer-motion": "^10.16.4",
            "tailwind-merge": "^2.4.0",
            clsx: "^2.0.0",
          },
          devDependencies: {
            vite: "^5.0.0",
            "@vitejs/plugin-react": "^4.2.0",
            tailwindcss: "^3.4.0",
            postcss: "^8.4.24",
            autoprefixer: "^10.4.14",
          },
        },
        null,
        2
      );
    }

    const teamId = process.env.VERCEL_TEAM_ID || undefined;

    // Vercel Create Deployment API (v13)
    const deployRes = await fetch(
      `https://api.vercel.com/v13/deployments${teamId ? `?teamId=${teamId}` : ""}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "techwiser-project",
          project: "techwiser-project",
          files: Object.entries(vercelFiles).map(([path, content]) => ({
            file: path,
            data: content,
          })),
          projectSettings: {
            framework: "vite",
            buildCommand: "npm run build",
            outputDirectory: "dist",
            installCommand: "npm install",
          },
          target: "production",
        }),
      }
    );

    const data = await deployRes.json();

    if (!deployRes.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || data.message || "Vercel deploy failed",
        },
        { status: deployRes.status }
      );
    }

    const url = data.url || data.readyState ? `https://${data.url || data.alias || "deploying"}` : null;
    return NextResponse.json({
      url: url || data.deployment?.url,
      deploymentId: data.id,
      message: "Deployment started. Your site will be live shortly.",
    });
  } catch (e) {
    console.error("Deploy error:", e);
    return NextResponse.json(
      { error: e.message || "Deploy failed" },
      { status: 500 }
    );
  }
}

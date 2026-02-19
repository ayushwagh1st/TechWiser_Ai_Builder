import { openRouterFilePlan, openRouterSingleFile, openRouterCodeStream } from "@/configs/AiModel";

// Vercel: allow up to 5 minutes
export const maxDuration = 300;

// ─── Utilities ───────────────────────────────────────────────────────

function sanitizeError(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'string') return 'Something went wrong. Please try again.';
  const l = rawMsg.toLowerCase();
  if (l.includes('rate limit') || l.includes('429') || l.includes('quota') || l.includes('busy')) return 'AI servers are busy. Please wait a moment and try again.';
  if (l.includes('timeout') || l.includes('timed out') || l.includes('abort')) return 'Request took too long. Retrying...';
  if (l.includes('network') || l.includes('fetch failed')) return 'Network error. Please check your connection.';
  if (l.includes('api key')) return 'AI service is not configured.';
  return 'Something went wrong. Please try again.';
}

function extractJson(text) {
  if (!text) return null;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) { }
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m?.[1]) { try { return JSON.parse(m[1].trim()); } catch (_) { } }
  const f = cleaned.indexOf('{'), l = cleaned.lastIndexOf('}');
  if (f !== -1 && l > f) { try { return JSON.parse(cleaned.slice(f, l + 1)); } catch (_) { } }
  // Fix common JSON issues
  try {
    let fix = cleaned.slice(f, l + 1);
    fix = fix.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    return JSON.parse(fix);
  } catch (_) { }
  return null;
}

function cleanCodeResponse(text) {
  if (!text) return '';
  // Remove markdown fences
  let code = text.replace(/^```(?:jsx?|javascript|typescript|tsx?|css|html)?\s*\n?/gm, '');
  code = code.replace(/\n?```\s*$/gm, '');
  // Remove <think> blocks
  code = code.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Remove "Here is the code:" prefixes
  code = code.replace(/^(?:Here(?:'s| is) (?:the|your) (?:code|file|content).*?:\s*\n)/i, '');
  return code.trim();
}

// ─── Phase 1: Get File Plan ─────────────────────────────────────────

async function getFilePlan(messages, currentFilePaths, sendUpdate) {
  const MAX_PLAN_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_PLAN_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        sendUpdate({ phase: 'planning', status: `Planning (retry ${attempt + 1})...` });
        await new Promise(r => setTimeout(r, 2000));
      }
      sendUpdate({ phase: 'planning', status: 'Planning your project...' });

      const raw = await openRouterFilePlan(messages, currentFilePaths);
      console.log(`[Phase1] Plan response: ${raw.length} chars`);

      const plan = extractJson(raw);
      if (plan?.files && Array.isArray(plan.files) && plan.files.length > 0) {
        // Validate file entries
        const validFiles = plan.files.filter(f => f.path && f.description);
        if (validFiles.length > 0) {
          // Ensure /App.js and /index.css exist
          if (!validFiles.find(f => f.path === '/App.js')) {
            validFiles.unshift({ path: '/App.js', description: 'Main app component with layout and routing' });
          }
          if (!validFiles.find(f => f.path === '/index.css')) {
            validFiles.push({ path: '/index.css', description: 'Global styles with CSS variables' });
          }
          console.log(`[Phase1] ✓ Plan has ${validFiles.length} files`);
          return { projectTitle: plan.projectTitle || 'Generated Project', files: validFiles };
        }
      }

      console.warn(`[Phase1] Attempt ${attempt + 1}: could not parse plan from response`);
    } catch (e) {
      console.warn(`[Phase1] Attempt ${attempt + 1} error: ${e.message?.slice(0, 150)}`);
    }
  }

  // Fallback: return a sensible default plan
  console.log('[Phase1] Using fallback plan');
  return {
    projectTitle: 'Generated Project',
    files: [
      { path: '/App.js', description: 'Main app component with layout' },
      { path: '/index.css', description: 'Global styles with CSS variables and Tailwind utilities' },
    ]
  };
}

// ─── Phase 2: Generate Files One by One ─────────────────────────────

async function generateFiles(plan, userRequest, sendUpdate) {
  const CONCURRENCY = 1; // Serial execution to avoid rate limits (20 RPM on free tier)
  const MAX_FILE_RETRIES = 4; // Increased retries
  const fileResults = {};
  const totalFiles = plan.files.length;

  // Process files sequentially
  for (let i = 0; i < totalFiles; i++) {
    const { path, description } = plan.files[i];

    sendUpdate({
      phase: 'generating',
      status: `Generating ${path} (${i + 1}/${totalFiles})...`,
      currentFile: path,
      progress: i,
      total: totalFiles,
    });

    // Rate limit buffer: wait 1s between files
    if (i > 0) await new Promise(r => setTimeout(r, 1000));

    let fileContent = null;
    let lastError = null;

    for (let retry = 0; retry < MAX_FILE_RETRIES; retry++) {
      try {
        if (retry > 0) {
          console.log(`[Phase2] Retrying ${path} (attempt ${retry + 1})`);
          // Exponential backoff: 2s, 4s, 8s
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, retry)));
        }

        const rawCode = await openRouterSingleFile(userRequest, path, description, plan.files);
        const code = cleanCodeResponse(rawCode);

        if (code && code.length > 10) {
          console.log(`[Phase2] ✓ ${path}: ${code.length} chars`);
          fileContent = code;
          break;
        } else {
          lastError = "Response too short";
          console.warn(`[Phase2] ${path}: response too short (${code?.length || 0} chars)`);
        }
      } catch (e) {
        lastError = e.message;
        console.warn(`[Phase2] ${path} attempt ${retry + 1} error: ${e.message?.slice(0, 100)}`);
      }
    }

    if (fileContent) {
      fileResults[path] = { code: fileContent };
    } else {
      // If all retries failed, generate a placeholder
      console.warn(`[Phase2] ✗ ${path}: all retries failed (${lastError}), using placeholder`);
      const ext = path.split('.').pop();
      if (ext === 'css') {
        fileResults[path] = { code: `/* ${description} */\n:root {\n  --primary: #6366f1;\n  --background: #0a0a0a;\n}\nbody { margin: 0; font-family: 'Inter', sans-serif; background: var(--background); color: #fff; }` };
      } else {
        fileResults[path] = {
          code: `import React from 'react';\n\n// Failed to generate: ${path}\n// Error: ${lastError}\n// Description: ${description}\n\nexport default function ${path.split('/').pop().replace(/\..*$/, '').replace(/[^a-zA-Z0-9]/g, '')}() {\n  return (\n    <div className="p-8 text-center border border-red-500/20 rounded-lg bg-red-500/5">\n      <h3 className="text-lg font-bold text-red-400">Generation Failed</h3>\n      <p className="text-zinc-400 mt-2">Could not generate {path} after multiple attempts.</p>\n      <p className="text-xs text-zinc-500 mt-4 font-mono">{lastError}</p>\n      <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-zinc-800 rounded hover:bg-zinc-700 text-sm">Reload to Retry</button>\n    </div>\n  );\n}`
        };
      }
    }
  }

  return fileResults;
}

// ─── Phase 3 (Legacy Fallback): Monolithic Generation ───────────────

function fixBadEscapes(text) {
  let result = '', inString = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!inString) { if (ch === '"') inString = true; result += ch; i++; }
    else {
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined) { i++; continue; }
        if ('"\\/bfnrt'.includes(next)) { result += ch + next; i += 2; }
        else if (next === 'u') { result += text.slice(i, i + 6); i += 6; }
        else { result += '\\\\' + next; i += 2; }
      } else if (ch === '"') { inString = false; result += ch; i++; }
      else if (ch === '\n') { result += '\\n'; i++; }
      else if (ch === '\r') { result += '\\r'; i++; }
      else if (ch === '\t') { result += '\\t'; i++; }
      else { result += ch; i++; }
    }
  }
  return result;
}

function tryParseLegacy(fullText) {
  try {
    const codeResult = extractJson(fullText);
    if (codeResult?.files && typeof codeResult.files === 'object') return codeResult;
    // Try fix bad escapes
    let cleaned = fullText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const f = cleaned.indexOf('{'), l = cleaned.lastIndexOf('}');
    if (f !== -1 && l > f) {
      cleaned = cleaned.slice(f, l + 1);
      try { return JSON.parse(fixBadEscapes(cleaned)); } catch (_) { }
    }
  } catch (_) { }
  return null;
}

// ─── Main Handler ────────────────────────────────────────────────────

export async function POST(req) {
  try {
    const { messages, currentFilePaths, includeSupabase, deployToVercel } = await req.json();
    const msgs = Array.isArray(messages) ? messages : [];
    const paths = Array.isArray(currentFilePaths) ? currentFilePaths : [];

    // Build user request string from last user message
    const lastUserMsg = msgs.filter(m => m.role === 'user').pop();
    const userRequest = lastUserMsg?.content || 'Create a web application';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (data) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
          catch (_) { closed = true; }
        };
        const close = () => { if (!closed) { try { controller.close(); } catch (_) { } closed = true; } };

        // Keepalive every 12s
        const keepalive = setInterval(() => send({ ping: true }), 12_000);

        try {
          // ────────────────────────────────────────────
          // STRATEGY: Try phased generation first.
          // If it fails completely, fall back to legacy monolithic.
          // ────────────────────────────────────────────

          let files = null;
          let projectTitle = 'Generated Project';

          // ── PHASED GENERATION (Primary) ────────────
          try {
            send({ phase: 'planning', status: 'Planning your project structure...' });

            // Phase 1: Plan
            const plan = await getFilePlan(msgs, paths, send);
            projectTitle = plan.projectTitle || 'Generated Project';
            console.log(`[Route] Plan: ${plan.files.map(f => f.path).join(', ')}`);

            send({
              phase: 'planned',
              status: `Project planned: ${plan.files.length} files`,
              plan: plan.files.map(f => f.path),
              total: plan.files.length,
            });

            // Phase 2: Generate each file
            files = await generateFiles(plan, userRequest, send);

            const fileCount = Object.keys(files).length;
            if (fileCount > 0) {
              console.log(`[Route] ✓ Phased generation: ${fileCount} files`);
            } else {
              throw new Error('No files generated');
            }
          } catch (phasedError) {
            console.warn(`[Route] Phased generation failed: ${phasedError.message}`);
            send({ phase: 'fallback', status: 'Trying alternative approach...' });

            // ── LEGACY FALLBACK (Monolithic) ────────────
            try {
              const textStream = await openRouterCodeStream(msgs, paths, { includeSupabase, deployToVercel });
              let fullText = '';
              for await (const delta of textStream) {
                if (delta) fullText += delta;
              }
              const parsed = tryParseLegacy(fullText);
              if (parsed?.files) {
                files = parsed.files;
                projectTitle = parsed.projectTitle || projectTitle;
                console.log(`[Route] ✓ Legacy fallback: ${Object.keys(files).length} files`);
              }
            } catch (legacyError) {
              console.error(`[Route] Legacy fallback also failed: ${legacyError.message}`);
            }
          }

          if (files && Object.keys(files).length > 0) {
            send({
              phase: 'done',
              status: 'Project generated successfully!',
              final: { projectTitle, files, explanation: `Generated ${Object.keys(files).length} files` },
              done: true,
            });
          } else {
            send({
              error: 'Could not generate code. Please try again — AI servers may be overloaded.',
              done: true,
            });
          }

          clearInterval(keepalive);
          close();
        } catch (e) {
          clearInterval(keepalive);
          console.error('[Route] Fatal:', e);
          send({ error: sanitizeError(e.message), done: true });
          close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Server error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

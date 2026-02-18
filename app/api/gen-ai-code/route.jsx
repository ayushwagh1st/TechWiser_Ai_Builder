import { openRouterCodeStream } from "@/configs/AiModel";

// Vercel: allow up to 5 minutes for code generation
export const maxDuration = 300;

/**
 * Sanitize error messages — never leak internal details to users.
 */
function sanitizeError(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'string') return 'Something went wrong. Please try again.';
  const lower = rawMsg.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota') || lower.includes('exceeded') || lower.includes('temporarily')) {
    return 'Our AI servers are busy right now. Please wait a moment and try again.';
  }
  if (lower.includes('credit') || lower.includes('insufficient') || lower.includes('billing')) {
    return 'Our AI servers are temporarily unavailable. Please try again shortly.';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline') || lower.includes('abort')) {
    return 'The request took too long. Retrying with a different AI model...';
  }
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch failed')) {
    return 'Network error — please check your connection and try again.';
  }
  if (lower.includes('json') || lower.includes('parse')) {
    return 'The AI response was malformed. Retrying...';
  }
  if (lower.includes('no openrouter') || lower.includes('api key')) {
    return 'AI service is not configured. Please contact the administrator.';
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Fix bad escape sequences that AI models produce inside JSON strings.
 */
function fixBadEscapes(text) {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') inString = true;
      result += ch;
      i++;
    } else {
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined) { i++; continue; }
        if ('"\\/bfnrt'.includes(next)) {
          result += ch + next; i += 2;
        } else if (next === 'u') {
          result += text.slice(i, i + 6); i += 6;
        } else {
          result += '\\\\' + next; i += 2;
        }
      } else if (ch === '"') {
        inString = false; result += ch; i++;
      } else if (ch === '\n') {
        result += '\\n'; i++;
      } else if (ch === '\r') {
        result += '\\r'; i++;
      } else if (ch === '\t') {
        result += '\\t'; i++;
      } else {
        result += ch; i++;
      }
    }
  }
  return result;
}

function extractJson(text) {
  if (!text) return null;

  // Remove <think>...</think> blocks (DeepSeek R1)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  try { return JSON.parse(cleaned); } catch (_) { }

  // Try markdown json block
  const jsonMatch = cleaned.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch?.[1]) {
    cleaned = jsonMatch[1].trim();
    try { return JSON.parse(cleaned); } catch (_) { }
  }

  // Extract from first '{' to last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(cleaned); } catch (_) { }
  }

  // Fix bad escapes
  try { return JSON.parse(fixBadEscapes(cleaned)); } catch (_) { }

  // Progressive cleanup
  try {
    let fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    fixed = fixed.replace(/\/\/[^\n]*/g, '');
    fixed = fixBadEscapes(fixed);
    return JSON.parse(fixed);
  } catch (_) { }

  // Truncated-JSON recovery
  try {
    let attempt = fixBadEscapes(cleaned);
    attempt = attempt.replace(/,\s*$/g, '');
    let opens = 0, openBrackets = 0;
    for (const ch of attempt) {
      if (ch === '{') opens++;
      else if (ch === '}') opens--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }
    if (attempt.match(/:\s*"[^"]*$/)) attempt += '"';
    while (openBrackets > 0) { attempt += ']'; openBrackets--; }
    while (opens > 0) { attempt += '}'; opens--; }
    return JSON.parse(attempt);
  } catch (e) {
    console.warn(`extractJson: all attempts failed (${cleaned.length} chars):`, e.message);
  }

  return cleaned;
}

function tryParseCodeResult(fullText) {
  try {
    const codeResult = extractJson(fullText);
    let parsedData;
    if (codeResult && typeof codeResult === "object") {
      parsedData = codeResult;
    } else if (typeof codeResult === "string") {
      parsedData = JSON.parse(codeResult);
    } else {
      return null;
    }

    if (parsedData?.files && typeof parsedData.files === "object") {
      return parsedData;
    }

    // Fallback: files at top level
    const keys = Object.keys(parsedData || {});
    if (keys.length > 0 && keys.some(k => k.startsWith('/')) && keys.some(k => parsedData[k]?.code)) {
      return { files: parsedData, projectTitle: "Generated Project", explanation: "" };
    }

    return null;
  } catch (e) {
    console.warn("tryParseCodeResult failed:", e.message);
    return null;
  }
}

function extractFilesFromRawText(fullText) {
  try {
    const filesIdx = fullText.indexOf('"files"');
    if (filesIdx === -1) return null;

    const colonIdx = fullText.indexOf(':', filesIdx + 7);
    if (colonIdx === -1) return null;

    const braceIdx = fullText.indexOf('{', colonIdx);
    if (braceIdx === -1) return null;

    let depth = 0, end = -1;
    for (let i = braceIdx; i < fullText.length; i++) {
      if (fullText[i] === '{') depth++;
      else if (fullText[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;

    const filesStr = fullText.slice(braceIdx, end + 1);
    const files = JSON.parse(fixBadEscapes(filesStr));

    if (typeof files === 'object' && Object.keys(files).length > 0) {
      return { files, projectTitle: "Generated Project", explanation: "" };
    }
  } catch (e) {
    console.warn("extractFilesFromRawText failed:", e.message);
  }
  return null;
}

export async function POST(req) {
  const MAX_CODE_RETRIES = 4; // Increased from 3

  try {
    const { messages, currentFilePaths, includeSupabase, deployToVercel } = await req.json();
    const msgs = Array.isArray(messages) ? messages : [];
    const paths = Array.isArray(currentFilePaths) ? currentFilePaths : [];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeSend = (data) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
          catch (_) { closed = true; }
        };
        const safeClose = () => {
          if (closed) return;
          try { controller.close(); } catch (_) { }
          closed = true;
        };

        // Keepalive: send a ping every 15s to prevent Vercel/proxy from killing idle connection
        const keepalive = setInterval(() => {
          safeSend({ ping: true, timestamp: Date.now() });
        }, 15_000);

        try {
          let parsedData = null;
          let lastError = null;

          for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
            const isFirstAttempt = attempt === 0;

            if (!isFirstAttempt) {
              // Progressive backoff: 3s, 5s, 8s
              const delay = [3000, 5000, 8000][attempt - 1] || 5000;
              await new Promise(resolve => setTimeout(resolve, delay));
              console.log(`[CodeGen] Retry ${attempt + 1}/${MAX_CODE_RETRIES} (waited ${delay}ms)`);
              safeSend({
                chunk: `\n\n⏳ Attempt ${attempt + 1}/${MAX_CODE_RETRIES} — trying a different AI model...\n`,
                retry: attempt + 1,
                maxRetries: MAX_CODE_RETRIES,
              });
            }

            try {
              const textStream = await openRouterCodeStream(msgs, paths, {
                includeSupabase: !!includeSupabase,
                deployToVercel: !!deployToVercel,
              });

              let fullText = "";
              let chunkCount = 0;
              for await (const delta of textStream) {
                if (!delta) continue;
                fullText += delta;
                chunkCount++;
                // Only stream to client on first attempt
                if (isFirstAttempt) {
                  safeSend({ chunk: delta });
                }
                // On retries, send periodic progress so client knows we're alive
                if (!isFirstAttempt && chunkCount % 50 === 0) {
                  safeSend({ progress: fullText.length, retry: attempt + 1 });
                }
              }

              console.log(`[CodeGen] Attempt ${attempt + 1}: received ${fullText.length} chars, ${chunkCount} chunks`);

              // Try to parse
              parsedData = tryParseCodeResult(fullText);
              if (!parsedData) {
                parsedData = extractFilesFromRawText(fullText);
              }

              if (parsedData) {
                const fileCount = Object.keys(parsedData.files || {}).length;
                console.log(`[CodeGen] ✓ Success on attempt ${attempt + 1}: ${fileCount} files`);
                safeSend({ final: parsedData, done: true, result: fullText });
                break;
              } else {
                lastError = "Failed to parse AI response as valid code JSON";
                console.warn(`[CodeGen] Attempt ${attempt + 1}: parse failed from ${fullText.length} chars`);
                console.warn(`[CodeGen] Preview: ${fullText.slice(0, 500)}`);
              }
            } catch (e) {
              lastError = e.message || "Code generation failed";
              console.warn(`[CodeGen] Attempt ${attempt + 1} error: ${lastError.slice(0, 200)}`);
            }
          }

          if (!parsedData) {
            console.error("[CodeGen] All attempts failed:", lastError);
            safeSend({
              error: sanitizeError(lastError),
              rawError: lastError,
              done: true,
            });
          }

          clearInterval(keepalive);
          safeClose();
        } catch (e) {
          clearInterval(keepalive);
          console.error("[CodeGen] Fatal stream error:", e);
          safeSend({
            error: sanitizeError(e.message),
            rawError: e.message,
            done: true,
          });
          safeClose();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: e.message || "Code generation failed",
        rawError: e.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

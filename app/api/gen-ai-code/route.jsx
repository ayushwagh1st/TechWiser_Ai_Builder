import { openRouterPlanStream, openRouterCodeStream } from "@/configs/AiModel";

/**
 * Sanitize error messages so no internal details leak to the user.
 * Strips provider names, API key references, HTTP codes, raw metadata, URLs, etc.
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
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) {
    return 'The request took too long. Please try again with a simpler prompt.';
  }
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch failed')) {
    return 'Network error — please check your connection and try again.';
  }
  if (lower.includes('json') || lower.includes('parse')) {
    return 'The AI response was malformed. Please try again.';
  }
  // Generic fallback — never pass raw error through
  return 'Something went wrong. Please try again.';
}

/**
 * Fix bad escape sequences that AI models produce inside JSON strings.
 * AI models often output literal backslash + char combos (like \' or \a)
 * that are not valid JSON escape sequences.
 * Valid JSON escapes: \" \\ \/ \b \f \n \r \t \uXXXX
 */
function fixBadEscapes(text) {
  // Fix invalid escape sequences inside JSON string values.
  // Walk through the text character by character to only fix escapes inside strings.
  let result = '';
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      result += ch;
      i++;
    } else {
      // Inside a JSON string
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined) {
          // Trailing backslash at end—remove it
          i++;
          continue;
        }
        // Valid JSON escapes
        if ('"\\\/bfnrt'.includes(next)) {
          result += ch + next;
          i += 2;
        } else if (next === 'u') {
          // Unicode escape: must be \uXXXX
          result += text.slice(i, i + 6);
          i += 6;
        } else {
          // Invalid escape — double the backslash so it becomes literal
          result += '\\\\' + next;
          i += 2;
        }
      } else if (ch === '"') {
        inString = false;
        result += ch;
        i++;
      } else if (ch === '\n') {
        // Literal newlines inside JSON strings are invalid — escape them
        result += '\\n';
        i++;
      } else if (ch === '\r') {
        result += '\\r';
        i++;
      } else if (ch === '\t') {
        result += '\\t';
        i++;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

function extractJson(text) {
  if (!text) return null;

  // 1. Remove <think>...</think> blocks common in reasoning models (DeepSeek R1)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // 2. Try raw parse first — if the model gave perfect JSON, use it
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }

  // 3. Try to find markdown json/jsonc block
  const jsonMatch = cleaned.match(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    cleaned = jsonMatch[1].trim();
    try { return JSON.parse(cleaned); } catch (_) { /* continue */ }
  }

  // 4. Extract from first '{' to last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(cleaned); } catch (_) { /* continue */ }
  }

  // 5. Fix bad escape sequences (most common AI failure mode)
  try {
    const escaped = fixBadEscapes(cleaned);
    return JSON.parse(escaped);
  } catch (_) { /* continue */ }

  // 6. Progressive cleanup attempts
  try {
    let fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    fixed = fixed.replace(/\/\/[^\n]*/g, ''); // Remove single-line comments
    fixed = fixBadEscapes(fixed);
    return JSON.parse(fixed);
  } catch (_) { /* continue */ }

  // 7. Truncated-JSON recovery — try closing unclosed braces/brackets
  try {
    let attempt = fixBadEscapes(cleaned);
    attempt = attempt.replace(/,\s*$/g, ''); // remove trailing comma
    let opens = 0, openBrackets = 0;
    for (const ch of attempt) {
      if (ch === '{') opens++;
      else if (ch === '}') opens--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }
    if (attempt.match(/:\s*"[^"]*$/)) {
      attempt += '"';
    }
    while (openBrackets > 0) { attempt += ']'; openBrackets--; }
    while (opens > 0) { attempt += '}'; opens--; }
    return JSON.parse(attempt);
  } catch (e) {
    console.warn(`extractJson: all recovery attempts failed (length=${cleaned.length}):`, e.message);
  }

  // 8. Last resort — return the cleaned string and let caller handle parse error
  return cleaned;
}

/**
 * Collect stream text from an async iterable and call safeSend for each chunk.
 */
async function collectStream(streamIterable, safeSend) {
  let fullText = "";
  for await (const delta of streamIterable) {
    if (!delta) continue;
    fullText += delta;
    safeSend({ chunk: delta });
  }
  return fullText;
}

/**
 * Try to parse fullText into a valid code-gen result. Returns parsed object or null.
 */
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
    // Validate that it has the expected shape (must have "files" key)
    if (parsedData && parsedData.files && typeof parsedData.files === "object") {
      return parsedData;
    }
    return null;
  } catch (e) {
    console.warn("tryParseCodeResult failed:", e.message);
    return null;
  }
}

export const maxDuration = 300; // Allow up to 5 minutes for generation

export async function POST(req) {
  const MAX_CODE_RETRIES = 3; // Total attempts for code generation

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

        try {
          // Phase 1: Planning (thinking phase)
          let buildPlan = null;
          try {
            let planText = "";
            const planStream = await openRouterPlanStream(msgs);
            for await (const delta of planStream) {
              if (delta) planText += delta;
            }
            const planResult = extractJson(planText);
            if (planResult && typeof planResult === "object") {
              buildPlan = planResult;
            } else if (typeof planResult === "string") {
              buildPlan = JSON.parse(planResult);
            }
          } catch (e) {
            console.warn("Planning phase failed (non-fatal):", e.message);
            buildPlan = null;
          }

          // Phase 2: Code generation with retry on parse failure
          let parsedData = null;
          let lastError = null;

          for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
            if (attempt > 0) {
              console.log(`[Retry] Code generation attempt ${attempt + 1}/${MAX_CODE_RETRIES} — previous attempt had bad JSON`);
              safeSend({ chunk: "\n\n⏳ Retrying with another model...\n" });
            }

            try {
              const textStream = await openRouterCodeStream(msgs, paths, {
                buildPlan,
                includeSupabase: !!includeSupabase,
                deployToVercel: !!deployToVercel,
              });

              const fullText = await collectStream(textStream, safeSend);
              parsedData = tryParseCodeResult(fullText);

              if (parsedData) {
                // Success! Send final data
                safeSend({ final: parsedData, done: true, result: fullText });
                break;
              } else {
                lastError = "Failed to parse AI response as JSON";
                console.warn(`[Retry] Attempt ${attempt + 1} failed: could not parse JSON from ${fullText.length} chars`);
              }
            } catch (e) {
              lastError = e.message || "Code generation failed";
              console.warn(`[Retry] Attempt ${attempt + 1} stream error:`, lastError);
            }
          }

          if (!parsedData) {
            console.error("All code generation attempts failed:", lastError);
            safeSend({
              error: sanitizeError(lastError),
              rawError: lastError, // Debug info for frontend
              done: true,
            });
          }

          safeClose();
        } catch (e) {
          console.error("Stream Error:", e);
          safeSend({
            error: sanitizeError(e.message),
            rawError: e.message // Debug info for frontend
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
        rawError: e.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

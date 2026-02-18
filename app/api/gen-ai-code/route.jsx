import { openRouterCodeStream } from "@/configs/AiModel";

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
 * Try to parse fullText into a valid code-gen result. Returns parsed object or null.
 * Now includes a fallback that extracts just the "files" subtree if the outer JSON is broken.
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

    // Fallback: maybe the AI returned files at the top level without wrapper
    // Check if parsedData looks like a files map (keys start with "/" and values have "code")
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

/**
 * Last-resort extraction: find "files" key in raw text and try to parse just that subtree.
 */
function extractFilesFromRawText(fullText) {
  try {
    // Find "files" : { and extract from there
    const filesIdx = fullText.indexOf('"files"');
    if (filesIdx === -1) return null;

    // Find the opening brace after "files" :
    const colonIdx = fullText.indexOf(':', filesIdx + 7);
    if (colonIdx === -1) return null;

    const braceIdx = fullText.indexOf('{', colonIdx);
    if (braceIdx === -1) return null;

    // Find matching closing brace
    let depth = 0;
    let end = -1;
    for (let i = braceIdx; i < fullText.length; i++) {
      if (fullText[i] === '{') depth++;
      else if (fullText[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;

    const filesStr = fullText.slice(braceIdx, end + 1);
    const fixed = fixBadEscapes(filesStr);
    const files = JSON.parse(fixed);

    if (typeof files === 'object' && Object.keys(files).length > 0) {
      return { files, projectTitle: "Generated Project", explanation: "" };
    }
  } catch (e) {
    console.warn("extractFilesFromRawText failed:", e.message);
  }
  return null;
}

export const maxDuration = 300; // Allow up to 5 minutes for generation

export async function POST(req) {
  const MAX_CODE_RETRIES = 3;

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
          // Code generation with retry on parse failure
          // IMPORTANT: Only stream chunks on first attempt.
          // On retries, collect silently to avoid sending duplicate/mixed text to client.
          let parsedData = null;
          let lastError = null;

          for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
            const isFirstAttempt = attempt === 0;

            if (!isFirstAttempt) {
              // Wait 3s before retry to let rate limits cool down
              await new Promise(resolve => setTimeout(resolve, 3000));
              console.log(`[Retry] Code generation attempt ${attempt + 1}/${MAX_CODE_RETRIES}`);
              safeSend({ chunk: "\n\n⏳ Retrying code generation...\n" });
            }

            try {
              const textStream = await openRouterCodeStream(msgs, paths, {
                includeSupabase: !!includeSupabase,
                deployToVercel: !!deployToVercel,
              });

              // Collect the stream
              let fullText = "";
              for await (const delta of textStream) {
                if (!delta) continue;
                fullText += delta;
                // Only stream raw chunks to client on first attempt
                if (isFirstAttempt) {
                  safeSend({ chunk: delta });
                }
              }

              // Try to parse
              parsedData = tryParseCodeResult(fullText);

              // Last-resort: extract just the files subtree
              if (!parsedData) {
                parsedData = extractFilesFromRawText(fullText);
              }

              if (parsedData) {
                safeSend({ final: parsedData, done: true, result: fullText });
                break;
              } else {
                lastError = "Failed to parse AI response as valid code JSON";
                console.warn(`[Retry] Attempt ${attempt + 1} failed: could not parse JSON from ${fullText.length} chars`);
                // Log first 500 chars for debugging
                console.warn(`[Retry] Response preview: ${fullText.slice(0, 500)}`);
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
              rawError: lastError,
              done: true,
            });
          }

          safeClose();
        } catch (e) {
          console.error("Stream Error:", e);
          safeSend({
            error: sanitizeError(e.message),
            rawError: e.message
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

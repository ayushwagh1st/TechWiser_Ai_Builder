/**
 * AiModel.jsx — Production-ready OpenRouter integration (v2 — bulletproof)
 *
 * Key improvements over v1:
 *   • Per-model streaming timeout (90s) — if a model hangs, skip to next
 *   • No warmup probing — cold start is instant, models tried on-demand
 *   • Smarter model ordering — fastest/most-reliable models first
 *   • Aggressive failover across all key×model combos
 *   • AbortController-based timeouts on every streaming call
 */

import Prompt from "@/data/Prompt";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const siteName = "TechWiser";

// --- Multi-Key Pool --------------------------------------------------

function collectApiKeys() {
  const keys = [];
  if (process.env.OPENROUTER_API_KEY) keys.push(process.env.OPENROUTER_API_KEY);
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`OPENROUTER_API_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return keys;
}

const API_KEYS = collectApiKeys();

if (API_KEYS.length === 0) {
  console.warn("[TechWiser] ⚠ No OPENROUTER_API_KEY found. AI will not work.");
} else {
  console.log(`[TechWiser] Loaded ${API_KEYS.length} OpenRouter API key(s)`);
}

// --- Key Health Tracking ---------------------------------------------

const keyStatus = API_KEYS.map(() => ({ exhausted: false, exhaustedAt: 0, failCount: 0 }));
const COOLDOWN_MS = 3 * 60 * 1000; // 3 min cooldown (reduced from 5)
const EXHAUST_THRESHOLD = 3;

function getActiveKeyIndex() {
  const now = Date.now();
  for (let i = 0; i < API_KEYS.length; i++) {
    if (!keyStatus[i].exhausted) return i;
    if (now - keyStatus[i].exhaustedAt > COOLDOWN_MS) {
      keyStatus[i].exhausted = false;
      keyStatus[i].failCount = 0;
      return i;
    }
  }
  // All exhausted — reset oldest
  let oldest = 0;
  for (let i = 1; i < keyStatus.length; i++) {
    if (keyStatus[i].exhaustedAt < keyStatus[oldest].exhaustedAt) oldest = i;
  }
  keyStatus[oldest].exhausted = false;
  keyStatus[oldest].failCount = 0;
  return oldest;
}

function markKeyExhausted(idx) {
  keyStatus[idx].failCount++;
  if (keyStatus[idx].failCount >= EXHAUST_THRESHOLD) {
    keyStatus[idx].exhausted = true;
    keyStatus[idx].exhaustedAt = Date.now();
    console.log(`[Keys] Key #${idx + 1} marked exhausted after ${keyStatus[idx].failCount} failures`);
  }
}

function resetKeyFailCount(idx) {
  keyStatus[idx].failCount = 0;
}

function isRateLimitError(status, body) {
  if (status === 429 || status === 402) return true;
  const msg = (typeof body === "string" ? body : JSON.stringify(body || "")).toLowerCase();
  if (msg.includes("rate limit") && !msg.includes("model")) return true;
  if (msg.includes("credits") && (msg.includes("insufficient") || msg.includes("exhausted"))) return true;
  if (msg.includes("quota") && (msg.includes("exceeded") || msg.includes("exhausted"))) return true;
  if (msg.includes("billing") || msg.includes("payment required")) return true;
  return false;
}

// --- Model Lists (ordered by reliability for code generation) --------

const MODELS = [
  "deepseek/deepseek-chat-v3-0324:free",      // Fast, good at code
  "deepseek/deepseek-r1-0528:free",            // Reasoning model, slower but better quality
  "mistralai/devstral-2512:free",              // Code-focused
  "meta-llama/llama-3.3-70b-instruct:free",    // Reliable fallback
  "google/gemini-2.0-flash-exp:free",          // Fast
  "google/gemma-3-27b-it:free",
  "stepfun/step-3.5-flash:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
];

const PLANNING_MODELS = [
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "stepfun/step-3.5-flash:free",
];

// --- Per-Model Timeout Tracking --------------------------------------
// Track which models recently failed so we skip them on subsequent attempts

const modelHealth = new Map(); // model -> { lastFail: timestamp, consecutiveFails: number }

function isModelHealthy(model) {
  const health = modelHealth.get(model);
  if (!health) return true;
  // If model failed recently (last 2 min) and has 2+ consecutive fails, skip it
  if (health.consecutiveFails >= 2 && Date.now() - health.lastFail < 2 * 60 * 1000) {
    return false;
  }
  return true;
}

function markModelFailed(model) {
  const health = modelHealth.get(model) || { lastFail: 0, consecutiveFails: 0 };
  health.lastFail = Date.now();
  health.consecutiveFails++;
  modelHealth.set(model, health);
}

function markModelSuccess(model) {
  modelHealth.set(model, { lastFail: 0, consecutiveFails: 0 });
}

// --- Core: Streaming fetch with per-model timeout --------------------

const PER_MODEL_TIMEOUT_MS = 90_000;      // 90s per model attempt
const FIRST_CHUNK_TIMEOUT_MS = 30_000;     // 30s to get first chunk (or model is dead)

async function* streamChatRaw(apiKey, model, messages, options = {}) {
  const controller = new AbortController();

  // Overall per-model timeout
  const overallTimer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);

  try {
    const body = { model, messages, stream: true };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      err.status = res.status;
      err.body = errBody;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let gotFirstChunk = false;

    // First-chunk timeout: if no data in 30s, model is stuck
    let firstChunkTimer = setTimeout(() => {
      if (!gotFirstChunk) controller.abort();
    }, FIRST_CHUNK_TIMEOUT_MS);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!gotFirstChunk) {
        gotFirstChunk = true;
        clearTimeout(firstChunkTimer);
      }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch (_) { }
      }
    }
  } finally {
    clearTimeout(overallTimer);
  }
}

async function chatCompletionRaw(apiKey, model, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // 60s for non-streaming

  try {
    const res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      err.status = res.status;
      err.body = errBody;
      throw err;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

// --- Fallback Engine (no warmup needed) ------------------------------

/**
 * Build all key×model combos, skip unhealthy models/keys.
 */
function getOrderedCombos(models) {
  const combos = [];
  for (const model of models) {
    if (!isModelHealthy(model)) {
      console.log(`[AI] Skipping temporarily unhealthy model: ${model}`);
      continue;
    }
    for (let keyIdx = 0; keyIdx < API_KEYS.length; keyIdx++) {
      combos.push({ keyIdx, model });
    }
  }

  // If all models were unhealthy, try them all anyway (last resort)
  if (combos.length === 0) {
    console.warn("[AI] All models unhealthy — trying everything");
    for (const model of models) {
      for (let keyIdx = 0; keyIdx < API_KEYS.length; keyIdx++) {
        combos.push({ keyIdx, model });
      }
    }
  }

  return combos;
}

/**
 * Try key×model combos until one works. Per-model timeout ensures
 * we never wait more than 90s for a single model.
 */
async function callWithFallback(messages, models, streamOptions = {}) {
  if (API_KEYS.length === 0) {
    throw new Error("No OpenRouter API keys configured. Set OPENROUTER_API_KEY in environment variables.");
  }

  const combos = getOrderedCombos(models);
  let lastError;
  let attemptCount = 0;

  for (const { keyIdx, model } of combos) {
    if (keyStatus[keyIdx].exhausted) continue;
    attemptCount++;

    try {
      console.log(`[AI] Attempt ${attemptCount}: Key #${keyIdx + 1} → ${model}`);
      const gen = streamChatRaw(API_KEYS[keyIdx], model, messages, streamOptions);

      // Probe first chunk to verify stream works
      const reader = gen[Symbol.asyncIterator]();
      const first = await reader.next();

      if (first.done) {
        throw new Error("Empty response (stream ended immediately)");
      }

      async function* replayStream() {
        yield first.value;
        while (true) {
          const { value, done } = await reader.next();
          if (done) break;
          yield value;
        }
      }

      console.log(`[AI] ✓ Key #${keyIdx + 1} → ${model}`);
      resetKeyFailCount(keyIdx);
      markModelSuccess(model);
      return replayStream();
    } catch (error) {
      const reason = error.name === 'AbortError' ? 'TIMEOUT' : error.message?.slice(0, 150);
      console.warn(`[AI] ✗ Key #${keyIdx + 1} → ${model}: ${reason}`);
      lastError = error;
      markModelFailed(model);

      if (isRateLimitError(error.status, error.body)) {
        markKeyExhausted(keyIdx);
      }

      // Small delay between attempts to avoid hammering
      if (attemptCount < combos.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  if (lastError && isRateLimitError(lastError.status, lastError.body)) {
    throw new Error("AI servers are busy. Please wait a moment and try again.");
  }
  throw lastError || new Error("All models and API keys failed. Please try again.");
}

async function callNonStreamingWithFallback(messages, models) {
  if (API_KEYS.length === 0) {
    throw new Error("No OpenRouter API keys configured.");
  }

  const combos = getOrderedCombos(models);
  let lastError;

  for (const { keyIdx, model } of combos) {
    if (keyStatus[keyIdx].exhausted) continue;

    try {
      console.log(`[AI-NS] Key #${keyIdx + 1} → ${model}`);
      const content = await chatCompletionRaw(API_KEYS[keyIdx], model, messages);
      if (!content) throw new Error("Empty response");
      console.log(`[AI-NS] ✓ Key #${keyIdx + 1} → ${model}`);
      resetKeyFailCount(keyIdx);
      markModelSuccess(model);
      return content;
    } catch (error) {
      console.warn(`[AI-NS] ✗ Key #${keyIdx + 1} → ${model}: ${error.message?.slice(0, 150)}`);
      lastError = error;
      markModelFailed(model);

      if (isRateLimitError(error.status, error.body)) {
        markKeyExhausted(keyIdx);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  if (lastError && isRateLimitError(lastError.status, lastError.body)) {
    throw new Error("AI servers are busy. Please wait a moment and try again.");
  }
  throw lastError || new Error("All models failed.");
}

// --- Exported API ----------------------------------------------------

export async function openRouterChatStream(messages) {
  const systemPrompt = `You are TechWiser, an AI web builder. You help users describe what they want—the actual code is generated separately and shown in the Preview panel.

**CRITICAL: NEVER output code.** Do NOT write HTML, JavaScript, JSON, CSS, or any technical syntax in your replies. Use ONLY plain natural language (1-2 short sentences). Examples: "I'm building your todo app with a modern design." or "Adding a dark mode toggle to match your request."

- Do NOT ask questions. Make reasonable assumptions.
- MEMORY: Remember what you built. When the user asks for changes, confirm you'll update the project—never start from scratch unless asked.`;

  const formatted = Array.isArray(messages) && messages.length > 0
    ? [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === "ai" ? "assistant" : m.role,
        content: m.content || "",
      })),
    ]
    : [{ role: "system", content: systemPrompt }];

  return callWithFallback(formatted, MODELS);
}

export async function openRouterPlanStream(messages) {
  const systemPrompt = `You are TechWiser's planning engine. Output ONLY a compact JSON "BUILD_PLAN" with: sitemap (pages), components (list), mockDataSchema, routes, designNotes. No code. Max 300 words. Be specific. Do NOT wrap in markdown code fences. Output raw JSON only.`;

  const formatted = Array.isArray(messages) && messages.length > 0
    ? [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === "ai" ? "assistant" : m.role,
        content: m.content || "",
      })),
    ]
    : [{ role: "system", content: systemPrompt }];

  return callWithFallback(formatted, PLANNING_MODELS);
}

export async function openRouterCodeStream(messages, currentFilePaths = [], options = {}) {
  const { includeSupabase, deployToVercel } = options;

  const memoryNote = currentFilePaths.length > 0
    ? `\nCURRENT PROJECT FILES (update these, do NOT recreate from scratch): ${currentFilePaths.join(", ")}`
    : "";
  const supabaseNote = includeSupabase
    ? `\nInclude Supabase client setup (@supabase/supabase-js) with lib/supabase.js and auth helpers.`
    : "";
  const vercelNote = deployToVercel
    ? `\nEnsure Vercel-compatible build setup.`
    : "";

  const systemPrompt = `${Prompt.CODE_GEN_PROMPT}${memoryNote}${supabaseNote}${vercelNote}

REMINDER: Your ENTIRE response must be a single valid JSON object with a "files" key. Nothing else.`;

  const formatted = Array.isArray(messages) && messages.length > 0
    ? [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role === "ai" ? "assistant" : m.role,
        content: m.content || "",
      })),
    ]
    : [{ role: "system", content: systemPrompt }];

  return callWithFallback(formatted, MODELS, { maxTokens: 16384 });
}

export async function openRouterEnhance(promptWithRules) {
  const formatted = [
    {
      role: "system",
      content: "You help non-technical people describe the website they want, using clear, friendly language and no technical terms.",
    },
    { role: "user", content: promptWithRules },
  ];

  return callNonStreamingWithFallback(formatted, MODELS);
}

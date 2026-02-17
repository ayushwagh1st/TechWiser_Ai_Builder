/**
 * AiModel.jsx — Production-ready OpenRouter integration
 *
 * Uses the OpenRouter REST API directly (OpenAI-compatible).
 *   • Startup warmup: pre-probes all key+model combos, builds a ready-queue
 *   • Multiple API keys with automatic failover on rate-limit / credit exhaustion
 *   • Model-level fallback with priority for pre-validated combos
 *   • Streaming via Server-Sent Events (SSE)
 *   • Non-streaming calls for prompt enhancement
 *   • Periodic re-warmup every 5 minutes
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
  console.warn("[TechWiser] No OPENROUTER_API_KEY found. AI will not work.");
} else {
  console.log(`[TechWiser] Loaded ${API_KEYS.length} OpenRouter API key(s)`);
}

const keyStatus = API_KEYS.map(() => ({ exhausted: false, exhaustedAt: 0, failCount: 0 }));
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (was 10)
const EXHAUST_THRESHOLD = 3; // consecutive failures needed before marking exhausted

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
  // All keys exhausted — reset the oldest one
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
    console.log(`[Keys] Key #${idx + 1} marked exhausted after ${keyStatus[idx].failCount} consecutive failures`);
  } else {
    console.log(`[Keys] Key #${idx + 1} fail count: ${keyStatus[idx].failCount}/${EXHAUST_THRESHOLD}`);
  }
}

function resetKeyFailCount(idx) {
  keyStatus[idx].failCount = 0;
}

/**
 * Only treat truly key-level exhaustion errors as rate limits.
 * Model-specific errors, server errors, etc. should NOT mark a key as exhausted.
 */
function isRateLimitError(status, body) {
  // HTTP 429 is the definitive rate-limit status
  if (status === 429) return true;
  // HTTP 402 = payment required (credits exhausted)
  if (status === 402) return true;

  const msg = (typeof body === "string" ? body : JSON.stringify(body || "")).toLowerCase();

  // Only match phrases that specifically indicate KEY exhaustion, not model errors
  if (msg.includes("rate limit") && !msg.includes("model")) return true;
  if (msg.includes("credits") && (msg.includes("insufficient") || msg.includes("exhausted") || msg.includes("run out"))) return true;
  if (msg.includes("quota") && (msg.includes("exceeded") || msg.includes("exhausted"))) return true;
  if (msg.includes("billing") || msg.includes("payment required")) return true;

  return false;
}

// --- Model Lists -----------------------------------------------------

// Standard models for code generation
const MODELS = [
  "deepseek/deepseek-r1:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "microsoft/phi-4:free",
  "nvidia/llama-3.1-nemotron-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free", // Deprioritized per user feedback
  "meta-llama/llama-3.3-70b-instruct:free", // Deprioritized per user feedback
  "stepfun/step-3.5-flash:free",
];

// Lightweight models for planning
const PLANNING_MODELS = [
  "deepseek/deepseek-r1:free",
  "stepfun/step-3.5-flash:free",
  "qwen/qwen-2.5-coder-32b-instruct:free",
];

// --- Warmup / Ready-Queue --------------------------------------------
// On startup, probes every key+model with a tiny non-streaming request.
// Builds a sorted ready-queue: fastest & available combos first.

/**
 * @typedef {{ keyIdx: number, model: string, latencyMs: number }} ReadyCombo
 */

/** @type {ReadyCombo[]} */
let readyQueue = [];
let warmupDone = false;
let warmupPromise = null;
const WARMUP_INTERVAL_MS = 5 * 60 * 1000; // Re-probe every 5 min

/**
 * Probe a single key+model combo. Returns latency in ms or -1 on failure.
 * Uses minimal tokens (max_tokens: 1) to be fast and cheap.
 */
async function probeCombo(keyIdx, model) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEYS[keyIdx]}`,
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      // Warmup probes should NOT mark keys as exhausted.
      // A failed probe might be a model-specific issue, not a key issue.
      return -1;
    }

    // Consume the response to close the connection
    await res.json().catch(() => { });
    return Date.now() - start;
  } catch (_) {
    return -1;
  }
}

/**
 * Run warmup — probes all key+model combos in parallel.
 * Populates readyQueue sorted by latency (fastest first).
 */
async function runWarmup() {
  if (API_KEYS.length === 0) return;

  const startTime = Date.now();
  console.log("[Warmup] Starting health check...");

  // Probe a subset of models per key to avoid flooding (top 5 fastest + planning models)
  const probeModels = [...new Set([...MODELS.slice(0, 5), ...PLANNING_MODELS])];

  const probes = [];
  for (let keyIdx = 0; keyIdx < API_KEYS.length; keyIdx++) {
    for (const model of probeModels) {
      probes.push(
        probeCombo(keyIdx, model).then((latencyMs) => ({
          keyIdx,
          model,
          latencyMs,
        }))
      );
    }
  }

  const results = await Promise.all(probes);

  // Filter successful combos and sort by latency
  const alive = results
    .filter((r) => r.latencyMs >= 0)
    .sort((a, b) => a.latencyMs - b.latencyMs);

  readyQueue = alive;
  warmupDone = true;

  const elapsed = Date.now() - startTime;
  const aliveKeys = new Set(alive.map((r) => r.keyIdx));
  const aliveModels = new Set(alive.map((r) => r.model));

  console.log(
    `[Warmup] Done in ${elapsed}ms — ${alive.length} combos ready ` +
    `(${aliveKeys.size} key(s), ${aliveModels.size} model(s))`
  );

  if (alive.length > 0) {
    const top3 = alive.slice(0, 3).map((r) =>
      `  Key #${r.keyIdx + 1} → ${r.model} (${r.latencyMs}ms)`
    );
    console.log("[Warmup] Top picks:\n" + top3.join("\n"));
  } else {
    console.warn("[Warmup] ⚠ No combos available — will try all on first request");
  }
}

// Fire warmup on module load (non-blocking)
if (API_KEYS.length > 0) {
  warmupPromise = runWarmup().catch((e) =>
    console.warn("[Warmup] Failed:", e.message)
  );

  // Re-warmup periodically
  setInterval(() => {
    runWarmup().catch((e) => console.warn("[Re-Warmup] Failed:", e.message));
  }, WARMUP_INTERVAL_MS);
}

/**
 * Wait for warmup to finish (with timeout). Non-blocking after first call.
 */
async function ensureWarmedUp() {
  if (warmupDone || !warmupPromise) return;
  // Wait at most 10s for warmup — don't block user request forever
  await Promise.race([
    warmupPromise,
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);
}

/**
 * Get an ordered list of key+model combos to try.
 * Prioritizes pre-validated combos from warmup, then falls back to all.
 */
function getOrderedCombos(models) {
  const combos = [];
  const seen = new Set();

  // 1. Pre-validated combos from warmup (only for requested models)
  const modelSet = new Set(models);
  for (const combo of readyQueue) {
    if (!modelSet.has(combo.model)) continue;
    const key = `${combo.keyIdx}:${combo.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(combo);
  }

  // 2. Fill in ALL key×model combos not yet covered (cartesian product)
  //    This ensures every model gets tried with every key before giving up.
  for (const model of models) {
    for (let keyIdx = 0; keyIdx < API_KEYS.length; keyIdx++) {
      const key = `${keyIdx}:${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combos.push({ keyIdx, model, latencyMs: 9999 });
    }
  }

  return combos;
}

// --- Core: Streaming fetch -------------------------------------------

async function* streamChatRaw(apiKey, model, messages) {
  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": siteUrl,
      "X-Title": siteName,
    },
    body: JSON.stringify({ model, messages, stream: true }),
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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

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
}

async function chatCompletionRaw(apiKey, model, messages) {
  const res = await fetch(OPENROUTER_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": siteUrl,
      "X-Title": siteName,
    },
    body: JSON.stringify({ model, messages }),
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
}

// --- Fallback Engine (warmup-aware) ----------------------------------

/**
 * Try combos from the ready-queue first, then fall back.
 * Returns an async iterable of text deltas.
 */
async function callWithFallback(messages, models) {
  if (API_KEYS.length === 0) {
    throw new Error("No OpenRouter API keys configured. Set OPENROUTER_API_KEY in .env.local");
  }

  // Wait for warmup (non-blocking after first call)
  await ensureWarmedUp();

  const combos = getOrderedCombos(models);
  let lastError;

  for (const { keyIdx, model } of combos) {
    // Skip exhausted keys
    if (keyStatus[keyIdx].exhausted) continue;

    try {
      console.log(`[AI] Key #${keyIdx + 1} → ${model}`);
      const gen = streamChatRaw(API_KEYS[keyIdx], model, messages);

      // Probe first chunk
      const reader = gen[Symbol.asyncIterator]();
      const first = await reader.next();

      if (first.done) {
        throw new Error("Empty response from model (stream ended immediately)");
      }

      async function* replayStream() {
        yield first.value;
        while (true) {
          const { value, done } = await reader.next();
          if (done) break;
          yield value;
        }
      }

      console.log(`[AI] Key #${keyIdx + 1} → ${model} ✓`);
      resetKeyFailCount(keyIdx); // Success — reset fail counter
      return replayStream();
    } catch (error) {
      console.warn(`[AI] Key #${keyIdx + 1} → ${model} ✗: ${error.message?.slice(0, 200)}`);
      lastError = error;

      if (isRateLimitError(error.status, error.body)) {
        markKeyExhausted(keyIdx);
      }
    }
  }

  // All combos failed
  if (lastError && isRateLimitError(lastError.status, lastError.body)) {
    throw new Error("Our AI servers are busy right now. Please wait a moment and try again.");
  }
  throw lastError || new Error("All models and API keys failed");
}

async function callNonStreamingWithFallback(messages, models) {
  if (API_KEYS.length === 0) {
    throw new Error("No OpenRouter API keys configured.");
  }

  await ensureWarmedUp();

  const combos = getOrderedCombos(models);
  let lastError;

  for (const { keyIdx, model } of combos) {
    if (keyStatus[keyIdx].exhausted) continue;

    try {
      console.log(`[AI-NS] Key #${keyIdx + 1} → ${model}`);
      const content = await chatCompletionRaw(API_KEYS[keyIdx], model, messages);
      if (!content) throw new Error("Empty response");
      console.log(`[AI-NS] Key #${keyIdx + 1} → ${model} ✓`);
      resetKeyFailCount(keyIdx); // Success — reset fail counter
      return content;
    } catch (error) {
      console.warn(`[AI-NS] Key #${keyIdx + 1} → ${model} ✗: ${error.message?.slice(0, 200)}`);
      lastError = error;

      if (isRateLimitError(error.status, error.body)) {
        markKeyExhausted(keyIdx);
        // Add a small delay before retrying to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  if (lastError && isRateLimitError(lastError.status, lastError.body)) {
    throw new Error("Our AI servers are busy right now. Please wait a moment and try again.");
  }
  throw lastError || new Error("All models and API keys failed");
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
  const { buildPlan, includeSupabase, deployToVercel } = options;

  const memoryNote = currentFilePaths.length > 0
    ? `\n\n**MEMORY – CURRENT PROJECT FILES:** Build on these—do NOT recreate from scratch unless explicitly asked: ${currentFilePaths.join(", ")}`
    : "\n\n**MEMORY:** The conversation contains what you previously built. When asked for changes or fixes, UPDATE existing files—do not start over.";
  const planContext = buildPlan
    ? `\n\n**PRE-GENERATED BUILD PLAN (follow this):**\n${typeof buildPlan === "string" ? buildPlan : JSON.stringify(buildPlan, null, 0)}`
    : "";
  const phasedNote = `\n\n**PHASED CODING (for better context):** Generate files in this order: 1) index.css (design tokens), 2) App.js (routing/structure), 3) components (Navbar, Hero, etc.), 4) pages, 5) mock data. Output the final JSON with all files at once.`;
  const supabaseNote = includeSupabase
    ? `\n\n**SUPABASE BACKEND:** Include Supabase client setup: @supabase/supabase-js, env vars SUPABASE_URL and SUPABASE_ANON_KEY. Add lib/supabase.js, auth helpers, and example queries for database/auth.`
    : "";
  const vercelNote = deployToVercel
    ? `\n\n**VERCEL DEPLOY:** Include vercel.json if needed. Ensure build scripts and env setup are Vercel-compatible.`
    : "";

  const systemPrompt = `${Prompt.CODE_GEN_PROMPT}

**OUTPUT:** Return ONLY valid JSON. Your response must be parseable by JSON.parse(). Do not include markdown formatting like \`\`\`json. Just the raw JSON object.

**CRITICAL ESCAPING RULE:** Inside JSON string values, you MUST properly escape all backslashes as \\\\, all double quotes as \\", all newlines as \\n, and all tabs as \\t. The output must be valid JSON.${memoryNote}${planContext}${phasedNote}${supabaseNote}${vercelNote}`;

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

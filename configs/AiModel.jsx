/**
 * AiModel.jsx — Phased Code Generation (v3)
 *
 * Key design: instead of generating all files at once (16K+ tokens, slow, unreliable),
 * we break it into phases:
 *   Phase 1: Plan — get a list of files needed (~500 tokens, 3s)
 *   Phase 2: Generate — produce each file individually (~1-2K tokens each, 5s)
 *
 * This works reliably with free models because each request is small.
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
  console.warn("[TechWiser] ⚠ No OPENROUTER_API_KEY found.");
} else {
  console.log(`[TechWiser] Loaded ${API_KEYS.length} OpenRouter API key(s)`);
}

// --- Key Health Tracking ---------------------------------------------

const keyStatus = API_KEYS.map(() => ({ exhausted: false, exhaustedAt: 0, failCount: 0 }));
const COOLDOWN_MS = 2 * 60 * 1000;
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
    console.log(`[Keys] Key #${idx + 1} exhausted after ${keyStatus[idx].failCount} failures`);
  }
}

function resetKeyFails(idx) {
  keyStatus[idx].failCount = 0;
}

function isRateLimitError(status, body) {
  if (status === 429 || status === 402) return true;
  const msg = (typeof body === "string" ? body : JSON.stringify(body || "")).toLowerCase();
  return msg.includes("rate limit") || msg.includes("credits") || msg.includes("quota") || msg.includes("billing") || msg.includes("payment required");
}

// --- Model Lists -----------------------------------------------------

const FAST_MODELS = [
  "stepfun/step-3.5-flash:free",             // User requested
  "deepseek/deepseek-r1-0528:free",          // User requested
  "arcee-ai/trinity-large-preview:free",     // User requested
];

const CODE_MODELS = [
  "arcee-ai/trinity-large-preview:free",     // User requested
  "stepfun/step-3.5-flash:free",             // User requested
  "deepseek/deepseek-r1-0528:free",          // User requested
];

// --- Model Health Tracking -------------------------------------------

const modelHealth = new Map();

function isModelHealthy(model) {
  const h = modelHealth.get(model);
  if (!h) return true;
  if (h.fails >= 2 && Date.now() - h.lastFail < 2 * 60 * 1000) return false;
  return true;
}

function markModelFailed(model) {
  const h = modelHealth.get(model) || { lastFail: 0, fails: 0 };
  h.lastFail = Date.now();
  h.fails++;
  modelHealth.set(model, h);
}

function markModelOk(model) {
  modelHealth.set(model, { lastFail: 0, fails: 0 });
}

// --- Core: Non-streaming fetch with timeout --------------------------

async function fetchCompletion(apiKey, model, messages, opts = {}) {
  const controller = new AbortController();
  const timeout = opts.timeout || 60_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const body = { model, messages };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

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

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

// --- Core: Streaming fetch with per-model timeout --------------------

const PER_MODEL_TIMEOUT_MS = 90_000;
const FIRST_CHUNK_TIMEOUT_MS = 25_000;

async function* streamChat(apiKey, model, messages, opts = {}) {
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);

  try {
    const body = { model, messages, stream: true };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

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
    let gotFirst = false;

    const firstTimer = setTimeout(() => { if (!gotFirst) controller.abort(); }, FIRST_CHUNK_TIMEOUT_MS);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!gotFirst) { gotFirst = true; clearTimeout(firstTimer); }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith(":") || !t.startsWith("data: ")) continue;
        const payload = t.slice(6);
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

// --- Fallback Engine -------------------------------------------------

function getOrderedCombos(models) {
  const combos = [];
  for (const model of models) {
    if (!isModelHealthy(model)) continue;
    for (let ki = 0; ki < API_KEYS.length; ki++) {
      if (!keyStatus[ki].exhausted) combos.push({ ki, model });
    }
  }
  if (combos.length === 0) {
    for (const model of models) {
      for (let ki = 0; ki < API_KEYS.length; ki++) {
        combos.push({ ki, model });
      }
    }
  }
  return combos;
}

async function callNonStreaming(messages, models, opts = {}) {
  if (API_KEYS.length === 0) throw new Error("No OpenRouter API keys configured.");
  const combos = getOrderedCombos(models);
  let lastError;

  for (const { ki, model } of combos) {
    try {
      console.log(`[AI] Try: Key#${ki + 1} → ${model}`);
      const content = await fetchCompletion(API_KEYS[ki], model, messages, opts);
      if (!content) throw new Error("Empty response");
      console.log(`[AI] ✓ Key#${ki + 1} → ${model} (${content.length} chars)`);
      resetKeyFails(ki);
      markModelOk(model);
      return content;
    } catch (e) {
      const reason = e.name === 'AbortError' ? 'TIMEOUT' : e.message?.slice(0, 100);
      console.warn(`[AI] ✗ Key#${ki + 1} → ${model}: ${reason}`);
      lastError = e;
      markModelFailed(model);
      if (isRateLimitError(e.status, e.body)) markKeyExhausted(ki);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw lastError || new Error("All models failed.");
}

async function callStreaming(messages, models, opts = {}) {
  if (API_KEYS.length === 0) throw new Error("No OpenRouter API keys configured.");
  const combos = getOrderedCombos(models);
  let lastError;

  for (const { ki, model } of combos) {
    try {
      console.log(`[AI-S] Try: Key#${ki + 1} → ${model}`);
      const gen = streamChat(API_KEYS[ki], model, messages, opts);
      const reader = gen[Symbol.asyncIterator]();
      const first = await reader.next();
      if (first.done) throw new Error("Empty stream");

      async function* replay() {
        yield first.value;
        while (true) { const { value, done } = await reader.next(); if (done) break; yield value; }
      }

      console.log(`[AI-S] ✓ Key#${ki + 1} → ${model}`);
      resetKeyFails(ki);
      markModelOk(model);
      return replay();
    } catch (e) {
      const reason = e.name === 'AbortError' ? 'TIMEOUT' : e.message?.slice(0, 100);
      console.warn(`[AI-S] ✗ Key#${ki + 1} → ${model}: ${reason}`);
      lastError = e;
      markModelFailed(model);
      if (isRateLimitError(e.status, e.body)) markKeyExhausted(ki);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw lastError || new Error("All models failed.");
}

// --- Exported APIs ---------------------------------------------------

/** Chat stream (for chat panel) */
export async function openRouterChatStream(messages) {
  const systemPrompt = `You are TechWiser, an AI web builder. You help users describe what they want—the actual code is generated separately.
**NEVER output code.** Use ONLY plain natural language (1-2 short sentences). Do NOT ask questions.`;

  const formatted = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.content || "" })),
  ];
  return callStreaming(formatted, FAST_MODELS);
}

/** Phase 1: Get file plan (non-streaming, small response) */
export async function openRouterFilePlan(messages, currentFilePaths = []) {
  const memoryNote = currentFilePaths.length > 0
    ? `\nEXISTING FILES (update these, don't recreate): ${currentFilePaths.join(", ")}`
    : "";

  const formatted = [
    { role: "system", content: `${Prompt.FILE_PLAN_PROMPT}${memoryNote}` },
    ...messages.map(m => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.content || "" })),
  ];
  return callNonStreaming(formatted, FAST_MODELS, { maxTokens: 2048, timeout: 45_000, temperature: 0.3 });
}

/** Phase 2: Generate a single file (non-streaming, focused response) */
export async function openRouterSingleFile(userRequest, fileName, fileDescription, otherFiles = []) {
  const otherFilesNote = otherFiles.length > 0
    ? `\nOther files in this project: ${otherFiles.map(f => f.path).join(", ")}. Import from them as needed.`
    : "";

  const formatted = [
    { role: "system", content: `${Prompt.SINGLE_FILE_PROMPT}${otherFilesNote}` },
    {
      role: "user",
      content: `PROJECT REQUEST: ${userRequest}

GENERATE FILE: ${fileName}
DESCRIPTION: ${fileDescription}

Output ONLY the raw source code for this file. No JSON wrapping. No markdown. Just code.`
    },
  ];
  return callNonStreaming(formatted, CODE_MODELS, { maxTokens: 4096, timeout: 60_000, temperature: 0.2 });
}

/** Legacy: Full code stream (fallback if phased fails) */
export async function openRouterCodeStream(messages, currentFilePaths = [], options = {}) {
  const memoryNote = currentFilePaths.length > 0
    ? `\nCURRENT FILES (update, don't recreate): ${currentFilePaths.join(", ")}`
    : "";

  const formatted = [
    { role: "system", content: `${Prompt.CODE_GEN_PROMPT}${memoryNote}\n\nREMINDER: Respond with ONLY valid JSON with a "files" key.` },
    ...messages.map(m => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.content || "" })),
  ];
  return callStreaming(formatted, CODE_MODELS, { maxTokens: 16384 });
}

/** Enhance prompt (non-streaming) */
export async function openRouterEnhance(promptWithRules) {
  const formatted = [
    { role: "system", content: "You help non-technical people describe websites they want, using clear, friendly language. No code." },
    { role: "user", content: promptWithRules },
  ];
  return callNonStreaming(formatted, FAST_MODELS);
}

/** Plan stream (for build planning) */
export async function openRouterPlanStream(messages) {
  const formatted = [
    { role: "system", content: `You are TechWiser's planning engine. Output ONLY compact JSON "BUILD_PLAN" with: sitemap, components, mockDataSchema, routes, designNotes. No code. Max 300 words. Raw JSON only.` },
    ...messages.map(m => ({ role: m.role === "ai" ? "assistant" : m.role, content: m.content || "" })),
  ];
  return callStreaming(formatted, FAST_MODELS);
}

// ─── Partial Regen / Fix Plan ────────────────────────────────────────

export async function openRouterFixPlan(messages, currentFilePaths) {
  const lastMsg = messages[messages.length - 1].content;
  const prompt = `${Prompt.FIX_PLAN_PROMPT}\n\nExisting Files: ${JSON.stringify(currentFilePaths)}\n\nUser Request/Error: ${lastMsg}`;

  // Use fast models for planning
  for (let i = 0; i < FAST_MODELS.length; i++) {
    const model = FAST_MODELS[i];
    try {
      const apiKey = getNextKey();
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://techwiser.ai",
          "X-Title": "TechWiser AI Builder",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: prompt }],
          temperature: 0.2, // Low temp for precise planning
          max_tokens: 500,  // Small output
          stream: false,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0]?.message?.content || "";
        // Clean markdown fences if present
        const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
        if (cleaned.startsWith('{')) return cleaned;
      }
      markKeyFailure(getUuidFromKey(apiKey));
    } catch (e) {
      console.warn(`[FixPlan] Model ${model} failed: ${e.message}`);
    }
  }
  throw new Error("Failed to generate fix plan");
}

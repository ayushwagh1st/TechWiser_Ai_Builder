import { OpenRouter } from "@openrouter/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const siteName = "TechWiser";

if (!apiKey) {
  console.warn(
    "Missing OPENROUTER_API_KEY environment variable. TechWiser AI features will not work until it is set."
  );
}

const openRouter = apiKey
  ? new OpenRouter({
      apiKey,
      defaultHeaders: {
        "HTTP-Referer": siteUrl,
        "X-Title": siteName,
      },
    })
  : null;

const MODEL = "stepfun/step-3.5-flash:free";

// Streaming helper for plain chat (used by /api/ai-chat)
export async function openRouterChatStream(prompt) {
  if (!openRouter) {
    throw new Error(
      "OpenRouter client not initialized. Check OPENROUTER_API_KEY environment variable."
    );
  }
  const result = openRouter.callModel({
    model: MODEL,
    instructions:
      "You are TechWiser. Build websites from the user's description. Do NOT ask any questions—build what best matches their prompt and make reasonable assumptions. Keep replies very short. If they want changes, they will say so.",
    input: prompt,
  });
  return result.getTextStream();
}

// Streaming helper for code generation (used by /api/gen-ai-code)
export async function openRouterCodeStream(prompt) {
  if (!openRouter) {
    throw new Error(
      "OpenRouter client not initialized. Check OPENROUTER_API_KEY environment variable."
    );
  }
  const result = openRouter.callModel({
    model: MODEL,
    instructions:
      "You are TechWiser, an AI that outputs ONLY valid JSON describing a React + Vite + Tailwind project. Never include explanations or markdown, just raw JSON.",
    input: prompt,
  });
  return result.getTextStream();
}

// Non-streaming helper for prompt enhancement (used by /api/enhance-prompt)
export async function openRouterEnhance(promptWithRules) {
  try {
    if (!openRouter || !apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set in environment variables."
      );
    }

    const result = openRouter.callModel({
      model: MODEL,
      instructions:
        "You help non-technical people describe the website they want, using clear, friendly language and no technical terms.",
      input: promptWithRules,
    });

    const content = (await result.getText())?.trim();
    if (!content) {
      throw new Error("Empty response from OpenRouter API");
    }
    return content;
  } catch (error) {
    console.error("OpenRouter enhance error:", error);
    throw new Error(
      `AI enhancement failed: ${error.message || "Unknown error"}`
    );
  }
}

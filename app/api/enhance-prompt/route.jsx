import { openRouterEnhance } from "@/configs/AiModel";
import Prompt from "@/data/Prompt";

export async function POST(request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { prompt } = await request.json();

        if (!prompt || typeof prompt !== "string") {
          throw new Error("Invalid prompt provided");
        }

        const enhanced = await openRouterEnhance(
          `${Prompt.ENHANCE_PROMPT_RULES}\n\nOriginal prompt: ${prompt}`
        );

        if (!enhanced) {
          throw new Error("No response from AI");
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ chunk: enhanced })}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              enhancedPrompt: enhanced,
              done: true,
            })}\n\n`
          )
        );
        controller.close();
      } catch (e) {
        const errorMessage = e.message || "Failed to enhance prompt";
        console.error("Enhance prompt error:", errorMessage, e);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: errorMessage,
              success: false,
              done: true,
            })}\n\n`
          )
        );
        controller.close();
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
}

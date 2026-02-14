import { openRouterChatStream } from "@/configs/AiModel";

export async function POST(req) {
  try {
    const { prompt } = await req.json();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";
          const textStream = await openRouterChatStream(prompt);

          for await (const delta of textStream) {
            if (!delta) continue;
            fullText += delta;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ chunk: delta })}\n\n`
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ result: fullText, done: true })}\n\n`
            )
          );
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: e.message || "AI chat failed",
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
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || "AI chat failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

import { openRouterCodeStream } from "@/configs/AiModel";

export async function POST(req) {
  try {
    const { prompt } = await req.json();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";
          const textStream = await openRouterCodeStream(prompt);

          for await (const delta of textStream) {
            if (!delta) continue;
            fullText += delta;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ chunk: delta })}\n\n`
              )
            );
          }

          const sanitizeJson = (text) => {
            let cleaned = text.trim();
            if (cleaned.startsWith("```")) {
              cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
            }
            if (cleaned.endsWith("```")) {
              cleaned = cleaned.replace(/```$/, "");
            }
            return cleaned.trim();
          };

          try {
            const cleaned = sanitizeJson(fullText);
            const parsedData = JSON.parse(cleaned);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  final: parsedData,
                  done: true,
                })}\n\n`
              )
            );
          } catch (e) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  error: "Invalid JSON response",
                  done: true,
                })}\n\n`
              )
            );
          }
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: e.message || "Code generation failed",
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
      JSON.stringify({ error: e.message || "Code generation failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

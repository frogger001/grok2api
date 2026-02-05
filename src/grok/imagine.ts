const WS_URL = "wss://grok.com/ws/imagine/listen";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function generateImagineImages(options: {
  cookie: string;
  prompt: string;
  n?: number;
  timeoutMs?: number;
}): Promise<string[]> {
  const n = Math.min(Math.max(Math.floor(options.n ?? 1), 1), 4);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const headers = {
    Cookie: options.cookie,
    "User-Agent": DEFAULT_USER_AGENT,
    Origin: "https://grok.com",
    Host: "grok.com",
  };

  const response = await fetch(WS_URL, { headers });
  const ws = response.webSocket;
  if (!ws) throw new Error("WebSocket handshake failed");
  ws.accept();

  return new Promise((resolve, reject) => {
    const images: string[] = [];
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close(1000, "done");
      } catch {
        // ignore close errors
      }
    };

    const finish = () => {
      cleanup();
      resolve(images.slice(0, n));
    };

    const fail = (err: Error) => {
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error("WebSocket imagine timeout"));
    }, timeoutMs);

    ws.addEventListener("message", (event) => {
      try {
        const raw =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);
        const data = JSON.parse(raw) as { type?: string; blob?: string; current_status?: string };
        if (data.type === "image" && data.blob) {
          images.push(data.blob);
          if (images.length >= n) finish();
          return;
        }
        if (data.type === "json" && data.current_status === "completed") {
          finish();
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.addEventListener("close", () => {
      if (settled) return;
      if (images.length) {
        finish();
      } else {
        fail(new Error("WebSocket closed before images were generated"));
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) fail(new Error("WebSocket error"));
    });

    const payload = {
      type: "conversation.item.create",
      timestamp: Date.now(),
      item: {
        type: "message",
        content: [
          {
            requestId: crypto.randomUUID(),
            text: options.prompt,
            type: "input_scroll",
            properties: {
              section_count: 0,
              is_kids_mode: false,
              enable_nsfw: true,
              skip_upsampler: false,
              is_initial: false,
              aspect_ratio: "2:3",
            },
          },
        ],
      },
    };

    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

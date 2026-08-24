import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public cobalt instances (including api.cobalt.tools) now require an
// operator-issued API key / JWT to curb anonymous scraping abuse — so this
// points at a self-hosted cobalt instance (Railway) instead. Override via the
// COBALT_API_URL / COBALT_API_KEY Supabase function secrets if the instance
// ever moves.
const COBALT_API_URL =
  Deno.env.get("COBALT_API_URL") ?? "https://cobalt-tools-production-85ec.up.railway.app/";
const COBALT_API_KEY = Deno.env.get("COBALT_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;

// Shown to the user for any cobalt/network-level failure. The specific cause
// (logged via console.error below) is not actionable by the user, so we
// don't surface raw HTTP codes or cobalt error codes for these cases.
const CONNECTION_ERROR_MESSAGE = "서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  let rawUrl: string | null;
  if (req.method === "GET") {
    rawUrl = new URL(req.url).searchParams.get("url");
  } else if (req.method === "POST") {
    try {
      const body: { url?: string } = await req.json();
      rawUrl = body.url ?? null;
    } catch {
      return jsonError("요청 본문을 읽을 수 없습니다.", 400);
    }
  } else {
    return jsonError("허용되지 않은 요청 방식입니다.", 405);
  }

  const sourceUrl = rawUrl?.trim();
  if (!sourceUrl || !YOUTUBE_URL_PATTERN.test(sourceUrl)) {
    return jsonError("올바른 유튜브 URL이 아닙니다.", 400);
  }

  let cobaltResponse: Response;
  try {
    cobaltResponse = await fetch(COBALT_API_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(COBALT_API_KEY ? { Authorization: `Api-Key ${COBALT_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        url: sourceUrl,
        downloadMode: "audio",
        audioFormat: "mp3",
        audioBitrate: "128",
      }),
    });
  } catch (err) {
    console.error("cobalt request failed:", err);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  // cobalt reports per-video errors (e.g. "this video needs a login") with a
  // structured JSON body even on a non-2xx HTTP status, so parse the body
  // before deciding whether this was a real connection failure.
  let cobaltData: {
    status?: string;
    url?: string;
    filename?: string;
    error?: { code?: string };
  };
  try {
    cobaltData = await cobaltResponse.json();
  } catch (err) {
    console.error("failed to parse cobalt response:", err, "http status:", cobaltResponse.status);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  if (cobaltData.status === "error") {
    const code = cobaltData.error?.code ?? "unknown";
    console.error("cobalt reported an error for this video:", code);
    // Not a server outage — this specific video can't be processed (e.g. it
    // requires a logged-in session on YouTube's end), so retrying won't help.
    return jsonError("이 영상에서는 오디오를 추출할 수 없습니다. 다른 영상으로 시도해주세요.", 422);
  }

  if (!cobaltResponse.ok) {
    console.error("cobalt returned non-2xx with no structured error:", cobaltResponse.status);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  if (
    (cobaltData.status !== "tunnel" && cobaltData.status !== "redirect") ||
    !cobaltData.url
  ) {
    console.error("unexpected cobalt response status:", cobaltData.status);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  // Stream the audio file back through this function so the client never has
  // to talk to cobalt's tunnel/redirect URL directly (avoids CORS + keeps the
  // client code source-agnostic if the extraction backend changes later).
  let fileResponse: Response;
  try {
    fileResponse = await fetch(cobaltData.url);
  } catch (err) {
    console.error("failed to download from cobalt tunnel:", err);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  if (!fileResponse.ok || !fileResponse.body) {
    console.error("cobalt tunnel returned non-2xx:", fileResponse.status);
    return jsonError(CONNECTION_ERROR_MESSAGE, 502);
  }

  const filename = cobaltData.filename || "audio.mp3";

  return new Response(fileResponse.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": fileResponse.headers.get("Content-Type") ?? "audio/mpeg",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

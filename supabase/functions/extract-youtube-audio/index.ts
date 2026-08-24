import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Public cobalt instances (including api.cobalt.tools) now require an
// operator-issued API key / JWT to curb anonymous scraping abuse — so this
// points at a self-hosted cobalt instance's base URL, set via a Supabase
// function secret (`supabase secrets set COBALT_API_URL=...`).
const COBALT_API_URL = Deno.env.get("COBALT_API_URL");
const COBALT_API_KEY = Deno.env.get("COBALT_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;

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

  if (!COBALT_API_URL) {
    return jsonError(
      "서버에 cobalt 인스턴스가 설정되지 않았습니다 (COBALT_API_URL 시크릿 필요).",
      500
    );
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
  } catch {
    return jsonError("cobalt 서비스에 연결하지 못했습니다.", 502);
  }

  if (!cobaltResponse.ok) {
    return jsonError(`cobalt 서비스 오류 (HTTP ${cobaltResponse.status}).`, 502);
  }

  let cobaltData: {
    status?: string;
    url?: string;
    filename?: string;
    error?: { code?: string };
  };
  try {
    cobaltData = await cobaltResponse.json();
  } catch {
    return jsonError("cobalt 응답을 해석할 수 없습니다.", 502);
  }

  if (cobaltData.status === "error") {
    const code = cobaltData.error?.code ?? "unknown";
    return jsonError(`오디오 추출에 실패했습니다 (${code}).`, 502);
  }

  if (
    (cobaltData.status !== "tunnel" && cobaltData.status !== "redirect") ||
    !cobaltData.url
  ) {
    return jsonError(`지원하지 않는 응답 형식입니다 (${cobaltData.status ?? "unknown"}).`, 502);
  }

  // Stream the audio file back through this function so the client never has
  // to talk to cobalt's tunnel/redirect URL directly (avoids CORS + keeps the
  // client code source-agnostic if the extraction backend changes later).
  let fileResponse: Response;
  try {
    fileResponse = await fetch(cobaltData.url);
  } catch {
    return jsonError("추출된 오디오 파일을 내려받지 못했습니다.", 502);
  }

  if (!fileResponse.ok || !fileResponse.body) {
    return jsonError(`오디오 파일 다운로드 실패 (HTTP ${fileResponse.status}).`, 502);
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

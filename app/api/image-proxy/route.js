export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response("Missing or invalid url parameter", { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CHECK24-FeedChecker/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return new Response("Upstream error", { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const body = await res.arrayBuffer();

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response("Failed to fetch image", { status: 502 });
  }
}

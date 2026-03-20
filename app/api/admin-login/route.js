export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();

    const expectedUsername = String(process.env.ADMIN_USERNAME || "").trim();
    const expectedPassword = String(process.env.ADMIN_PASSWORD || "").trim();

    if (!expectedUsername || !expectedPassword) {
      return Response.json({ error: "Admin credentials not configured" }, { status: 500 });
    }

    if (!username || !password) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (username !== expectedUsername || password !== expectedPassword) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = String(process.env.ADMIN_TOKEN || "").trim();
    if (!token) {
      return Response.json({ error: "ADMIN_TOKEN not configured" }, { status: 500 });
    }

    return Response.json({ ok: true, token });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}


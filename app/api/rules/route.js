let memoryStore = null;

let kvClient = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { kv } = require("@vercel/kv");
    kvClient = kv;
  }
} catch (e) {
  kvClient = null;
}

const KEY = "feed_rules_v1";

export async function GET() {
  try {
    if (kvClient) {
      const rules = (await kvClient.get(KEY)) || null;
      return Response.json({ rules });
    }
    return Response.json({ rules: memoryStore });
  } catch (e) {
    console.error(e);
    return new Response("Internal Server Error", { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const token = req.headers.get("x-admin-token") || "";

    if (process.env.ADMIN_TOKEN) {
      if (token !== process.env.ADMIN_TOKEN) return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();

    if (kvClient) await kvClient.set(KEY, body);
    else memoryStore = body;

    return Response.json({ rules: body });
  } catch (e) {
    console.error(e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
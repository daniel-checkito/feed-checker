const memoryStore =
  (globalThis.__productOptAnalytics = globalThis.__productOptAnalytics || {});

let kvClient = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { kv } = require("@vercel/kv");
    kvClient = kv;
  }
} catch (e) {
  kvClient = null;
}

const PREFIX = "product_opt_usage_v1";

async function getNumber(key) {
  try {
    if (kvClient) {
      const v = await kvClient.get(key);
      return typeof v === "number" ? v : Number(v || 0);
    }
    return typeof memoryStore[key] === "number" ? memoryStore[key] : Number(memoryStore[key] || 0);
  } catch {
    return 0;
  }
}

export async function GET(req) {
  const token = String(req.headers.get("x-admin-token") || "");

  if (process.env.ADMIN_TOKEN) {
    if (token !== process.env.ADMIN_TOKEN) return new Response("Unauthorized", { status: 401 });
  } else if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const totalRuns = await getNumber(`${PREFIX}:totalRuns`);
  const totalClaudeUsed = await getNumber(`${PREFIX}:totalClaudeUsed`);
  const imageEnoughTrue = await getNumber(`${PREFIX}:imageEnoughTrue`);
  const imageEnoughFalse = await getNumber(`${PREFIX}:imageEnoughFalse`);
  const offerCountSum = await getNumber(`${PREFIX}:offerCountSum`);
  const offerCountN = await getNumber(`${PREFIX}:offerCountN`);

  const offerCountAvg = offerCountN > 0 ? offerCountSum / offerCountN : null;
  const claudeRatePct = totalRuns > 0 ? Math.round((totalClaudeUsed / totalRuns) * 1000) / 10 : 0;

  const last30Days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const total = await getNumber(`${PREFIX}:daily:${date}:totalRuns`);
    const claude = await getNumber(`${PREFIX}:daily:${date}:totalClaudeUsed`);
    last30Days.push({ date, total, claude });
  }

  return Response.json({
    totalRuns,
    totalClaudeUsed,
    claudeRatePct,
    imageEnoughTrue,
    imageEnoughFalse,
    offerCountAvg: offerCountAvg == null ? null : Math.round(offerCountAvg * 10) / 10,
    last30Days,
  });
}


const DEFAULTS = {
  minImages: 3,
  titleMinLength: 60,
  descriptionMinLength: 150,
  descriptionMaxLength: 1200,
  titleMaxLength: 80,
};

const memoryAnalytics =
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

const ANALYTICS_PREFIX = "product_opt_usage_v1";

async function bumpNumber(key, delta = 1) {
  const amount = Number(delta || 0);
  if (!amount) return;
  if (kvClient) {
    const cur = await kvClient.get(key);
    const next = Number(cur || 0) + amount;
    await kvClient.set(key, next);
    return;
  }
  const cur = Number(memoryAnalytics[key] || 0);
  memoryAnalytics[key] = cur + amount;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeWhitespace(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(str) {
  const s = String(str ?? "");
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtmlTags(s) {
  return String(s ?? "").replace(/<[^>]+>/g, " ");
}

function safeParseJson(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function uniqueNonEmpty(list) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    const v = normalizeWhitespace(it);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function isPlaceholderText(s) {
  const t = normalizeWhitespace(s).toLowerCase();
  if (!t) return true;
  return (
    t.includes("beschreibung folgt") ||
    t.includes("beschreibung folgt.") ||
    t.includes("n/a") ||
    t.includes("keine beschreibung") ||
    t.includes("undefined") ||
    t.includes("null") ||
    t.includes("produktbeschreibung") && t.length < 60
  );
}

function extractMetaByAttributes(html) {
  const metas = new Map();
  const re = /<meta\s+([^>]*?)>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const nameMatch = attrs.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = attrs.match(/content\s*=\s*["']([^"']*)["']/i);
    if (!nameMatch || !contentMatch) continue;
    const key = String(nameMatch[1] ?? "").trim().toLowerCase();
    const content = decodeHtmlEntities(contentMatch[1] ?? "");
    if (!key) continue;
    // Prefer first non-empty meta
    if (!metas.has(key) && normalizeWhitespace(content)) metas.set(key, content);
  }
  return metas;
}

function extractTitleAndDescriptionFromHtml(html) {
  const metaMap = extractMetaByAttributes(html);

  const ogTitle = metaMap.get("og:title");
  const twitterTitle = metaMap.get("twitter:title");
  const ogDescription = metaMap.get("og:description");
  const metaDescription = metaMap.get("description");

  const titleTag = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

  const titleCandidates = [ogTitle, twitterTitle, metaMap.get("og:product:title"), titleTag];
  const descriptionCandidates = [metaDescription, ogDescription, metaMap.get("twitter:description")];

  const originalTitle = normalizeWhitespace(titleCandidates.find((x) => normalizeWhitespace(x).length)) || "";
  const originalDescription =
    normalizeWhitespace(descriptionCandidates.find((x) => normalizeWhitespace(x).length)) || "";

  return { originalTitle, originalDescription };
}

function extractCheck24ProductFromEmbeddedJson(html) {
  // Check24 embeds the full product payload in a comment block.
  // Example (Python equivalent regex):
  // data-ssr-key="desktop_check24de_ProductDetailPage" ...><!--({ ...json... })-->
  const match = String(html).match(
    /data-ssr-key="desktop_check24de_ProductDetailPage"[^>]*><!--({.+?})-->/s,
  );
  if (!match?.[1]) return null;

  const data = safeParseJson(match[1]);
  const product = data?.productDetail?.product;
  if (!product) return null;

  const title = normalizeWhitespace(product?.name ?? "");
  const description = String(product?.description ?? "").trim();

  const media = product?.media ?? {};
  const image_urls = [];
  if (media && typeof media === "object") {
    for (const item of Object.values(media)) {
      if (!item || item?.mediaType !== "image") continue;
      const host = String(item?.host ?? "").replace(/^\/+/, "");
      const path = String(item?.localUri ?? "");
      if (!host || !path) continue;
      image_urls.push(`https://${host}/resize/1500_1500${path}`);
    }
  }

  return { title, description, image_urls };
}

function extractH1(html) {
  const m = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return "";
  return normalizeWhitespace(decodeHtmlEntities(stripHtmlTags(m[1])));
}

function extractJsonLdProducts(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const jsonText = String(match[1] ?? "");
    const parsed = safeParseJson(jsonText);
    if (!parsed) continue;

    const maybeAdd = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(maybeAdd);
        return;
      }
      const t = obj?.["@type"];
      if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(obj);
      if (t == null && obj?.itemListElement) maybeAdd(obj.itemListElement);
      if (!t && obj?.offers && obj?.name) out.push(obj);
    };
    maybeAdd(parsed);
  }
  return out;
}

function extractProductFromJsonLd(products) {
  for (const p of products) {
    const name = normalizeWhitespace(p?.name ?? "");
    const description = normalizeWhitespace(p?.description ?? "");
    const images = p?.image;
    const imageList = Array.isArray(images) ? images : images ? [images] : [];
    const extractedImages = imageList
      .map((x) => String(x ?? ""))
      .map((s) => s.trim())
      .filter(Boolean);

    const brandName = normalizeWhitespace(p?.brand?.name ?? p?.brand ?? "");
    const modelCandidate = normalizeWhitespace(p?.model ?? p?.sku ?? p?.productID ?? "");
    const modelName =
      looksLikeMeasurementToken(modelCandidate) || isNumericOnlyToken(modelCandidate) ? "" : modelCandidate;
    const material = normalizeWhitespace(p?.material ?? "");
    const color = normalizeWhitespace(p?.color ?? "");

    const size = p?.size ? normalizeWhitespace(p.size) : "";
    const width = p?.width != null ? normalizeWhitespace(p.width) : "";
    const height = p?.height != null ? normalizeWhitespace(p.height) : "";
    const depth = p?.depth != null ? normalizeWhitespace(p.depth) : "";
    const length = p?.length != null ? normalizeWhitespace(p.length) : "";

    const dimensions =
      normalizeWhitespace(size) ||
      [width, height, depth]
        .map((x) => x && x.replace(/,/g, "."))
        .filter(Boolean)
        .join(" x ") ||
      [length, width, height]
        .map((x) => x && x.replace(/,/g, "."))
        .filter(Boolean)
        .join(" x ");

    const additionalProperty = Array.isArray(p?.additionalProperty) ? p.additionalProperty : [];
    const additionalMap = {};
    additionalProperty.forEach((ap) => {
      const key = normalizeWhitespace(ap?.name ?? ap?.propertyID ?? "");
      const val = normalizeWhitespace(ap?.value ?? "");
      if (!key) return;
      if (val) additionalMap[String(key).toLowerCase()] = val;
    });

    const material2 = normalizeWhitespace(additionalMap["material"] ?? additionalMap["bezugsstoff"] ?? material);
    const color2 = normalizeWhitespace(additionalMap["farbe"] ?? additionalMap["farben"] ?? color);

    const dims2Raw =
      additionalMap["maße"] ||
      additionalMap["abmessungen"] ||
      additionalMap["dimension"] ||
      additionalMap["größe"] ||
      "";

    const dims2 = normalizeWhitespace(dims2Raw) || dimensions;

    // Optional: "variante/feature" keywords (for the more advanced title pattern).
    const variantValues = [];
    const featureValues = [];
    const categoryValues = [];

    for (const key of Object.keys(additionalMap)) {
      const lowerKey = key.toLowerCase();
      const v = additionalMap[key];
      if (!v) continue;
      if (lowerKey.includes("variante") || lowerKey.includes("variant")) variantValues.push(v);
      if (lowerKey.includes("feature") || lowerKey.includes("merkmal") || lowerKey.includes("funktion")) featureValues.push(v);
      if (lowerKey.includes("kategorie") || lowerKey.includes("category") || lowerKey.includes("produktart"))
        categoryValues.push(v);
    }

    if (name || description || extractedImages.length) {
      return {
        name,
        description,
        images: extractedImages,
        brandName,
        modelName,
        material: material2,
        color: color2,
        dimensions: dims2,
        variantValues: uniqueNonEmpty(variantValues).slice(0, 6),
        featureValues: uniqueNonEmpty(featureValues).slice(0, 6),
        categoryValues: uniqueNonEmpty(categoryValues).slice(0, 3),
      };
    }
  }

  return {
    name: "",
    description: "",
    images: [],
    brandName: "",
    modelName: "",
    material: "",
    color: "",
    dimensions: "",
    variantValues: [],
    featureValues: [],
    categoryValues: [],
  };
}

function resolveUrl(maybeUrl, baseUrl) {
  if (!maybeUrl) return null;
  const s = String(maybeUrl).trim();
  if (!s) return null;
  if (s.startsWith("data:")) return null;
  if (s.startsWith("//")) {
    return `https:${s}`;
  }
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractImagesFromHtml(html, baseUrl, minImages = 0) {
  // IMPORTANT: many pages contain <img> elements for the shop logo,
  // payment-method icons, and other UI bits. We want only product media.
  let urls = [];

  // og:image
  const metaMap = extractMetaByAttributes(html);
  const ogImageKeys = Array.from(metaMap.keys()).filter((k) => k === "og:image" || k.startsWith("og:image:"));
  ogImageKeys.forEach((k) => {
    const v = metaMap.get(k);
    const resolved = resolveUrl(v, baseUrl);
    if (resolved) urls.push(resolved);
  });

  // JSON-LD images
  const jsonLdProducts = extractJsonLdProducts(html);
  const productFromLd = extractProductFromJsonLd(jsonLdProducts);
  productFromLd.images.forEach((i) => {
    const resolved = resolveUrl(i, baseUrl);
    if (resolved) urls.push(resolved);
  });

  // Filter out obvious non-product media from structured sources too
  // (e.g. buggy og:image or JSON-LD that points to a logo/icon).
  const NON_PRODUCT_RE = /(logo|payment|zahlung|paypal|visa|mastercard|klarna|sofort|giropay|sepa|icon|icons)/i;
  urls = urls.filter((u) => {
    const s = String(u || "");
    if (!s) return false;
    const lower = s.toLowerCase();
    if (NON_PRODUCT_RE.test(lower)) return false;
    if (lower.includes(".svg") || lower.includes(".ico") || lower.includes("favicon")) return false;
    return true;
  });

  // If we already have enough product images from structured data,
  // don't fall back to scraping *all* <img> tags.
  const wantMin = Number(minImages || 0);
  if (wantMin > 0 && urls.length >= wantMin) {
    return Array.from(new Set(urls)).slice(0, 60);
  }

  const BLACKLIST_TOKENS = [
    "logo",
    "payment",
    "zahlung",
    "paypal",
    "visa",
    "mastercard",
    "klarna",
    "sofort",
    "giropay",
    "sepa",
    "icon",
    "icons",
    "method",
    "methods",
    "secure",
    "ssl",
    "trusted",
    "trust",
    "trustpilot",
    "shipping",
    "versand",
  ];

  const looksLikeImageFile = (u) => {
    const s = String(u || "");
    // Allow extension-based images OR CDN resize URLs.
    return /\.(jpe?g|png|webp|gif)(?:$|[?#])/i.test(s) || /\/resize\/|_1500_1500|_1_1_|\/media\//i.test(s);
  };

  const isBlacklisted = (u, tagText = "") => {
    const text = `${u || ""} ${tagText || ""}`.toLowerCase();
    return BLACKLIST_TOKENS.some((t) => text.includes(t));
  };

  // <img src="..."> + data-src
  const imgSrcRe = /<img[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  let guard = 0;
  const maxScraped = wantMin > 0 ? wantMin * 12 : 120;
  while ((m = imgSrcRe.exec(html))) {
    guard += 1;
    if (guard > maxScraped) break;

    const src = m?.[1];
    const tag = m?.[0] || "";
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) continue;

    // Skip UI bits (logos, payment methods, etc.).
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']+)["']/i);
    const alt = altMatch ? altMatch[1] : "";
    if (isBlacklisted(resolved, alt) || isBlacklisted(resolved, tag)) continue;

    // Skip non-image assets.
    const lower = String(resolved).toLowerCase();
    if (lower.includes(".svg") || lower.includes(".ico") || lower.includes("favicon")) continue;
    if (!looksLikeImageFile(resolved)) continue;

    urls.push(resolved);

    // Once we have enough images for the UI, stop collecting more to avoid noise.
    if (wantMin > 0 && urls.length >= Math.max(wantMin, 12)) break;
  }

  return Array.from(new Set(urls)).slice(0, 60);
}

function extractExternalOfferUrls(html, mainOrigin, limit = 4) {
  const out = [];
  const seen = new Set();

  const allowHints = [
    "amazon.",
    "otto.",
    "ebay.",
    "wayfair.",
    "home24.",
    "real.",
    "benuta.",
    "kaufland.",
    "ikea.",
    "obi.",
    "bauhaus.",
    "hornbach.",
    "empire.",
    "manomano.",
    "laredoute.",
    "otto.de",
  ];

  const re = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = String(m?.[1] ?? "");
    if (!href) continue;
    const clean = href.split("#")[0];
    if (!clean) continue;
    if (!/^https?:\/\//i.test(clean)) continue;
    let origin = "";
    try {
      origin = new URL(clean).origin;
    } catch {
      origin = "";
    }
    if (mainOrigin && origin && origin === mainOrigin) continue;

    const lower = clean.toLowerCase();
    const hintOk = allowHints.some((h) => lower.includes(h));
    const productPathOk = lower.includes("/product/") || lower.includes("/products/") || lower.includes("/p/");

    if (!hintOk && !productPathOk) continue;
    if (clean.length > 500) continue;

    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }

  return out;
}

function escapeRegExp(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespaceKeepNewlines(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, idx, arr) => line || idx === 0 || idx === arr.length - 1)
    .join("\n")
    .trim();
}

function htmlToTextWithBullets(input) {
  const raw = decodeHtmlEntities(String(input ?? ""));
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h1[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n\s*\n+/g, "\n");
  return normalizeWhitespaceKeepNewlines(text);
}

function extractDimensionsFromText(text) {
  const s = String(text ?? "");
  // e.g. 180x200 cm, 100 x 38,5 x 45 cm, 16 cm
  const m1 = s.match(/(\d+(?:[.,]\d+)?)\s*(x|×)\s*(\d+(?:[.,]\d+)?)(?:\s*(x|×)\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm|m)?/i);
  if (m1) {
    const a = m1[1];
    const b = m1[3];
    const c = m1[5];
    const unit = m1[6] || "";
    const sep = " x ";
    return c ? `${a}${sep}${b}${sep}${c}${unit ? ` ${unit}` : ""}` : `${a}${sep}${b}${unit ? ` ${unit}` : ""}`;
  }
  return "";
}

function looksLikeMeasurementToken(s) {
  const t = String(s ?? "").toLowerCase();
  if (!t) return false;
  if (/(cm|mm|m)\b/.test(t)) return true;
  if (/\b\d+(?:[.,]\d+)?\s*(x|×)\s*\d+(?:[.,]\d+)?\b/.test(t)) return true;
  if (/\b(höhe|breite|tiefe|l[aä]nge)\b/.test(t)) return true;
  return false;
}

function isNumericOnlyToken(s) {
  const t = String(s ?? "").trim();
  if (!t) return false;
  // "463", "463.0", "463,0"
  return /^\d+(?:[.,]\d+)?$/.test(t);
}

function isValidSeriesToken(s) {
  const t = normalizeWhitespace(s || "");
  if (!t) return false;
  if (isNumericOnlyToken(t)) return false;
  if (!/[A-Za-zÄÖÜäöüß]/.test(t)) return false;
  if (/check24/i.test(t)) return false;
  if (t.includes("|")) return false;
  return true;
}

function sanitizeTitleText(input) {
  let s = String(input ?? "");
  // Remove CHECK24 mentions and hard separator pipes.
  s = s.replace(/check24/gi, "");
  // If the input has numeric-only quoted tokens like "'463'", remove them entirely.
  // This avoids wrapping wrong numeric identifiers in ''.
  s = s.replace(/['"]\s*\d+(?:[.,]\d+)?\s*['"]/g, "");
  // Replace separator pipes with spaces (do not truncate the rest; we may have color/dimensions after it).
  s = s.replace(/\|/g, " ");
  // Remove prices like "für 90 €" or "für,90 €" (best-effort)
  s = s.replace(/für\s*[\d.,]+(?:\s?€)?/gi, "");
  // Normalize whitespace and remove trailing punctuation artifacts.
  s = normalizeWhitespace(s).replace(/[,\s]+$/g, "").trim();
  return s;
}

function sanitizeBrandForTitle(input) {
  let s = normalizeWhitespace(input || "");
  if (!s) return "";
  // Keep the brand but strip legal company suffixes from manufacturer names.
  s = s
    .replace(/\b(gmbh|mbh|ag|kg|ug|ohg|gbr|ltd|limited|inc\.?|llc|corp\.?|corporation)\b\.?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s;
}

function dedupeTitleTokens(text) {
  // Remove repeated words/numbers while keeping first occurrence order.
  const tokens = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";

  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const normalized = tok
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .replace(/,/g, ".")
      .trim();
    if (!normalized) {
      out.push(tok);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(tok);
  }
  return out.join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

function sanitizeDescriptionText(input) {
  let s = String(input ?? "");
  s = s.replace(/check24/gi, "");
  s = s.replace(/\|/g, " ");
  return s;
}

function extractQuotedSeries(text) {
  const s = String(text ?? "");
  const re = /['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(s))) {
    const token = normalizeWhitespace(match[1] ?? "");
    if (!token) continue;
    if (looksLikeMeasurementToken(token)) continue;
    return token;
  }
  return "";
}

function extractMeasurementPhrasesFromText(text) {
  const s = String(text ?? "");
  // Examples:
  //  - 90x200 cm
  //  - Höhe 15 cm / Tiefe: 12,5 cm
  const re =
    // Require units for "x/×" patterns to reduce false positives (e.g. product codes).
    // Also support labeled German dimensions.
    /\b\d+(?:[.,]\d+)?\s*(x|×)\s*\d+(?:[.,]\d+)?(?:\s*(x|×)\s*\d+(?:[.,]\d+)?)?\s*(cm|mm|m)\b|\b(höhe|breite|tiefe|l[aä]nge)\s*[:\-]?\s*\d+(?:[.,]\d+)?\s*(cm|mm|m)\b/gi;
  const out = [];
  let match;
  while ((match = re.exec(s))) {
    const phrase = normalizeWhitespace(match[0] ?? "");
    if (!phrase) continue;
    out.push(phrase);
  }
  return out;
}

function stripStarsAndEllipsis(s) {
  return String(s ?? "").replace(/\*/g, "").replace(/…/g, "");
}

function ruleBasedOptimizeTitle({
  originalTitle,
  h1,
  productName,
  brandName,
  modelName,
  material,
  color,
  dimensions,
  variantValues,
  featureValues,
  categoryValues,
}) {
  const base = sanitizeTitleText(normalizeWhitespace(originalTitle || h1 || productName || ""));
  let brand = sanitizeBrandForTitle(brandName || "");
  let series = normalizeWhitespace(modelName || "");
  const mat = normalizeWhitespace(material || "");
  const col = normalizeWhitespace(color || "");
  let dims = normalizeWhitespace(dimensions || "");

  // If we still miss dimensions, try extracting from base text.
  if (!dims || dims.length < 3) {
    const fromText = extractDimensionsFromText(base);
    if (fromText) dims = fromText;
  }

  // Prefer quoted series/model from the original text.
  if (!series) series = extractQuotedSeries(base);

  // Heuristic series fallback: first token that looks like a model (contains digits),
  // but never treat measurement-like tokens as series.
  if (!series) {
    const m = base.match(/\b[A-Za-z]*\d[\w-]*\b/);
    if (m && !looksLikeMeasurementToken(m[0])) series = m[0];
  }

  // Only keep series tokens that look like a real series/model identifier.
  // This prevents numeric-only tokens (e.g. "463") from being wrapped in quotes.
  if (series && !isValidSeriesToken(series)) series = "";

  const hasVariants = Array.isArray(variantValues) && variantValues.length;
  const hasFeatures = Array.isArray(featureValues) && featureValues.length;
  const hasCategory = Array.isArray(categoryValues) && categoryValues.length;
  const category = hasCategory ? categoryValues[0] : "";
  const variants = hasVariants ? variantValues.join(", ") : "";
  const features = hasFeatures ? featureValues.join(", ") : "";

  // Remove brand/series/material/color/dimensions from the addon part to avoid duplication.
  let addon = base;
  if (brand && addon.toLowerCase().startsWith(brand.toLowerCase())) addon = addon.slice(brand.length).trim();
  if (series) {
    addon = addon.replace(new RegExp(`['"]${escapeRegExp(series)}['"]`, "gi"), "").trim();
    addon = addon.replace(new RegExp(`\\b${escapeRegExp(series)}\\b`, "gi"), "").trim();
  }
  if (mat) addon = addon.replace(new RegExp(`\\b${escapeRegExp(mat)}\\b`, "gi"), "").trim();
  if (col) addon = addon.replace(new RegExp(`\\b${escapeRegExp(col)}\\b`, "gi"), "").trim();
  if (dims) addon = addon.replace(new RegExp(escapeRegExp(dims).slice(0, 18), "gi"), "").trim();

  addon = normalizeWhitespace(addon);
  if (!addon) addon = base;

  const matColor = [mat, col].filter(Boolean).join(" ").trim();

  // Prefer "product type" from category (when available); otherwise fall back to first non-brand segment.
  let productType = category || "";
  if (!productType) {
    let tmp = base;
    if (brand && tmp.toLowerCase().startsWith(brand.toLowerCase())) tmp = tmp.slice(brand.length).trim();
    if (series) tmp = tmp.replace(new RegExp(`['"]${escapeRegExp(series)}['"]`, "gi"), "").trim();
    productType = tmp.split(",")[0].trim();
  }

  // Build a prefix WITHOUT measurements; we will re-append all measurements at the very end.
  let titlePrefix = "";
  if (productType && series) {
    titlePrefix = `${productType} '${series}' ${addon}`.trim();
  } else if (productType) {
    titlePrefix = `${productType} ${addon}`.trim();
  } else if (series && brand) {
    titlePrefix = `${brand} '${series}' ${addon}`.trim();
  } else if (series) {
    titlePrefix = `'${series}' ${addon}`.trim();
  } else {
    titlePrefix = addon;
  }

  // Optionally include variants/features (only if they are not already part of the prefix).
  if (variants && !titlePrefix.toLowerCase().includes(variants.toLowerCase().slice(0, 10))) {
    titlePrefix = `${titlePrefix} ${variants}`.trim();
  }
  if (features && !titlePrefix.toLowerCase().includes(features.toLowerCase().slice(0, 10))) {
    titlePrefix = `${titlePrefix} ${features}`.trim();
  }

  // Ensure the brand is present before measurements (measurements are appended later).
  if (brand && !titlePrefix.toLowerCase().includes(brand.toLowerCase())) {
    titlePrefix = `${titlePrefix} ${brand}`.trim();
  }

  let title = decodeHtmlEntities(titlePrefix);
  title = stripStarsAndEllipsis(title);
  title = title.replace(/\s*[-|–|:]\s*$/, "");
  title = sanitizeTitleText(title);

  // Extract all measurement phrases from the current title and re-append them at the end.
  let measurementPhrases = extractMeasurementPhrasesFromText(title);

  const measurementKey = (p) =>
    normalizeWhitespace(p)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/×/g, "x")
      .replace(/,/g, ".");

  // De-duplicate while keeping first occurrence order.
  if (measurementPhrases.length > 1) {
    const seen = new Set();
    const out = [];
    for (const p of measurementPhrases) {
      const k = measurementKey(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    measurementPhrases = out;
  }
  if (dims && looksLikeMeasurementToken(dims)) {
    const normDims = normalizeWhitespace(dims).toLowerCase().replace(/\s+/g, "");
    const hasDims = measurementPhrases.some((p) => measurementKey(p) === measurementKey(normDims));
    if (!hasDims) measurementPhrases.push(dims);
  }

  // Remove measurements from prefix so they don't appear in the middle.
  if (measurementPhrases.length) {
    for (const phrase of measurementPhrases) {
      title = title.replace(new RegExp(escapeRegExp(phrase), "gi"), "");
    }
  }

  title = title.replace(/\s+,/g, ",").replace(/,+/g, ",").replace(/[,\s]+$/g, "").trim();

  // Append material/color ONLY when we actually have measurements.
  if (measurementPhrases.length) {
    const suffix = matColor ? `${matColor}, ${measurementPhrases.join(", ")}` : measurementPhrases.join(", ");
    title = `${title}, ${suffix}`.replace(/\s+,/g, ",").trim();
  }

  // Ensure series is present in quotes if we have it.
  if (series) {
    const quoted = new RegExp(`['"]${escapeRegExp(series)}['"]`, "i").test(title);
    if (!quoted) {
      if (brand && title.toLowerCase().endsWith(brand.toLowerCase())) {
        title = `${title.slice(0, title.length - brand.length).trim()} '${series}' ${brand}`.replace(/\s+/g, " ").trim();
      } else {
        title = `'${series}' ${title}`.replace(/\s+/g, " ").trim();
      }
    }
  }

  title = normalizeWhitespace(title);
  title = dedupeTitleTokens(title);
  title = stripStarsAndEllipsis(title);

  if (isPlaceholderText(title) || !title) return "";
  return title;
}

function truncateByLastNewline(text, maxLen) {
  const s = String(text ?? "");
  if (s.length <= maxLen) return s.trim();
  const cut = s.lastIndexOf("\n", maxLen);
  if (cut > 0) return s.slice(0, cut).trim();
  return s.slice(0, maxLen).trim();
}

function cleanDescriptionOnly(originalDescription) {
  let desc = String(originalDescription ?? "");
  // If the description is HTML, keep structure a bit (bullets/newlines).
  if (/<\w+[^>]*>/.test(desc)) {
    desc = htmlToTextWithBullets(desc);
  } else {
    desc = normalizeWhitespaceKeepNewlines(desc);
  }

  desc = decodeHtmlEntities(desc);
  desc = stripStarsAndEllipsis(desc);
  desc = sanitizeDescriptionText(desc);

  // Remove URLs / tracking.
  desc = desc.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "");

  // Remove generic filler lines we should not send to the feed.
  const lines = desc
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const filtered = lines.filter((l) => {
    const x = l.toLowerCase();
    if (x.includes("weitere produktdetails")) return false;
    if (x.includes("produktseite")) return false;
    if (x.includes("hier erfahren")) return false;
    if (x.includes("download") && x.includes(".pdf")) return false;
    if (x.includes("http")) return false;
    return true;
  });
  desc = filtered.join("\n").trim();

  // Normalize whitespace again (keep newlines)
  desc = normalizeWhitespaceKeepNewlines(desc);

  if (isPlaceholderText(desc)) return "";
  return desc;
}

function ruleBasedOptimizeDescription({ originalDescription, extracted }) {
  let desc = cleanDescriptionOnly(originalDescription);

  function extractLieferumfangBullets(text) {
    const d = normalizeWhitespaceKeepNewlines(String(text ?? ""));
    if (!d) return [];
    const lines = d
      .split("\n")
      .map((l) => String(l ?? "").trim())
      .filter(Boolean);

    const idx = lines.findIndex((l) => /lieferumfang/i.test(l));
    if (idx < 0) return [];

    const items = [];
    const stopRe = /^(maße|material|farbe|varianten|merkmale|beschreibung|hinweis|energie|maßangabe)\b/i;

    const takeFromLine = (line) => {
      let s = String(line ?? "").trim();
      if (!s) return;
      s = s.replace(/https?:\/\/\S+/gi, "").replace(/www\.\S+/gi, "");
      s = s.replace(/lieferumfang[:\s-]*/i, "").trim();
      s = s.replace(/^\s*[•-]\s*/, "").trim();
      s = s.replace(/\s+/g, " ");
      if (!s) return;
      if (s.length > 160) s = s.slice(0, 157).trim() + "...";
      items.push(s);
    };

    for (let j = idx; j < Math.min(lines.length, idx + 7); j += 1) {
      const line = lines[j];
      if (j !== idx && stopRe.test(line)) break;

      if (j === idx) {
        if (line.includes(":")) takeFromLine(line.split(":").slice(1).join(":"));
        continue;
      }

      if (/^[•-]\s*/.test(line)) takeFromLine(line);
      else takeFromLine(line);
    }

    const uniq = [];
    const seen = new Set();
    for (const it of items) {
      const k = it.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(`• ${it}`);
      if (uniq.length >= 6) break;
    }

    return uniq;
  }

  // Build a structured technical bullet block from extracted attributes (feed-ready + no hallucinations).
  const bullets = [];
  const dims = normalizeWhitespace(extracted?.dimensions || "");
  const mat = normalizeWhitespace(extracted?.material || "");
  const col = normalizeWhitespace(extracted?.color || "");
  const variants = Array.isArray(extracted?.variantValues) ? extracted.variantValues : [];
  const features = Array.isArray(extracted?.featureValues) ? extracted.featureValues : [];

  if (dims) bullets.push(`• Maße: ${dims}`);
  if (mat) bullets.push(`• Material: ${mat}`);
  if (col) bullets.push(`• Farbe: ${col}`);
  if (variants.length) bullets.push(`• Varianten: ${variants.filter(Boolean).slice(0, 4).join(", ")}`);
  if (features.length) bullets.push(`• Merkmale: ${features.filter(Boolean).slice(0, 4).join(", ")}`);

  const highlightsBlock = bullets.length ? `Highlights:\n${bullets.join("\n")}` : "";
  const scopeBullets = extractLieferumfangBullets(desc);
  const scopeBlock = scopeBullets.length ? `Lieferumfang:\n${scopeBullets.join("\n")}` : "";

  const tailBlocks = [highlightsBlock, scopeBlock].filter(Boolean);

  // If cleaned original is a placeholder, fall back to structured blocks.
  if (!desc) desc = tailBlocks.join("\n\n");
  else if (tailBlocks.length) desc = `${desc}\n\n${tailBlocks.join("\n\n")}`;

  if (isPlaceholderText(desc) || !desc) return "";

  // Keep within the feed-friendly size window.
  desc = truncateByLastNewline(desc, DEFAULTS.descriptionMaxLength);
  return desc;
}

function checkTitleRules(title, extracted) {
  const issues = [];
  const t = normalizeWhitespace(title || "");
  const brandName = extracted.brandName || "";
  const modelName = extracted.modelName || "";
  const material = extracted.material || "";
  const color = extracted.color || "";
  const dimensions = extracted.dimensions || "";

  if (!t || t.length < DEFAULTS.titleMinLength) issues.push("Titel zu kurz oder leer.");
  if (isPlaceholderText(t)) issues.push("Titel wirkt wie Platzhalter.");

  if (/\*/.test(t) || /…/.test(t)) issues.push("Titel enthält '*' oder '…' (nicht erlaubt).");

  if (/\|/.test(t)) issues.push("Titel darf kein '|' enthalten.");
  if (/check24/i.test(t)) issues.push("Titel darf 'CHECK24' nicht enthalten.");
  if (/\b(gmbh|mbh|ag|kg|ug|ohg|gbr|ltd|limited|inc\.?|llc|corp\.?|corporation)\b/i.test(t)) {
    issues.push("Titel darf keine Firmierungszusätze wie GmbH/AG enthalten.");
  }

  // No repeated words/numbers in title.
  const titleTokens = t
    .split(/\s+/)
    .map((x) => x.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/,/g, ".").trim())
    .filter(Boolean);
  const tokenSeen = new Set();
  let hasTokenDuplicate = false;
  for (const tk of titleTokens) {
    if (tokenSeen.has(tk)) {
      hasTokenDuplicate = true;
      break;
    }
    tokenSeen.add(tk);
  }
  if (hasTokenDuplicate) issues.push("Titel enthält doppelte Wörter/Zahlen (nicht erlaubt).");

  // Avoid marketing fluff.
  const badPhrases = /(super|top|günstig|hochwertig|premium|billig|beste|ideal|unschlagbar|perfekt|traumhaft)/i;
  if (badPhrases.test(t)) issues.push("Titel enthält Marketing-/Werbefloskeln (nicht erlaubt).");

  if (modelName) {
    if (!new RegExp(`\\b${escapeRegExp(modelName)}\\b`, "i").test(t)) {
      issues.push("Serienname (modell) fehlt im Titel.");
    }
    const quoted = new RegExp(`['"]${escapeRegExp(modelName)}['"]`, "i").test(t);
    if (!quoted) issues.push("Serienname muss in Anführungszeichen stehen (z.B. 'FX-CT500').");
  }

  // Validate that the quoted series token matches the extracted modelName.
  const quotedSeries = extractQuotedSeries(t);
  if (modelName && quotedSeries) {
    if (normalizeWhitespace(modelName).toLowerCase() !== normalizeWhitespace(quotedSeries).toLowerCase()) {
      issues.push("Serienname stimmt nicht mit dem Modellnamen überein.");
    }
  }

  // Measurements must be at the very end (including "Höhe 15 cm", etc.).
  const titleMeasurements = extractMeasurementPhrasesFromText(t);
  if (dimensions) {
    if (titleMeasurements.length === 0) {
      issues.push("Maße fehlen oder konnten nicht erkannt werden.");
    } else {
      const last = titleMeasurements[titleMeasurements.length - 1];
      if (!t.toLowerCase().endsWith(normalizeWhitespace(last).toLowerCase())) {
        issues.push("Maße müssen am Ende des Titels stehen.");
      }

      const normExtractDims = normalizeWhitespace(dimensions).toLowerCase().replace(/\s+/g, "");
      const hasExtractDims = titleMeasurements.some(
        (p) => normalizeWhitespace(p).toLowerCase().replace(/\s+/g, "") === normExtractDims
      );
      if (!hasExtractDims && normExtractDims.length > 0) {
        issues.push("Die Maße im Titel passen nicht zu den extrahierten Maßen.");
      }
    }
  }

  const matColor = [material, color].filter(Boolean).join(" ").trim();
  const commaCount = (t.match(/,/g) || []).length;
  if (dimensions && commaCount < 1) {
    issues.push("Titel soll die wichtigsten Abschnitte mit Kommas trennen (z.B. ..., Material Farbe, Maße).");
  }
  if (matColor && dimensions && commaCount < 2) {
    issues.push("Titel muss mit Kommas strukturiert sein (z.B. ..., Material Farbe, Maße).");
  }

  // Variant/size coherence (best-effort): if a variant contains a measurement, it should appear in the title.
  const variantValues = Array.isArray(extracted.variantValues) ? extracted.variantValues : [];
  if (variantValues.length) {
    const variantMeasurements = uniqueNonEmpty(
      variantValues.flatMap((v) => extractMeasurementPhrasesFromText(v))
    ).slice(0, 3);
    if (variantMeasurements.length && titleMeasurements.length) {
      const hasAtLeastOne = variantMeasurements.some((vm) =>
        titleMeasurements.some((tm) => normalizeWhitespace(tm).toLowerCase().replace(/\s+/g, "") === normalizeWhitespace(vm).toLowerCase().replace(/\s+/g, ""))
      );
      if (!hasAtLeastOne) issues.push("Größen/Varianten passen nicht zum Titel.");
    }
  }

  return issues;
}

function evaluateDescriptionQuality(description, extracted) {
  const issues = [];
  const d = normalizeWhitespaceKeepNewlines(description || "");

  if (!d || d.length < DEFAULTS.descriptionMinLength) issues.push("Beschreibung zu kurz oder leer.");
  if (isPlaceholderText(d)) issues.push("Beschreibung wirkt wie Platzhalter.");
  if (/\*/.test(d) || /…/.test(d)) issues.push("Beschreibung enthält '*' oder '…' (nicht erlaubt).");
  if (/\|/.test(d)) issues.push("Beschreibung darf kein '|' enthalten.");
  if (/check24/i.test(d)) issues.push("Beschreibung darf 'CHECK24' nicht enthalten.");

  if (/https?:\/\//i.test(d) || /www\./i.test(d)) issues.push("Beschreibung enthält Links (nicht erlaubt).");

  if (d.length > DEFAULTS.descriptionMaxLength) {
    issues.push(`Beschreibung ist zu lang (max ${DEFAULTS.descriptionMaxLength} Zeichen).`);
  }

  const numeric = /\d/.test(d);
  if (!numeric) issues.push("Beschreibung enthält keine konkreten Werte (z.B. Maße/Größen).");

  const bulletLines = d
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.startsWith("•") || l.startsWith("-") || l.includes("• "));
  const lineCount = d.split("\n").map((l) => l.trim()).filter(Boolean).length;

  // Needs some structure to be considered "High quality"
  if (lineCount < 3 && bulletLines.length === 0) issues.push("Beschreibung wirkt zu generisch (wenig Struktur/Bullets).");
  if (lineCount < 2 && bulletLines.length > 0 && bulletLines.length < 2) {
    issues.push("Beschreibung hat zu wenig Zeilen/Struktur.");
  }

  // Avoid our own generic fallback text
  const badGeneric = /(weitere produktdetails|produktseite|hier erfahren|klicke)/i.test(d);
  if (badGeneric) issues.push("Generischer Fülltext erkannt.");

  // Extracted token coverage (hard-ish checks): if we have extracted attributes,
  // the optimized description should include them (rule-based path should satisfy).
  const dims = normalizeWhitespace(extracted?.dimensions || "");
  const mat = normalizeWhitespace(extracted?.material || "");
  const col = normalizeWhitespace(extracted?.color || "");

  const descNorm = normalizeWhitespace(d).toLowerCase();
  const normKey = (x) => normalizeWhitespace(String(x ?? "")).toLowerCase().replace(/\s+/g, "");

  if (dims) {
    const dimsKey = normKey(dims);
    const descDimsKey = normKey(descNorm).replace(/[,]/g, "");
    if (!descNorm || !descDimsKey.includes(dimsKey)) issues.push("Maße fehlen in der Beschreibung.");
  }
  if (mat) {
    if (!descNorm.includes(normKey(mat))) issues.push("Material fehlt in der Beschreibung.");
  }
  if (col) {
    if (!descNorm.includes(normKey(col))) issues.push("Farbe fehlt in der Beschreibung.");
  }

  return issues;
}

function shouldUseClaudeForText({ title, description, extracted }) {
  const titleIssues = checkTitleRules(title, extracted);
  const descIssues = evaluateDescriptionQuality(description, extracted);

  const hasTechnical =
    Boolean(normalizeWhitespace(extracted?.dimensions || "")) ||
    Boolean(normalizeWhitespace(extracted?.material || "")) ||
    Boolean(normalizeWhitespace(extracted?.color || "")) ||
    (Array.isArray(extracted?.variantValues) && extracted.variantValues.length > 0) ||
    (Array.isArray(extracted?.featureValues) && extracted.featureValues.length > 0);

  const isHardTitleIssue = (msg) =>
    msg.includes("Maße") ||
    msg.includes("Serienname") ||
    msg.includes("Marketing") ||
    msg.includes("Platzhalter") ||
    msg.includes("'*'") ||
    msg.includes("'…'") ||
    msg.includes("CHECK24") ||
    msg.includes("|");

  const isHardDescIssue = (msg) =>
    msg.includes("Links") ||
    msg.includes("'*'") ||
    msg.includes("'…'") ||
    msg.includes("Platzhalter") ||
    msg.includes("keine konkreten Werte") ||
    msg.includes("Generischer Fülltext") ||
    msg.includes("fehlen in der Beschreibung") ||
    msg.includes("ist zu lang") ||
    msg.includes("zu generisch") ||
    msg.includes("CHECK24") ||
    msg.includes("|");

  if (titleIssues.some(isHardTitleIssue)) return true;
  if (descIssues.some(isHardDescIssue)) return true;

  // Threshold fallback: only call Claude when we can't build a structured technical description.
  if (!hasTechnical) {
    if (
      descIssues.some((i) => i.includes("keine konkreten Werte") || i.includes("zu generisch") || i.includes("zu kurz"))
    ) {
      return true;
    }
  }

  return false;
}

async function callClaude({ claudeApiKey, originalTitle, originalDescription, extracted }) {
  const apiKey = String(claudeApiKey || "").trim() || String(process.env.CLAUDE_API_KEY || "").trim();
  if (!apiKey) throw new Error("Claude API key missing.");

  const model = process.env.CLAUDE_MODEL || "claude-3-5-sonnet";

  const prompt = {
    extracted: {
      productName: extracted.productName,
      h1: extracted.h1,
      ogTitle: extracted.ogTitle,
      ogDescription: extracted.ogDescription,
    },
    original: {
      title: originalTitle,
      description: originalDescription,
    },
    constraints: {
      titleMinLength: DEFAULTS.titleMinLength,
      titleMaxLength: DEFAULTS.titleMaxLength,
      descriptionMinLength: DEFAULTS.descriptionMinLength,
      descriptionMaxLength: DEFAULTS.descriptionMaxLength,
      language: "de",
      avoidHallucinations: true,
      doNotInventFacts: true,
    },
    instructions: [
      "Optimieren Sie Titel und Beschreibung für einen Feed-Eintrag.",
      "Nutzen Sie nur Informationen, die im Originaltext oder in den extrahierten Feldern vorhanden sind.",
      "Wenn Informationen fehlen, bleiben Sie allgemein (keine erfundenen Spezifikationen).",
      "Titel-Regeln: Keine '…' und kein '*'. Serien-/Modellname (falls vorhanden) muss im Titel vorkommen und in Anführungszeichen stehen. Verwenden Sie Kommas, um Abschnitte zu trennen (z.B. ..., Material Farbe, Maße).",
      "Titel-Regeln: Alle Maße/Größen müssen am SEHR ENDE des Titels stehen (z.B. '90x200 cm', 'Höhe 15 cm').",
      "Titel-Regeln: Verwenden Sie niemals den Trennstrich '|' und erwähnen Sie niemals 'CHECK24'.",
      "Beschreibung-Regeln: Keine Links/URLs, keine generischen Füllsätze; Beschreibung soll konkrete Werte (z.B. Maße/Größen) und etwas Struktur (Bullets/Absätze) enthalten, wenn im Original vorhanden.",
      "Beschreibung-Regeln: Keine '…' und kein '*'. Keine Platzhalter.",
      "Beschreibung-Regeln: Verwenden Sie niemals den Trennstrich '|' und erwähnen Sie niemals 'CHECK24'.",
      "Beschreibung-Format: Füge am ENDE der Beschreibung zwei Abschnitte hinzu (ohne '*', ohne '…'). 1) 'Highlights:' gefolgt von 5-8 Bulletpoints mit '• ' (z.B. Maße/Material/Farbe/Varianten/Merkmale, nur wenn vorhanden). 2) 'Lieferumfang:' gefolgt von 2-5 Bulletpoints mit '• ' (nur aus dem Originaltext; wenn kein Lieferumfang erkennbar ist, Abschnitt 'Lieferumfang:' weglassen).",
      `Beachte: Gesamtlänge der Beschreibung max ${DEFAULTS.descriptionMaxLength} Zeichen. Kürze bei Bedarf, aber halte sie so informativ wie möglich.`,
      "Geben Sie ausschließlich JSON zurück mit {title, description, issues, rationale}.",
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 700,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude call failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text || "";

  // Content should be JSON. Try to parse, otherwise attempt to salvage JSON substring.
  const parsed = safeParseJson(content);
  if (parsed && parsed.title && parsed.description) return parsed;

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybe = safeParseJson(content.slice(start, end + 1));
    if (maybe && maybe.title && maybe.description) return maybe;
  }

  throw new Error("Claude returned invalid JSON.");
}

export async function POST(req) {
  try {
    const body = await req.json();
    const url = String(body?.url || "").trim();
    const claudeApiKey = String(body?.claudeApiKey || process.env.CLAUDE_API_KEY || "").trim();
    const minImages = Number(body?.minImages ?? DEFAULTS.minImages);

    if (!url) return Response.json({ error: "Missing url" }, { status: 400 });
    if (!/^https?:\/\//i.test(url)) return Response.json({ error: "URL must start with http(s)://" }, { status: 400 });

    let baseUrl;
    try {
      baseUrl = new URL(url).toString();
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Fetch HTML
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    let html = "";
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "FeedChecker-ProductOptimizer/1.0" },
      });
      clearTimeout(t);
      if (!res.ok) return Response.json({ error: `Fetch failed: ${res.status}` }, { status: 400 });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        // Still try to read as text; many sites respond with html but different content type.
      }
      html = await res.text();
      if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
    } catch (e) {
      clearTimeout(t);
      return Response.json({ error: `Fetch error: ${String(e?.message || e)}` }, { status: 400 });
    }

    const h1 = extractH1(html);
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    const isCheck24 = host.includes("moebel.check24.de");

    let originalTitle = "";
    let originalDescription = "";
    if (isCheck24) {
      const check24 = extractCheck24ProductFromEmbeddedJson(html);
      if (check24?.title) originalTitle = check24.title;
      if (check24?.description) originalDescription = check24.description;
    }

    // Fallbacks for cases where embedded JSON is missing/unexpected.
    if (!originalTitle || !originalDescription) {
      const metaRes = extractTitleAndDescriptionFromHtml(html);
      originalTitle = originalTitle || metaRes.originalTitle;
      originalDescription = originalDescription || metaRes.originalDescription;
    }

    const jsonLdProducts = extractJsonLdProducts(html);
    const productFromLd = extractProductFromJsonLd(jsonLdProducts);
    const productName = productFromLd.name || h1 || originalTitle;

    let extractedImages = extractImagesFromHtml(html, baseUrl, minImages);
    if (isCheck24) {
      const check24 = extractCheck24ProductFromEmbeddedJson(html);
      if (check24?.image_urls?.length) {
        extractedImages = Array.from(new Set([...extractedImages, ...check24.image_urls]));
      }
    }

    // Og meta for transparency
    const metaMap = extractMetaByAttributes(html);
    const ogTitle = metaMap.get("og:title") || "";
    const ogDescription = metaMap.get("og:description") || metaMap.get("description") || "";

    const mainOrigin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    })();
    const offerUrls = extractExternalOfferUrls(html, mainOrigin, 3);

    const offers = [];
    for (const offerUrl of offerUrls) {
      try {
        const offerBaseUrl = new URL(offerUrl).toString();
        const offerController = new AbortController();
        const offerTimeout = setTimeout(() => offerController.abort(), 10000);

        const offerRes = await fetch(offerUrl, {
          method: "GET",
          redirect: "follow",
          signal: offerController.signal,
          headers: { "User-Agent": "FeedChecker-ProductOptimizer/1.0" },
        });
        clearTimeout(offerTimeout);

        if (!offerRes.ok) continue;
        let offerHtml = await offerRes.text();
        if (offerHtml.length > 2_000_000) offerHtml = offerHtml.slice(0, 2_000_000);

        const offerH1 = extractH1(offerHtml);
        const { originalTitle: offerOriginalTitle, originalDescription: offerOriginalDescription } =
          extractTitleAndDescriptionFromHtml(offerHtml);

        const offerJsonLdProducts = extractJsonLdProducts(offerHtml);
        const offerProductFromLd = extractProductFromJsonLd(offerJsonLdProducts);
        const offerImages = extractImagesFromHtml(offerHtml, offerBaseUrl, minImages);

        extractedImages = Array.from(new Set([...extractedImages, ...offerImages]));

        offers.push({
          url: offerUrl,
          h1: offerH1,
          originalTitle: offerOriginalTitle,
          originalDescription: offerOriginalDescription,
          productFromLd: offerProductFromLd,
          imagesCount: offerImages.length,
        });
      } catch {
        // Best-effort only; ignore offer failures.
      }
    }

    const offerCount = offers.length;

    let combinedExtracted = {
      brandName: productFromLd.brandName || offers.map((o) => o.productFromLd.brandName).find((v) => normalizeWhitespace(v).length) || "",
      modelName: productFromLd.modelName || offers.map((o) => o.productFromLd.modelName).find((v) => normalizeWhitespace(v).length) || "",
      material: productFromLd.material || offers.map((o) => o.productFromLd.material).find((v) => normalizeWhitespace(v).length) || "",
      color: productFromLd.color || offers.map((o) => o.productFromLd.color).find((v) => normalizeWhitespace(v).length) || "",
      dimensions:
        productFromLd.dimensions ||
        offers.map((o) => o.productFromLd.dimensions).find((v) => normalizeWhitespace(v).length) ||
        "",
      variantValues: uniqueNonEmpty([
        ...(productFromLd.variantValues || []),
        ...offers.flatMap((o) => o.productFromLd.variantValues || []),
      ]).slice(0, 6),
      featureValues: uniqueNonEmpty([
        ...(productFromLd.featureValues || []),
        ...offers.flatMap((o) => o.productFromLd.featureValues || []),
      ]).slice(0, 6),
      categoryValues: uniqueNonEmpty([
        ...(productFromLd.categoryValues || []),
        ...offers.flatMap((o) => o.productFromLd.categoryValues || []),
      ]).slice(0, 3),
    };

    // If JSON-LD accidentally picked a dimension-like token as "model/series",
    // prefer a quoted series token from title/H1 (e.g. 'Twist').
    const quotedSeries = extractQuotedSeries(originalTitle) || extractQuotedSeries(h1);
    if (quotedSeries) {
      if (!combinedExtracted.modelName || looksLikeMeasurementToken(combinedExtracted.modelName)) {
        combinedExtracted = { ...combinedExtracted, modelName: quotedSeries };
      }
    }

    const productNameBest =
      normalizeWhitespace(productName).length
        ? productName
        : productFromLd.name ||
          offers.map((o) => o.productFromLd.name || o.originalTitle).find((v) => normalizeWhitespace(v).length) ||
          "";

    const titleCandidateSources = [];
    const addTitleSource = (t, h1Source) => {
      const norm = normalizeWhitespace(t);
      if (!norm) return;
      if (titleCandidateSources.some((x) => x.originalTitle === norm && x.h1 === h1Source)) return;
      titleCandidateSources.push({ originalTitle: norm, h1: normalizeWhitespace(h1Source) });
    };

    addTitleSource(productFromLd.name || originalTitle, h1);
    addTitleSource(originalTitle, h1);
    addTitleSource(h1, h1);
    offers.forEach((o) => {
      addTitleSource(o.productFromLd.name || o.originalTitle, o.h1);
      addTitleSource(o.originalTitle, o.h1);
    });

    let optimizedTitle = "";
    let bestTitleScore = Number.POSITIVE_INFINITY;
    let bestTitleLen = 0;
    let textOptimizationMode = "rule-based";

    const isHardTitleIssueFinal = (msg) =>
      msg.includes("Maße") ||
      msg.includes("Serienname") ||
      msg.includes("Marketing") ||
      msg.includes("Platzhalter") ||
      msg.includes("'*'") ||
      msg.includes("'…'") ||
      msg.includes("CHECK24") ||
      msg.includes("|");

    const scoreTitleIssues = (issues, len) => {
      const hardCount = issues.filter((i) => isHardTitleIssue(i)).length;
      const softCount = issues.length - hardCount;
      // Penalize very long titles to keep titles usable even when >80 is allowed.
      const lenPenalty = Math.max(0, len - DEFAULTS.titleMaxLength);
      return hardCount * 100000 + softCount * 100 + lenPenalty;
    };

    for (const cand of titleCandidateSources) {
      const candidateOptim = ruleBasedOptimizeTitle({
        originalTitle: cand.originalTitle,
        h1: cand.h1,
        productName: productNameBest,
        ...combinedExtracted,
      });
      const issues = checkTitleRules(candidateOptim, combinedExtracted);
      const len = candidateOptim?.length ?? 0;
      if (!candidateOptim) continue;
      const score = scoreTitleIssues(issues, len);
      if (score < bestTitleScore || (score === bestTitleScore && len > bestTitleLen)) {
        bestTitleScore = score;
        bestTitleLen = len;
        optimizedTitle = candidateOptim;
      }
    }
    if (!optimizedTitle) {
      optimizedTitle = ruleBasedOptimizeTitle({
        originalTitle: productFromLd.name || originalTitle,
        h1,
        productName: productNameBest,
        ...combinedExtracted,
      });
    }

    const descriptionCandidateSources = [];
    const addDescSource = (d) => {
      const s = String(d ?? "");
      if (!normalizeWhitespace(s).length) return;
      if (descriptionCandidateSources.includes(s)) return;
      descriptionCandidateSources.push(s);
    };
    addDescSource(productFromLd.description || originalDescription);
    addDescSource(originalDescription);
    offers.forEach((o) => {
      addDescSource(o.productFromLd.description || o.originalDescription);
      addDescSource(o.originalDescription);
    });

    let optimizedDescription = "";
    let bestDescScore = Number.POSITIVE_INFINITY;
    let bestDescLen = 0;
    for (const candDesc of descriptionCandidateSources) {
      const candidateOptim = ruleBasedOptimizeDescription({ originalDescription: candDesc, extracted: combinedExtracted });
      const issues = evaluateDescriptionQuality(candidateOptim, combinedExtracted);
      const len = candidateOptim?.length ?? 0;
      if (!candidateOptim) continue;

      const isHardDescIssue = (msg) =>
        msg.includes("Links") ||
        msg.includes("'*'") ||
        msg.includes("'…'") ||
        msg.includes("Platzhalter") ||
        msg.includes("keine konkreten Werte") ||
        msg.includes("Generischer Fülltext") ||
        msg.includes("fehlen in der Beschreibung") ||
        msg.includes("ist zu lang") ||
        msg.includes("zu generisch") ||
        msg.includes("CHECK24") ||
        msg.includes("|");

      const scoreDescriptionIssues = (issuesList, length) => {
        const hardCount = issuesList.filter((i) => isHardDescIssue(i)).length;
        const softCount = issuesList.length - hardCount;
        const lenPenalty = length < DEFAULTS.descriptionMinLength ? DEFAULTS.descriptionMinLength - length : 0;
        return hardCount * 100000 + softCount * 100 + lenPenalty;
      };

      const score = scoreDescriptionIssues(issues, len);
      if (score < bestDescScore || (score === bestDescScore && len > bestDescLen)) {
        bestDescScore = score;
        bestDescLen = len;
        optimizedDescription = candidateOptim;
      }
    }
    if (!optimizedDescription) {
      optimizedDescription = ruleBasedOptimizeDescription({
        originalDescription: productFromLd.description || originalDescription,
        extracted: combinedExtracted,
      });
    }

    // If the scraped original title/description already satisfies our validators,
    // keep it (with minimal sanitation) to avoid unnecessary rewrites.
    // This also allows the UI to show “passed check” with only small changes.
    const cleanedOriginalTitle = sanitizeTitleText(
      stripStarsAndEllipsis(normalizeWhitespace(originalTitle || productFromLd.name || ""))
    );
    const cleanedOriginalDescription = cleanDescriptionOnly(originalDescription);
    const originalTitleIssues = checkTitleRules(cleanedOriginalTitle, combinedExtracted);
    const originalDescriptionIssues = evaluateDescriptionQuality(cleanedOriginalDescription, combinedExtracted);
    const originalPassed = originalTitleIssues.length === 0 && originalDescriptionIssues.length === 0;

    // Score "before optimisation"
    // (use the same scoring heuristic we apply later to the optimized title/description)
    const clampScoreForOriginal = (n) => Math.max(0, Math.min(100, Math.round(n)));
    const isHardTitleIssueForOriginal = (msg) =>
      msg.includes("Maße") ||
      msg.includes("Serienname") ||
      msg.includes("Marketing") ||
      msg.includes("Platzhalter") ||
      msg.includes("'*'") ||
      msg.includes("'…'") ||
      msg.includes("CHECK24") ||
      msg.includes("|");

    const isHardDescIssueForOriginal = (msg) =>
      msg.includes("Links") ||
      msg.includes("'*'") ||
      msg.includes("'…'") ||
      msg.includes("Platzhalter") ||
      msg.includes("keine konkreten Werte") ||
      msg.includes("Generischer Fülltext") ||
      msg.includes("fehlen in der Beschreibung") ||
      msg.includes("ist zu lang") ||
      msg.includes("zu generisch") ||
      msg.includes("CHECK24") ||
      msg.includes("|");

    const titleHardCountBefore = originalTitleIssues.filter((i) => isHardTitleIssueForOriginal(i)).length;
    const titleSoftCountBefore = originalTitleIssues.length - titleHardCountBefore;
    const titleScoreBefore = clampScoreForOriginal(100 - titleHardCountBefore * 25 - titleSoftCountBefore * 8);

    const descHardCountBefore = originalDescriptionIssues.filter((i) => isHardDescIssueForOriginal(i)).length;
    const descSoftCountBefore = originalDescriptionIssues.length - descHardCountBefore;
    const descriptionScoreBefore = clampScoreForOriginal(100 - descHardCountBefore * 25 - descSoftCountBefore * 8);

    const dimsOkBefore = Boolean(normalizeWhitespace(combinedExtracted?.dimensions || ""));
    const matOkBefore = Boolean(normalizeWhitespace(combinedExtracted?.material || ""));
    const colOkBefore = Boolean(normalizeWhitespace(combinedExtracted?.color || ""));
    const variantOkBefore = Array.isArray(combinedExtracted?.variantValues) && combinedExtracted.variantValues.length > 0;
    const featureOkBefore = Array.isArray(combinedExtracted?.featureValues) && combinedExtracted.featureValues.length > 0;
    const categoryOkBefore = Array.isArray(combinedExtracted?.categoryValues) && combinedExtracted.categoryValues.length > 0;

    // Weights sum to 100.
    const attributeScoreBefore = clampScoreForOriginal(
      (dimsOkBefore ? 25 : 0) +
        (matOkBefore ? 20 : 0) +
        (colOkBefore ? 20 : 0) +
        (variantOkBefore ? 15 : 0) +
        (featureOkBefore ? 10 : 0) +
        (categoryOkBefore ? 10 : 0)
    );

    const scoreBefore = clampScoreForOriginal(
      titleScoreBefore * 0.4 + descriptionScoreBefore * 0.4 + attributeScoreBefore * 0.2
    );

    if (originalPassed) {
      optimizedTitle = cleanedOriginalTitle;
      optimizedDescription = cleanedOriginalDescription;
      textOptimizationMode = "minimal";
    }

    const needsClaude = shouldUseClaudeForText({
      title: optimizedTitle,
      description: optimizedDescription,
      extracted: combinedExtracted,
    });

    let usedClaude = false;
    let claudeIssues = [];
    let rationale = [];

    if (needsClaude && claudeApiKey) {
      const claudeResult = await callClaude({
        claudeApiKey,
        originalTitle: originalTitle || productFromLd.name || "",
        originalDescription: originalDescription || productFromLd.description || "",
        extracted: {
          productName: productName || "",
          h1,
          ogTitle,
          ogDescription,
        },
      });

      optimizedTitle = normalizeWhitespace(claudeResult?.title ?? "");
      optimizedTitle = stripStarsAndEllipsis(optimizedTitle);
      optimizedTitle = sanitizeTitleText(normalizeWhitespace(optimizedTitle));
      optimizedDescription = stripStarsAndEllipsis(
        normalizeWhitespaceKeepNewlines(claudeResult?.description ?? "")
      );
      optimizedDescription = sanitizeDescriptionText(optimizedDescription);
      claudeIssues = Array.isArray(claudeResult?.issues) ? claudeResult.issues : [];
      rationale = Array.isArray(claudeResult?.rationale) ? claudeResult.rationale : [];
      usedClaude = true;
    }

    const titleIssues = checkTitleRules(optimizedTitle, combinedExtracted);
    const descriptionIssues = evaluateDescriptionQuality(optimizedDescription, combinedExtracted);

    const clampScore = (n) => Math.max(0, Math.min(100, Math.round(n)));

    const isHardTitleIssue = (msg) =>
      msg.includes("Maße") ||
      msg.includes("Serienname") ||
      msg.includes("Marketing") ||
      msg.includes("Platzhalter") ||
      msg.includes("'*'") ||
      msg.includes("'…'") ||
      msg.includes("CHECK24") ||
      msg.includes("|");

    const isHardDescIssueFinal = (msg) =>
      msg.includes("Links") ||
      msg.includes("'*'") ||
      msg.includes("'…'") ||
      msg.includes("Platzhalter") ||
      msg.includes("keine konkreten Werte") ||
      msg.includes("Generischer Fülltext") ||
      msg.includes("fehlen in der Beschreibung") ||
      msg.includes("ist zu lang") ||
      msg.includes("zu generisch") ||
      msg.includes("CHECK24") ||
      msg.includes("|");

    const titleHardCount = titleIssues.filter((i) => isHardTitleIssueFinal(i)).length;
    const titleSoftCount = titleIssues.length - titleHardCount;
    const titleScore = clampScore(100 - titleHardCount * 25 - titleSoftCount * 8);

    const descHardCount = descriptionIssues.filter((i) => isHardDescIssueFinal(i)).length;
    const descSoftCount = descriptionIssues.length - descHardCount;
    const descriptionScore = clampScore(100 - descHardCount * 25 - descSoftCount * 8);

    const dimsOk = Boolean(normalizeWhitespace(combinedExtracted?.dimensions || ""));
    const matOk = Boolean(normalizeWhitespace(combinedExtracted?.material || ""));
    const colOk = Boolean(normalizeWhitespace(combinedExtracted?.color || ""));
    const variantOk = Array.isArray(combinedExtracted?.variantValues) && combinedExtracted.variantValues.length > 0;
    const featureOk = Array.isArray(combinedExtracted?.featureValues) && combinedExtracted.featureValues.length > 0;
    const categoryOk = Array.isArray(combinedExtracted?.categoryValues) && combinedExtracted.categoryValues.length > 0;

    // Weights sum to 100.
    const attributeScore = clampScore((dimsOk ? 25 : 0) + (matOk ? 20 : 0) + (colOk ? 20 : 0) + (variantOk ? 15 : 0) + (featureOk ? 10 : 0) + (categoryOk ? 10 : 0));

    const passedText = titleIssues.length === 0 && descriptionIssues.length === 0;
    const overallScore = clampScore(titleScore * 0.4 + descriptionScore * 0.4 + attributeScore * 0.2);

    const imageIssues = [];
    const enoughImages = extractedImages.length >= minImages;
    if (!enoughImages) imageIssues.push(`Nur ${extractedImages.length} Bilder gefunden (empfohlen: mindestens ${minImages}).`);
    if (!extractedImages.length) imageIssues.push("Keine Bild-URLs gefunden.");

    const issues = [...titleIssues, ...descriptionIssues, ...imageIssues];
    if (needsClaude && !claudeApiKey) {
      issues.push("Claude API Key fehlt im Backend (Env: CLAUDE_API_KEY). Es wurde nur regelbasiert optimiert.");
    }

    // ── Analytics logging (best effort) ──────────────────────────────────────
    try {
      const date = todayKey();
      await Promise.all([
        bumpNumber(`${ANALYTICS_PREFIX}:totalRuns`, 1),
        bumpNumber(`${ANALYTICS_PREFIX}:daily:${date}:totalRuns`, 1),
        usedClaude ? bumpNumber(`${ANALYTICS_PREFIX}:totalClaudeUsed`, 1) : bumpNumber(`${ANALYTICS_PREFIX}:totalClaudeUsed`, 0),
        usedClaude ? bumpNumber(`${ANALYTICS_PREFIX}:daily:${date}:totalClaudeUsed`, 1) : bumpNumber(`${ANALYTICS_PREFIX}:daily:${date}:totalClaudeUsed`, 0),
        enoughImages ? bumpNumber(`${ANALYTICS_PREFIX}:imageEnoughTrue`, 1) : bumpNumber(`${ANALYTICS_PREFIX}:imageEnoughTrue`, 0),
        !enoughImages ? bumpNumber(`${ANALYTICS_PREFIX}:imageEnoughFalse`, 1) : bumpNumber(`${ANALYTICS_PREFIX}:imageEnoughFalse`, 0),
        bumpNumber(`${ANALYTICS_PREFIX}:offerCountSum`, offerCount),
        bumpNumber(`${ANALYTICS_PREFIX}:offerCountN`, 1),
      ]);
    } catch (e) {
      // Don't block the feature if analytics fails.
    }

    const offersChecked = offers
      .map((o) => {
        let domain = "";
        try {
          domain = new URL(o.url).hostname;
        } catch {
          domain = "";
        }
        const title = normalizeWhitespace(o.originalTitle || o.h1 || "");
        return {
          url: o.url,
          domain,
          title: title ? title.slice(0, 100) : "",
          imagesCount: o.imagesCount,
        };
      })
      .slice(0, 6);

    return Response.json({
      original: {
        title: normalizeWhitespace(originalTitle || productFromLd.name || ""),
        description: normalizeWhitespace(originalDescription || productFromLd.description || ""),
      },
      optimized: {
        title: optimizedTitle,
        description: optimizedDescription,
      },
      extracted: {
        productName: normalizeWhitespace(productName || ""),
        h1,
        ogTitle,
        ogDescription,
        imageCount: extractedImages.length,
        images: extractedImages,
      },
      feedback: {
        enoughImages,
        issues,
        titleIssues,
        descriptionIssues,
        imageIssues,
        needsClaude,
        usedClaude,
        score: overallScore,
        scoreBefore,
        titleScoreBefore,
        descriptionScoreBefore,
        titleScore,
        descriptionScore,
        attributeScore,
        passedText,
        optimizationMode: textOptimizationMode,
        offerCount: offers.length,
      },
      ai: usedClaude
        ? {
            claudeIssues,
            rationale,
          }
        : null,
      meta: {
        url,
        minImages,
        offersChecked,
      },
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}


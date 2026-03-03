import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

const DEFAULT_RULES = {
    allowed_shipping_mode: ["Paket", "Spedition"],
    title_min_length: 10,
    description_min_length: 50,
    image_min_per_product: 3,
    delivery_includes_pattern: "(^|\\s)(\\d+)\\s*[xX×]\\s*\\S+",
  };

async function apiGetRules() {
  const res = await fetch("/api/rules", { method: "GET" });
  if (!res.ok) throw new Error(`rules GET failed ${res.status}`);
  return await res.json();
}

async function apiPutRules(rules, adminToken) {
    const res = await fetch("/api/rules", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": String(adminToken || ""),
      },
      body: JSON.stringify(rules),
    });
  
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`rules PUT failed ${res.status} ${text}`);
    }
    return await res.json();
  }


function normalizeKey(input) {
  const s = String(input ?? "");
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9_ ]/g, "")
    .replace(/\s/g, "_");
}

function bestHeaderMatch(headers, candidates) {
  const safeHeaders = (Array.isArray(headers) ? headers : []).filter((h) => h !== null && h !== undefined);
  const safeCandidates = (Array.isArray(candidates) ? candidates : []).filter((c) => c !== null && c !== undefined);

  const normHeaders = safeHeaders.map((h) => ({ raw: h, norm: normalizeKey(h) }));
  const normCandidates = safeCandidates.map((c) => normalizeKey(c));

  for (const c of normCandidates) {
    const exact = normHeaders.find((h) => h.norm === c);
    if (exact) return exact.raw;
  }

  for (const c of normCandidates) {
    const contains = normHeaders.find((h) => h.norm.includes(c) || c.includes(h.norm));
    if (contains) return contains.raw;
  }

  return null;
}

function looksLikeScientificEAN(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return /\d+\.\d+e\+\d+/i.test(s);
}

function isBlank(value) {
  const s = String(value ?? "").trim();
  return s === "";
}

function countNonEmptyImageLinks(row, imageCols) {
  let count = 0;
  for (const c of imageCols) {
    const v = String(row?.[c] ?? "").trim();
    if (v) count += 1;
  }
  return count;
}

function findDuplicateIndexes(values) {
  const list = Array.isArray(values) ? values : [];
  const map = new Map();
  list.forEach((v, idx) => {
    const key = String(v ?? "").trim();
    if (!key) return;
    const prev = map.get(key);
    if (prev) prev.push(idx);
    else map.set(key, [idx]);
  });
  const dup = new Set();
  for (const idxs of map.values()) {
    if (idxs.length > 1) idxs.forEach((i) => dup.add(i));
  }
  return dup;
}

function buildEmail({ shopName, issues, tips, canStart }) {
  const subject = "CHECK24 Produktdatenfeed Pruefung Ergebnisse und naechste Schritte";
  const greeting = shopName ? `Hallo ${shopName},` : "Hallo,";

  const intro =
    "wir haben Ihren Produktdatenfeed automatisiert geprueft. Unten finden Sie die wichtigsten Punkte, die fuer eine erfolgreiche automatische Produktanlage angepasst werden sollten.";

  const issueLines = issues.length ? issues.map((x) => `⚠️ ${x}`).join("\n") : "⚠️ Keine kritischen Fehler erkannt.";

  const tipLines = tips.length ? tips.map((x) => `💡 ${x}`).join("\n") : "💡 Keine weiteren Verbesserungsvorschlaege.";

  const decision = canStart
    ? "Wir koennen mit dem Feed starten."
    : "Bitte passen Sie die Punkte oben an. Erst danach koennen wir mit dem Feed starten.";

  const closing = "Viele Gruesse\nCHECK24 Shopping\n\nHinweis Dies ist eine automatisch erstellte Nachricht.";

  return [`Betreff: ${subject}`, "", greeting, "", intro, "", issueLines, "", tipLines, "", decision, "", closing].join("\n");
}

function Pill({ tone, children }) {
  const bg = tone === "ok" ? "#E8F5E9" : tone === "warn" ? "#FFF8E1" : tone === "bad" ? "#FFEBEE" : "#EEF2FF";
  const fg = tone === "ok" ? "#1B5E20" : tone === "warn" ? "#7A5B00" : tone === "bad" ? "#B71C1C" : "#1E3A8A";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function StepCard({ title, status, subtitle, children }) {
  const border =
    status === "ok" ? "#A5D6A7" : status === "warn" ? "#FFE082" : status === "bad" ? "#EF9A9A" : "#E5E7EB";
  const icon = status === "ok" ? "✅" : status === "warn" ? "⚠️" : status === "bad" ? "⛔" : "⬜";
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: 16,
        padding: 16,
        background: "white",
        boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div style={{
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    fontSize: 13,
  }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 18 }}>{icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          </div>
          {subtitle ? <div style={{ marginTop: 6, color: "#4B5563", fontSize: 13 }}>{subtitle}</div> : null}
        </div>
        <div>
          {status === "ok" ? <Pill tone="ok">OK</Pill> : null}
          {status === "warn" ? <Pill tone="warn">Hinweis</Pill> : null}
          {status === "bad" ? <Pill tone="bad">Fehler</Pill> : null}
          {status === "idle" ? <Pill tone="info">Wartet</Pill> : null}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </div>
  );
}

function SmallText({ children }) {
  return <div style={{ fontSize: 12, color: "#6B7280", lineHeight: "18px" }}>{children}</div>;
}

function Table({ columns, rows, highlight }) {
  return (
    <div style={{ overflowX: "auto", maxWidth: "100%", border: "1px solid #E5E7EB", borderRadius: 12 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, width: "max-content", minWidth: "100%" }}>
        <thead>
          <tr style={{ background: "#F9FAFB" }}>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid #E5E7EB",
                  color: "#111827",
                  whiteSpace: "normal",
                  maxWidth: 180,
                  minWidth: 140,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isHot = highlight ? highlight(r, i) : false;
            return (
              <tr key={i} style={{ background: isHot ? "#FFF7ED" : "white" }}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #F3F4F6",
                      color: "#111827",
                      whiteSpace: "normal",
                      maxWidth: 180,
                      minWidth: 140,
                      wordBreak: "break-word",
                    }}
                  >
                    {String(r?.[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function uniqueNonEmpty(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function sampleUniqueValues(rows, col, limit) {
  if (!col) return [];
  const vals = [];
  for (const r of rows) {
    const v = String(r?.[col] ?? "").trim();
    if (v) vals.push(v);
    if (vals.length > limit * 20) break;
  }
  return uniqueNonEmpty(vals).slice(0, limit);
}

function firstImageUrls(rows, imageCols, limit) {
  const urls = [];
  for (const r of rows) {
    for (const c of imageCols) {
      const u = String(r?.[c] ?? "").trim();
      if (u) urls.push(u);
      if (urls.length >= limit * 10) break;
    }
    if (urls.length >= limit * 10) break;
  }
  return uniqueNonEmpty(urls).slice(0, limit);
}

function CollapsibleList({ title, items, tone, hint }) {
  const count = items.length;
  return (
    <details style={{ border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, background: "white" }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
        <Pill tone={tone}>{count}</Pill>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{title}</span>
        {hint ? (
          <span style={{ fontSize: 12, color: "#6B7280" }}>{hint}</span>
        ) : (
          <span style={{ fontSize: 12, color: "#6B7280" }}>zum Oeffnen klicken</span>
        )}
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.slice(0, 500).map((x) => (
          <span
            key={x}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #E5E7EB",
              background: "#F9FAFB",
              color: "#111827",
            }}
          >
            {x}
          </span>
        ))}
      </div>
      {items.length > 500 ? <SmallText>Es werden nur die ersten 500 Werte angezeigt, damit die Ansicht schnell bleibt.</SmallText> : null}
    </details>
  );
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: "1 1 260px", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
      />
    </div>
  );
}

function runSelfTests() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`Self test failed: ${msg}`);
  };

  assert(normalizeKey("  EAN  ") === "ean", "normalizeKey trims and normalizes");
  assert(normalizeKey("image_url 0") === "image_url_0", "normalizeKey keeps digits");
  assert(normalizeKey("image url 0") === "image_url_0", "normalizeKey replaces spaces with underscore");
  assert(normalizeKey("IMAGE_URL 0") === "image_url_0", "normalizeKey is case insensitive");
  assert(normalizeKey(null) === "", "normalizeKey handles null");
  assert(normalizeKey(undefined) === "", "normalizeKey handles undefined");
  assert(normalizeKey(123) === "123", "normalizeKey handles numbers");

  assert(looksLikeScientificEAN("4.07053E+12") === true, "scientific EAN detected");
  assert(looksLikeScientificEAN("4070531234567") === false, "plain number not scientific");

  const dups = findDuplicateIndexes(["a", "b", "a", "", null, "b"]);
  assert(dups.has(0) && dups.has(2) && dups.has(1) && dups.has(5), "findDuplicateIndexes marks all duplicates");

  const imgCount = countNonEmptyImageLinks({ a: "x", b: "", c: " y " }, ["a", "b", "c"]);
  assert(imgCount === 2, "countNonEmptyImageLinks counts non empty");

  const m = bestHeaderMatch(["Image_URL 0", "EAN"], ["image_url 0"]);
  assert(m === "Image_URL 0", "bestHeaderMatch finds normalized match");

  const samples = sampleUniqueValues([{ a: "x" }, { a: "x" }, { a: "y" }, { a: "" }], "a", 5);
  assert(samples.length === 2 && samples[0] === "x" && samples[1] === "y", "sampleUniqueValues works");

  const imgs = firstImageUrls([{ i: "u1" }, { i: "u1" }, { i: "u2" }], ["i"], 6);
  assert(imgs.length === 2 && imgs[0] === "u1" && imgs[1] === "u2", "firstImageUrls works");

  const mail = buildEmail({ shopName: "Testshop", issues: ["A"], tips: ["B"], canStart: false });
  assert(typeof mail === "string" && mail.includes("Betreff"), "buildEmail returns a string");

  const okShip = (DEFAULT_RULES.allowed_shipping_mode || []).map((x) => String(x).toLowerCase());
  assert(okShip.includes("paket") && okShip.includes("spedition"), "DEFAULT_RULES includes allowed shipping");
}

if (typeof window !== "undefined") {
  if (!window.__feedCheckSelfTestRan) {
    window.__feedCheckSelfTestRan = true;
    try {
      runSelfTests();
    } catch (e) {
      console.error(e);
    }
  }
}

function RulesPage({ rules, setRules, onSave, saving, saveError, savedAt, adminToken, updateAdminToken }) {
  const [draft, setDraft] = useState(() => rules);

  useEffect(() => {
    setDraft(rules);
  }, [rules]);

  function setField(key, value) {
    setDraft((r) => ({ ...r, [key]: value }));
  }

  function setArrayField(key, raw) {
    const arr = String(raw || "")
      // splitte an Komma, Semikolon oder Zeilenumbruch; mehrere Trenner erlauben
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setField(key, arr);
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Regeln</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>
            Global gespeichert. Aenderungen gelten sofort fuer alle.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
  value={adminToken}
  onChange={(e) => updateAdminToken(e.target.value)}
  placeholder="Admin Token"
  style={{
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #E5E7EB",
    fontSize: 13,
  }}
/>
          {savedAt ? <Pill tone="info">Zuletzt gespeichert {savedAt}</Pill> : <Pill tone="info">Noch nicht gespeichert</Pill>}
          <button
            onClick={() => onSave(draft)}
            disabled={saving}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              background: saving ? "#F3F4F6" : "white",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {saving ? "Speichern" : "Speichern"}
          </button>
        </div>
      </div>

      {saveError ? <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>Fehler {saveError}</div> : null}

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte shipping_mode Werte</div>
          <SmallText>Kommagetrennt. Beispiel Paket, Spedition</SmallText>
          <textarea
            rows={2}
            value={(draft.allowed_shipping_mode || []).join(", ")}
            onChange={(e) => setArrayField("allowed_shipping_mode", e.target.value)}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
          />
        </div>

        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Bilder</div>
          <SmallText>Mindestanzahl Bildlinks pro Produkt</SmallText>
          <input
            type="number"
            min={1}
            value={draft.image_min_per_product ?? DEFAULT_RULES.image_min_per_product}
            onChange={(e) => setField("image_min_per_product", Number(e.target.value || 3))}
            style={{ marginTop: 10, width: 120, padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
          />
        </div>

        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang Pattern</div>
          <SmallText>RegExp als String. Default ist Anzahl x Produkt.</SmallText>
          <input
            value={draft.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern}
            onChange={(e) => setField("delivery_includes_pattern", e.target.value)}
            style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
          />
        </div>

        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Titel und Beschreibung Mindestlaenge</div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div>
              <SmallText>Titel</SmallText>
              <input
                type="number"
                min={1}
                value={draft.title_min_length ?? DEFAULT_RULES.title_min_length}
                onChange={(e) => setField("title_min_length", Number(e.target.value || 10))}
                style={{ width: 120, padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
              />
            </div>
            <div>
              <SmallText>Beschreibung</SmallText>
              <input
                type="number"
                min={1}
                value={draft.description_min_length ?? DEFAULT_RULES.description_min_length}
                onChange={(e) => setField("description_min_length", Number(e.target.value || 50))}
                style={{ width: 140, padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
              />
            </div>
          </div>
        </div>

        <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Regeln JSON</div>
          <SmallText>Zum Debuggen. Quelle ist immer die API.</SmallText>
          <pre style={{ marginTop: 10, overflowX: "auto", fontSize: 12, lineHeight: "18px" }}>{JSON.stringify(draft, null, 2)}</pre>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setRules(DEFAULT_RULES);
                setDraft(DEFAULT_RULES);
              }}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                background: "white",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              Auf Default setzen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
    const [adminToken, setAdminToken] = useState(() => {
        if (typeof window === "undefined") return "";
        return localStorage.getItem("feed_admin_token") || "";
      });
      
      function updateAdminToken(value) {
        setAdminToken(value);
        if (typeof window !== "undefined") {
          localStorage.setItem("feed_admin_token", value);
        }
      }
  const [route, setRoute] = useState(() => {
    if (typeof window === "undefined") return "checker";
    return window.location.hash === "#/rules" ? "rules" : "checker";
  });

  const [rules, setRules] = useState(DEFAULT_RULES);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSaveError, setRulesSaveError] = useState("");
  const [rulesSavedAt, setRulesSavedAt] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      setRoute(window.location.hash === "#/rules" ? "rules" : "checker");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setRulesLoading(true);
        setRulesError("");
        const data = await apiGetRules();
        if (!alive) return;
        setRules({ ...DEFAULT_RULES, ...(data?.rules || data || {}) });
      } catch (e) {
        if (!alive) return;
        setRulesError(String(e?.message || e || "Fehler beim Laden der Regeln"));
        setRules(DEFAULT_RULES);
      } finally {
        if (!alive) return;
        setRulesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function saveRules(nextRules) {
    try {
      setRulesSaving(true);
      setRulesSaveError("");
      const saved = await apiPutRules(nextRules, adminToken);
      setRules({ ...DEFAULT_RULES, ...(saved?.rules || saved || {}) });
      setRulesSavedAt(new Date().toLocaleString());
    } catch (e) {
      setRulesSaveError(String(e?.message || e || "Fehler beim Speichern"));
    } finally {
      setRulesSaving(false);
    }
  }

  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [parseError, setParseError] = useState("");

  const [shopName, setShopName] = useState("");
  const [previewCount, setPreviewCount] = useState(20);
  const [eanSearch, setEanSearch] = useState("");

  const [imageMin, setImageMin] = useState(DEFAULT_RULES.image_min_per_product);

  useEffect(() => {
    setImageMin(Number(rules?.image_min_per_product ?? DEFAULT_RULES.image_min_per_product));
  }, [rules]);
  const [optionalFields] = useState(["material", "color", "delivery_includes"]);

  const [requiredFields] = useState([
    "ean",
    "seller_offer_id",
    "name",
    "category_path",
    "description",
    "stock_amount",
    "shipping_mode",
    "delivery_time",
    "price",
    "brand",
  ]);

  const mapping = useMemo(() => {
    if (!headers.length) return {};
    const candidates = {
      ean: ["ean", "gtin", "gtin14", "ean13", "barcode"],
      seller_offer_id: ["seller_offer_id", "seller offer id", "offer_id", "offer id", "sku", "merchant_sku"],
      name: ["name", "product_name", "title", "produktname", "produkt titel"],
      category_path: ["category_path", "category", "kategorie", "kategoriepfad"],
      description: ["description", "beschreibung", "desc"],
      stock_amount: ["stock_amount", "stock", "bestand", "quantity", "qty"],
      shipping_mode: ["shipping_mode", "shipping", "versandart", "shipping type"],
      delivery_time: ["delivery_time", "lieferzeit", "lead_time", "lead time"],
      price: ["price", "preis", "amount"],
      brand: ["brand", "marke"],
      material: ["material", "materials"],
      color: ["color", "farbe"],
      delivery_includes: ["delivery_includes", "lieferumfang"],
      size: ["size", "abmessungen", "dimension", "dimensions"],
    };

    const m = {};
    for (const key of Object.keys(candidates)) {
      m[key] = bestHeaderMatch(headers, candidates[key]);
    }
    return m;
  }, [headers]);

  const imageColumns = useMemo(() => {
    if (!headers.length) return [];
    const norms = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
    return norms
      .filter((h) => h.norm.startsWith("image_url") || h.norm.startsWith("image") || h.norm.startsWith("img_url"))
      .map((h) => h.raw);
  }, [headers]);

  const rows = useMemo(() => {
    return rawRows.map((r) => {
      const o = {};
      for (const h of headers) o[h] = r?.[h];
      return o;
    });
  }, [rawRows, headers]);

  const requiredPresence = useMemo(() => {
    const missing = [];
    const found = [];
    for (const f of requiredFields) {
      if (mapping[f]) found.push({ field: f, column: mapping[f] });
      else missing.push(f);
    }
    return { found, missing };
  }, [mapping, requiredFields]);

  const stage1Status = useMemo(() => {
    if (!headers.length) return "idle";
    return requiredPresence.missing.length === 0 ? "ok" : "warn";
  }, [headers, requiredPresence]);

  const eanColumn = mapping.ean;
  const titleColumn = mapping.name;

  const duplicates = useMemo(() => {
    if (!rows.length) return { eanDup: new Set(), titleDup: new Set() };
    const eanValues = eanColumn ? rows.map((r) => r[eanColumn]) : [];
    const titleValues = titleColumn ? rows.map((r) => r[titleColumn]) : [];
    return {
      eanDup: findDuplicateIndexes(eanValues),
      titleDup: findDuplicateIndexes(titleValues),
    };
  }, [rows, eanColumn, titleColumn]);

  const duplicateEans = useMemo(() => {
    if (!rows.length || !eanColumn) return [];
    const vals = rows.map((r) => r[eanColumn]);
    const idxSet = findDuplicateIndexes(vals);
    const eans = Array.from(idxSet).map((i) => String(vals[i] ?? "").trim());
    return uniqueNonEmpty(eans).sort();
  }, [rows, eanColumn]);

  const duplicateTitles = useMemo(() => {
    if (!rows.length || !titleColumn) return [];
    const vals = rows.map((r) => r[titleColumn]);
    const idxSet = findDuplicateIndexes(vals);
    const titles = Array.from(idxSet).map((i) => String(vals[i] ?? "").trim());
    return uniqueNonEmpty(titles).sort();
  }, [rows, titleColumn]);

  const stage2Status = useMemo(() => {
    if (!headers.length) return "idle";
    if (!eanColumn || !titleColumn) return "warn";
    const dupCount = duplicates.eanDup.size + duplicates.titleDup.size;
    return dupCount === 0 ? "ok" : "warn";
  }, [headers, eanColumn, titleColumn, duplicates]);

  const optionalFindings = useMemo(() => {
    if (!rows.length) {
      return {
        missingEansByField: { material: [], color: [], delivery_includes: [] },
        samplesByField: { material: [], color: [], delivery_includes: [] },
        missingEANs: [],
        imageZeroEans: [],
        imageOneEans: [],
        imageLowEans: [],
        imagePreviewUrls: [],
        scientificEans: [],
        invalidShipping: [],
        missingShipping: [],
        titleIssues: { tooShort: [], seeAbove: [], missingAttributes: [] },
        descriptionIssues: { tooShort: [], advertising: [], externalLinks: [], variants: [], contactHint: [] },
      };
    }

    const eans = rows.map((r, idx) => {
      const v = eanColumn ? String(r[eanColumn] ?? "").trim() : "";
      return v || `ROW_${idx + 1}`;
    });

    const missingEANs = [];
    if (eanColumn) {
      rows.forEach((r, idx) => {
        if (isBlank(r[eanColumn])) missingEANs.push(`ROW_${idx + 1}`);
      });
    }

    const missingEansByField = { material: [], color: [], delivery_includes: [] };
    for (const f of optionalFields) {
      const col = mapping[f];
      if (!col) continue;
      rows.forEach((r, idx) => {
        if (isBlank(r[col])) missingEansByField[f].push(eans[idx]);
      });
      missingEansByField[f] = uniqueNonEmpty(missingEansByField[f]).sort();
    }

    const samplesByField = {
      material: sampleUniqueValues(rows, mapping.material, 5),
      color: sampleUniqueValues(rows, mapping.color, 5),
      delivery_includes: sampleUniqueValues(rows, mapping.delivery_includes, 5),
    };

    const imageZero = [];
    const imageOne = [];
    const imageLow = [];

    rows.forEach((r, idx) => {
      const c = countNonEmptyImageLinks(r, imageColumns);
      if (c === 0) imageZero.push(eans[idx]);
      if (c === 1) imageOne.push(eans[idx]);
      if (c < imageMin) imageLow.push(eans[idx]);
    });

    const imagePreviewUrls = firstImageUrls(rows, imageColumns, 6);

    const scientificEans = [];
    if (eanColumn) {
      rows.forEach((r, idx) => {
        if (looksLikeScientificEAN(r[eanColumn])) scientificEans.push(eans[idx]);
      });
    }

    const invalidShipping = [];
    const missingShipping = [];
    if (mapping.shipping_mode) {
      const col = mapping.shipping_mode;
      const allowed = (rules?.allowed_shipping_mode || DEFAULT_RULES.allowed_shipping_mode).map((x) => String(x).toLowerCase());
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim();
        if (!raw) {
          missingShipping.push(eans[idx]);
          return;
        }
        const v = raw.toLowerCase();
        const ok = allowed.includes(v);
        if (!ok) invalidShipping.push({ ean: eans[idx], value: raw });
      });
    }

    const titleIssues = { tooShort: [], seeAbove: [], missingAttributes: [] };
    if (mapping.name) {
      const minTitle = Number(rules?.title_min_length ?? DEFAULT_RULES.title_min_length);
      rows.forEach((r, idx) => {
        const title = String(r[mapping.name] ?? "").trim();
        if (title.length < minTitle) titleIssues.tooShort.push(eans[idx]);
        if (/siehe oben/i.test(title)) titleIssues.seeAbove.push(eans[idx]);
        if (mapping.material && mapping.color) {
          const material = String(r[mapping.material] ?? "").toLowerCase();
          const color = String(r[mapping.color] ?? "").toLowerCase();
          const titleLower = title.toLowerCase();
          if (material && !titleLower.includes(material)) titleIssues.missingAttributes.push(eans[idx]);
          if (color && !titleLower.includes(color)) titleIssues.missingAttributes.push(eans[idx]);
        }
      });
    }

    const descriptionIssues = { tooShort: [], advertising: [], externalLinks: [], variants: [], contactHint: [] };
    if (mapping.description) {
      const minDesc = Number(rules?.description_min_length ?? DEFAULT_RULES.description_min_length);
      rows.forEach((r, idx) => {
        const desc = String(r[mapping.description] ?? "").trim();
        if (desc.length < minDesc) descriptionIssues.tooShort.push(eans[idx]);
        if (/www\.|http|https/i.test(desc)) descriptionIssues.externalLinks.push(eans[idx]);
        if (/jetzt kaufen|rabatt|angebot/i.test(desc)) descriptionIssues.advertising.push(eans[idx]);
        if (/auswahl|in verschiedenen|ihrer wahl/i.test(desc)) descriptionIssues.variants.push(eans[idx]);
        if (/kontaktieren sie uns|hotline|kundenservice/i.test(desc)) descriptionIssues.contactHint.push(eans[idx]);
      });
    }

    return {
      missingEansByField,
      samplesByField,
      missingEANs: uniqueNonEmpty(missingEANs).sort(),
      imageZeroEans: uniqueNonEmpty(imageZero).sort(),
      imageOneEans: uniqueNonEmpty(imageOne).sort(),
      imageLowEans: uniqueNonEmpty(imageLow).sort(),
      imagePreviewUrls,
      scientificEans: uniqueNonEmpty(scientificEans).sort(),
      invalidShipping,
      missingShipping: uniqueNonEmpty(missingShipping).sort(),
      titleIssues,
      descriptionIssues,
    };
  }, [rows, optionalFields, mapping, imageColumns, imageMin, eanColumn]);

  const stage3Status = useMemo(() => {
    if (!headers.length) return "idle";
    const anyMissing =
      optionalFindings.missingEansByField.material.length +
        optionalFindings.missingEansByField.color.length +
        optionalFindings.missingEansByField.delivery_includes.length +
        optionalFindings.missingEANs.length >
      0;
    const imagesBad = optionalFindings.imageZeroEans.length > 0 || optionalFindings.imageOneEans.length > 0;
    const shipBad = optionalFindings.invalidShipping.length > 0 || optionalFindings.missingShipping.length > 0;
    return anyMissing || imagesBad || shipBad ? "warn" : "ok";
  }, [headers, optionalFindings]);

  const summary = useMemo(() => {
    if (!headers.length) {
      return { score: 0, canStart: false, issues: [], tips: [] };
    }

    const issues = [];
    const tips = [];

    if (requiredPresence.missing.length) {
      issues.push(`Pflichtfelder fehlen oder wurden nicht erkannt: ${requiredPresence.missing.join(", ")}`);
      tips.push("Bitte pruefen Sie die Spaltennamen oder liefern Sie die fehlenden Pflichtfelder nach.");
    }

    if (eanColumn) {
      const missingEAN = rows.filter((r) => isBlank(r[eanColumn])).length;
      if (missingEAN > 0) issues.push(`EAN fehlt in ${missingEAN} Artikeln.`);
    } else {
      issues.push("EAN Spalte fehlt. Ohne EAN ist eine Verarbeitung nicht moeglich.");
      tips.push("Bitte liefern Sie eine EAN oder GTIN Spalte. Falls die Werte in Excel im E Format stehen, bitte als Text formatieren.");
    }

    if (eanColumn) {
      if (duplicates.eanDup.size > 0) issues.push(`Doppelte EAN erkannt in ${duplicates.eanDup.size} Zeilen.`);

      if (optionalFindings.scientificEans.length > 0) {
        issues.push(
          `EAN Darstellungsproblem erkannt in ${optionalFindings.scientificEans.length} Artikeln. Werte wirken wie wissenschaftliche Schreibweise.`
        );
        tips.push("Bitte EAN Spalte als Text formatieren, damit die komplette GTIN erhalten bleibt.");
      }
    }

    if (titleColumn && duplicates.titleDup.size > 0) {
      issues.push(`Doppelte Produkttitel erkannt in ${duplicates.titleDup.size} Zeilen.`);
    }

    const optionalMissingCount =
      optionalFindings.missingEansByField.material.length +
      optionalFindings.missingEansByField.color.length +
      optionalFindings.missingEansByField.delivery_includes.length;

    if (optionalMissingCount > 0) {
      tips.push("Optionalfelder wie Material, Farbe und Lieferumfang wenn moeglich vollstaendig pflegen.");
    }

    if (imageColumns.length === 0) {
      issues.push("Keine Bildspalten erkannt.");
    } else {
      if (optionalFindings.imageZeroEans.length > 0) {
        issues.push(`Keine Bilder bei ${optionalFindings.imageZeroEans.length} Artikeln.`);
      }
      if (optionalFindings.imageOneEans.length > 0) {
        tips.push(`Nur ein Bild bei ${optionalFindings.imageOneEans.length} Artikeln. Empfohlen sind mindestens ${imageMin}.`);
      }
      if (optionalFindings.imageLowEans.length > 0) {
        tips.push(`Bitte pro Produkt mindestens ${imageMin} Bildlinks liefern.`);
      }
    }

    if (mapping.delivery_includes) {
      const col = mapping.delivery_includes;
      const bad = new Set();
      let re = null;
      try {
        const pattern = String(rules?.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern);
        re = new RegExp(pattern, "i");
      } catch (e) {
        re = null;
      }
      rows.forEach((r, idx) => {
        const v = String(r[col] ?? "").trim();
        if (!v) return;
        const ok = re ? re.test(v) : /(^|\s)(\d+)\s*[xX×]\s*\S+/i.test(v);
        if (!ok) bad.add(idx);
      });
      if (bad.size > 0) {
        issues.push(`Lieferumfang Format ungueltig in ${bad.size} Zeilen.`);
        tips.push("Lieferumfang bitte im Format Anzahl x Produkt angeben, z B 1x Tisch, 4x Stuhl.");
      }
    }

    if (mapping.shipping_mode) {
      if (optionalFindings.missingShipping.length > 0) {
        issues.push(`shipping_mode fehlt in ${optionalFindings.missingShipping.length} Artikeln.`);
      }
      if (optionalFindings.invalidShipping.length > 0) {
        issues.push(`shipping_mode ungueltig in ${optionalFindings.invalidShipping.length} Artikeln. Erlaubt sind Paket oder Spedition.`);
      }
    }

    let score = 100;
    score -= Math.min(40, requiredPresence.missing.length * 8);
    score -= Math.min(25, duplicates.eanDup.size > 0 ? 25 : 0);
    score -= Math.min(15, duplicates.titleDup.size > 0 ? 15 : 0);
    score -= Math.min(12, optionalFindings.imageZeroEans.length > 0 ? 12 : 0);
    score -= Math.min(6, optionalFindings.imageOneEans.length > 0 ? 6 : 0);
    score -= Math.min(10, optionalMissingCount > 0 ? 10 : 0);
    score -= Math.min(15, optionalFindings.invalidShipping.length > 0 ? 15 : 0);
    score -= Math.min(10, optionalFindings.missingShipping.length > 0 ? 10 : 0);
    score -= Math.min(15, eanColumn && rows.some((r) => isBlank(r[eanColumn])) ? 15 : 0);
    score = Math.max(0, score);

    const canStart =
      requiredPresence.missing.length === 0 &&
      !!eanColumn &&
      rows.every((r) => !isBlank(r[eanColumn])) &&
      (mapping.shipping_mode ? rows.every((r) => !isBlank(r[mapping.shipping_mode])) : true);

    return { score, canStart, issues, tips };
  }, [headers, requiredPresence, duplicates, optionalFindings, imageColumns, imageMin, mapping, rows, eanColumn, titleColumn]);

  const emailText = useMemo(() => {
    if (!headers.length) return "";
    return buildEmail({ shopName, issues: summary.issues, tips: summary.tips, canStart: summary.canStart });
  }, [headers, shopName, summary]);

  function onPickFile(file) {
    setPreviewCount(20);
    setParseError("");
    setFileName(file?.name || "");
    setRawRows([]);
    setHeaders([]);

    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => {
        const errs = res.errors || [];
        if (errs.length) setParseError(errs[0]?.message || "CSV parsing error");

        const data = Array.isArray(res.data) ? res.data : [];
        const h = res.meta?.fields || Object.keys(data[0] || {});
        setHeaders(h);
        setRawRows(data);
      },
      error: (err) => setParseError(String(err || "CSV parsing error")),
    });
  }

  const topNav = (
    <div style={{ background: "white", borderBottom: "1px solid #E5E7EB" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 1000,
          margin: "0 auto",
          padding: "12px 24px",
          fontFamily: "ui-sans-serif, system-ui",
          boxSizing: "border-box",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => {
              window.location.hash = "#/checker";
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              background: route === "checker" ? "#EEF2FF" : "white",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Checker
          </button>
          <button
            onClick={() => {
              window.location.hash = "#/rules";
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              background: route === "rules" ? "#EEF2FF" : "white",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Regeln
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {rulesLoading ? <Pill tone="info">Regeln laden</Pill> : null}
          {rulesError ? <Pill tone="warn">Regeln Fallback</Pill> : <Pill tone="ok">Regeln aktiv</Pill>}
        </div>
      </div>
    </div>
  );

  const page = (
    <div
      style={{
        width: "100%",
        maxWidth: 1000,
        margin: "0 auto",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui",
        boxSizing: "border-box",
        overflowX: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Feed Pruefung</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>
            Schritt fuer Schritt Pruefung fuer CSV Produktdatenfeeds
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Pill tone={summary.canStart ? "ok" : "warn"}>{summary.canStart ? "Ready" : "Needs fixes"}</Pill>
          <Pill tone="info">Bewertung {summary.score} von 100</Pill>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        <StepCard title="1 Datei hochladen" status={headers.length ? "ok" : "idle"} subtitle="CSV Datei hochladen um die Pruefung zu starten">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
            <div style={{ color: "#6B7280", fontSize: 13 }}>{fileName ? `File ${fileName}` : "Keine Datei ausgewaehlt"}</div>
          </div>
          {parseError ? <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>Fehler beim Einlesen {parseError}</div> : null}
        </StepCard>

        <StepCard
          title="2 Spalten und Pflichtfelder"
          status={stage1Status}
          subtitle="Wir pruefen ob Pflichtinformationen vorhanden sind oder zugeordnet werden koennen"
        >
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen um die erkannten Spalten zu sehen.</SmallText>
          ) : (
            <>
              <SmallText>Gefundene Spalten {headers.length}</SmallText>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {headers.map((h) => (
                  <span
                    key={String(h)}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid #E5E7EB",
                      background: "#F9FAFB",
                      color: "#111827",
                    }}
                  >
                    {String(h)}
                  </span>
                ))}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Zuordnung Pflichtfelder</div>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  {requiredFields.map((f) => {
                    const col = mapping[f];
                    return (
                      <div
                        key={f}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #E5E7EB",
                          background: col ? "#F0FDF4" : "#FFFBEB",
                        }}
                      >
                        <div style={{ fontSize: 13, color: "#111827" }}>{f}</div>
                        <div style={{ fontSize: 13, color: col ? "#166534" : "#92400E" }}>{col ? `Zugeordnet zu ${col}` : "Nicht gefunden"}</div>
                      </div>
                    );
                  })}
                </div>

                {requiredPresence.missing.length ? (
                  <div style={{ marginTop: 12, color: "#92400E", fontSize: 13 }}>Hinweis Einige Pflichtfelder fehlen oder konnten nicht zugeordnet werden.</div>
                ) : (
                  <div style={{ marginTop: 12, color: "#166534", fontSize: 13 }}>Alle Pflichtfelder gefunden.</div>
                )}
              </div>
            </>
          )}
        </StepCard>

        <StepCard title="3 Duplikate" status={stage2Status} subtitle="Wir pruefen doppelte EAN und doppelte Produkttitel">
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen um Duplikate zu pruefen.</SmallText>
          ) : (
            <>
              <TextInput
                label="Schnellsuche in allen Spalten"
                value={eanSearch}
                onChange={setEanSearch}
                placeholder="EAN, Titel oder anderer Text zum Filtern"
              />
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Pill tone={eanColumn ? "ok" : "warn"}>{eanColumn ? `EAN Spalte ${eanColumn}` : "EAN Spalte nicht gefunden"}</Pill>
                <Pill tone={titleColumn ? "ok" : "warn"}>{titleColumn ? `Titel Spalte ${titleColumn}` : "Titel Spalte nicht gefunden"}</Pill>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Doppelte EAN Werte</div>
                  <SmallText>Liste der EAN Werte die mehr als einmal vorkommen</SmallText>
                  <div style={{ marginTop: 10 }}>
                    <CollapsibleList
                      title="Doppelte EAN"
                      items={duplicateEans.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                      tone={duplicateEans.length ? "warn" : "ok"}
                    />
                  </div>
                </div>

                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Doppelte Titelwerte</div>
                  <SmallText>Liste der Titel die mehr als einmal vorkommen</SmallText>
                  <div style={{ marginTop: 10 }}>
                    <CollapsibleList
                      title="Doppelte Titel"
                      items={duplicateTitles.filter((x) => !eanSearch || String(x).toLowerCase().includes(eanSearch.toLowerCase()))}
                      tone={duplicateTitles.length ? "warn" : "ok"}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </StepCard>

        <StepCard
          title="4 Optionale Felder, Bilder, Versand"
          status={stage3Status}
          subtitle="Wir zeigen EANs fuer fehlende Angaben, fehlende EAN, zu wenige Bilder und Versandprobleme"
        >
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen um Schritt 4 zu pruefen.</SmallText>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: "#111827", fontWeight: 700 }}>Mindestanzahl Bilder</div>
                  <input
                    type="number"
                    min={1}
                    value={imageMin}
                    onChange={(e) => setImageMin(Number(e.target.value || 3))}
                    style={{ width: 70, padding: 8, border: "1px solid #E5E7EB", borderRadius: 10 }}
                  />
                </div>
                <Pill tone={imageColumns.length ? "ok" : "warn"}>{imageColumns.length ? `Bildspalten ${imageColumns.length}` : "Keine Bildspalten erkannt"}</Pill>
                <Pill tone={mapping.shipping_mode ? "ok" : "warn"}>{mapping.shipping_mode ? `shipping_mode ${mapping.shipping_mode}` : "shipping_mode nicht erkannt"}</Pill>
              </div>

              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>EAN fehlt</div>
                  <SmallText>Ohne EAN ist der Datensatz nicht verarbeitbar.</SmallText>
                  <div style={{ marginTop: 10 }}>
                    <CollapsibleList
                      title="Zeilen ohne EAN"
                      items={optionalFindings.missingEANs.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                      tone={optionalFindings.missingEANs.length ? "bad" : "ok"}
                      hint={optionalFindings.missingEANs.length ? "➜ bitte EAN nachliefern" : ""}
                    />
                  </div>
                </div>

                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>Bilder mit 0 oder 1</div>
                  <SmallText>EANs von Produkten mit zu wenigen Bildlinks. Unten werden einige Bildlinks als Vorschau gerendert, falls erreichbar.</SmallText>
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    <CollapsibleList
                      title="EAN ohne Bilder"
                      items={optionalFindings.imageZeroEans.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                      tone={optionalFindings.imageZeroEans.length ? "bad" : "ok"}
                    />
                    <CollapsibleList
                      title="EAN mit einem Bild"
                      items={optionalFindings.imageOneEans.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                      tone={optionalFindings.imageOneEans.length ? "warn" : "ok"}
                    />
                  </div>

                  {optionalFindings.imagePreviewUrls.length ? (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", background: "white" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Bild Vorschau</div>
                      <SmallText>Falls Bilder nicht laden, blockt oft die Quelle oder es ist kein direktes Bild URL.</SmallText>
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {optionalFindings.imagePreviewUrls.map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" style={{ display: "block", width: 86 }}>
                            <img
                              src={u}
                              alt="preview"
                              loading="lazy"
                              style={{
                                width: 86,
                                height: 86,
                                objectFit: "cover",
                                borderRadius: 12,
                                border: "1px solid #E5E7EB",
                                background: "#F9FAFB",
                              }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                            <div style={{ marginTop: 6, fontSize: 11, color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              Link oeffnen
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>Fehlende optionale Angaben</div>
                  <SmallText>Anzahlen und EAN Listen fuer Material, Farbe, Lieferumfang. Beispiele zeigen Werte aus dem Feed zum Gegencheck.</SmallText>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    <div style={{ padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Material Beispiele</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          {optionalFindings.samplesByField.material.length ? optionalFindings.samplesByField.material.join(" | ") : "keine Werte"}
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <CollapsibleList
                          title="Material fehlt"
                          items={optionalFindings.missingEansByField.material.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                          tone={optionalFindings.missingEansByField.material.length ? "warn" : "ok"}
                        />
                      </div>
                    </div>

                    <div style={{ padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Farbe Beispiele</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          {optionalFindings.samplesByField.color.length ? optionalFindings.samplesByField.color.join(" | ") : "keine Werte"}
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <CollapsibleList
                          title="Farbe fehlt"
                          items={optionalFindings.missingEansByField.color.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                          tone={optionalFindings.missingEansByField.color.length ? "warn" : "ok"}
                        />
                      </div>
                    </div>

                    <div style={{ padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang Beispiele</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          {optionalFindings.samplesByField.delivery_includes.length ? optionalFindings.samplesByField.delivery_includes.join(" | ") : "keine Werte"}
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <CollapsibleList
                          title="Lieferumfang fehlt"
                          items={optionalFindings.missingEansByField.delivery_includes.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                          tone={optionalFindings.missingEansByField.delivery_includes.length ? "warn" : "ok"}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>Pruefung shipping_mode</div>
                <SmallText>Erlaubt sind Paket oder Spedition. Pfeil bedeutet Feld ist leer und es wurde nichts geliefert.</SmallText>

                {mapping.shipping_mode ? (
                  optionalFindings.invalidShipping.length ? (
                    <div style={{ marginTop: 10 }}>
                      <Table
                        columns={[{ key: "ean", label: "EAN" }, { key: "value", label: "Wert" }]}
                        rows={optionalFindings.invalidShipping.filter((x) => !eanSearch || String(x.ean).includes(eanSearch)).slice(0, 500)}
                        highlight={() => true}
                      />
                      {optionalFindings.invalidShipping.length > 500 ? (
                        <SmallText>Es werden nur die ersten 500 ungueltigen Werte gezeigt, damit die Ansicht schnell bleibt.</SmallText>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <CollapsibleList
                        title="shipping_mode fehlt"
                        items={optionalFindings.missingShipping.filter((x) => !eanSearch || String(x).includes(eanSearch))}
                        tone={optionalFindings.missingShipping.length ? "warn" : "ok"}
                        hint={optionalFindings.missingShipping.length ? "➜ Feld ist leer" : ""}
                      />
                      <div style={{ color: "#166534", fontSize: 13 }}>Alle shipping_mode Werte sind gueltig.</div>
                    </div>
                  )
                ) : (
                  <div style={{ marginTop: 10, color: "#92400E", fontSize: 13 }}>shipping_mode Spalte nicht gefunden.</div>
                )}
              </div>

              {optionalFindings.scientificEans.length > 0 ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #FDE68A", background: "#FFFBEB" }}>
                  <div style={{ fontWeight: 700, color: "#92400E", fontSize: 13 }}>Hinweis EAN Format</div>
                  <div style={{ marginTop: 6, color: "#92400E", fontSize: 13 }}>
                    Einige EAN Werte sehen nach wissenschaftlicher Schreibweise aus. Das ist fast immer ein Formatproblem durch Excel.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <CollapsibleList title="Betroffene EAN" items={optionalFindings.scientificEans.filter((x) => !eanSearch || String(x).includes(eanSearch))} tone="warn" />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </StepCard>

        <StepCard
          title="5 Zusammenfassung und Entscheidung"
          status={headers.length ? (summary.canStart ? "ok" : "warn") : "idle"}
          subtitle="Kurzes Ergebnis und eine Mailvorlage falls Anpassungen noetig sind"
        >
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen um die Zusammenfassung zu sehen.</SmallText>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Pill tone={summary.canStart ? "ok" : "warn"}>{summary.canStart ? "Wir koennen starten" : "Noch nicht startklar"}</Pill>
                <Pill tone="info">Score {summary.score} of 100</Pill>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>⚠️ Kritisch</div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {(summary.issues.length ? summary.issues : ["Keine kritischen Fehler erkannt"]).map((x, i) => (
                      <div key={i} style={{ fontSize: 13, color: "#111827" }}>
                        {x}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#111827" }}>💡 Verbesserungen</div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {(summary.tips.length ? summary.tips : ["Keine Vorschlaege"]).map((x, i) => (
                      <div key={i} style={{ fontSize: 13, color: "#111827" }}>
                        {x}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Mailvorlage</div>
                  <input
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="Shopname optional"
                    style={{ flex: "1 1 220px", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB" }}
                  />
                </div>
                <SmallText>Einfach kopieren und in das Mailtool einfuegen. Neutral formuliert und mit Hinweis auf automatische Erstellung.</SmallText>
                <textarea
                  value={emailText}
                  readOnly
                  rows={14}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid #E5E7EB",
                    fontSize: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    lineHeight: "18px",
                    background: "white",
                  }}
                />
              </div>
            </>
          )}
        </StepCard>

        <StepCard title="6 Vorschau" status={headers.length ? "ok" : "idle"} subtitle="Vorschau der Zeilen mit allen Spalten">
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen um eine Vorschau zu sehen.</SmallText>
          ) : (
            <>
              <SmallText>Horizontal scroll ist moeglich. Mit dem Button kannst du mehr Zeilen nachladen.</SmallText>
              <div style={{ marginTop: 10 }}>
                <Table
                  columns={headers.map((h) => ({ key: h, label: String(h) }))}
                  rows={rows
                    .filter((r) => {
                      if (!eanSearch) return true;
                      const q = eanSearch.toLowerCase();
                      return Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q));
                    })
                    .slice(0, previewCount)}
                />
                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <SmallText>
                    Zeige {Math.min(previewCount, rows.length)} von {rows.length} Zeilen.
                  </SmallText>
                  <button
                    onClick={() => setPreviewCount((c) => Math.min(rows.length, c + 20))}
                    disabled={previewCount >= rows.length}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #E5E7EB",
                      background: previewCount >= rows.length ? "#F3F4F6" : "white",
                      cursor: previewCount >= rows.length ? "not-allowed" : "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    20 weitere laden
                  </button>
                </div>
              </div>
            </>
          )}
        </StepCard>

        <div style={{ marginTop: 2, color: "#6B7280", fontSize: 12, lineHeight: "18px" }}>
          Die Pruefungen orientieren sich am Feedleitfaden, inklusive eindeutiger EAN, Seller Offer ID, Name, Category Path, Beschreibung, Bestand und Versandfeldern, Preis und Marke sowie Bildanforderungen.
        </div>
      </div>
    </div>
  );

  if (route === "rules") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
        {topNav}
        <RulesPage
  rules={rules}
  setRules={setRules}
  onSave={saveRules}
  saving={rulesSaving}
  saveError={rulesSaveError}
  savedAt={rulesSavedAt}
  adminToken={adminToken}
  updateAdminToken={updateAdminToken}
/>
      </div>
    );
  }

  return (
    <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      {topNav}
      {page}
    </div>
  );
}

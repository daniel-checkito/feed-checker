import React, { useEffect, useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  COLUMN_SYNONYMS, DIM_RE, DELIVERY_RE, SHOP_TEXT_PATTERNS, BWARE_PATTERNS,
  ATTRIBUTE_CRITERIA, IMAGE_CRITERIA,
  detectColumns, computeAutoScores, calcScores, checkApaEligibility,
} from "./lib/contentScoring";

// Inline spinner component
function Spinner({ size = 16, color = "#1553B6" }) {
  return (
    <span style={{ display: "inline-block", width: size, height: size, verticalAlign: "middle" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "fc-spin 0.8s linear infinite" }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
      </svg>
      <style>{`@keyframes fc-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
import Tooltip from "./Tooltip";
import { getSupabaseClient, isSupabaseConfigured } from "./lib/supabaseClient";
import ResultsTable, { saveResultToStorage } from "./ResultsTable";
   

const BRAND_COLOR = "#1553B6";

const DEFAULT_RULES = {
  allowed_shipping_mode: ["Paket", "Spedition"],
  allowed_material: [],
  allowed_color: [],
  delivery_includes_allowlist: [],
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

// Content-based column detection: inspects first N rows to identify columns
// when header-name matching fails.
function detectFieldByContent(unmappedFields, headers, rows, sampleSize = 10) {
  const sample = rows.slice(0, Math.min(sampleSize, rows.length));
  const result = {};

  const fieldDetectors = {
    shipping_mode: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      return nonEmpty.length > 0 && nonEmpty.every((v) => /^(paket|spedition)$/i.test(String(v ?? "").trim()));
    },
    ean: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 3) return false;
      return nonEmpty.filter((v) => /^\d{8,14}$/.test(String(v ?? "").trim())).length / nonEmpty.length > 0.7;
    },
    price: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 3) return false;
      return (
        nonEmpty.filter((v) => {
          const s = String(v ?? "").trim().replace(",", ".");
          return /^\d+(\.\d{1,2})?$/.test(s) && parseFloat(s) > 0 && parseFloat(s) < 100000;
        }).length /
          nonEmpty.length >
        0.7
      );
    },
    delivery_time: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 2) return false;
      return (
        nonEmpty.filter((v) => /\d+\s*(tage?|werktage?|arbeitstage?|wochen?|wk\.?|wt\.?|days?)/i.test(String(v ?? ""))).length /
          nonEmpty.length >
        0.5
      );
    },
    stock_amount: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 3) return false;
      return nonEmpty.filter((v) => /^\d+$/.test(String(v ?? "").trim())).length / nonEmpty.length > 0.8;
    },
    material: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 2) return false;
      const matWords = /holz|metall|stoff|leder|kunststoff|glas|eiche|kiefer|buche|mdf|aluminium|stahl|polyester|baumwolle|massiv|spanplatte/i;
      return nonEmpty.filter((v) => matWords.test(String(v ?? ""))).length / nonEmpty.length > 0.4;
    },
    color: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 2) return false;
      const colorWords = /schwarz|wei(ß|ss)|grau|braun|beige|blau|gr(ü|ue)n|rot|gelb|natur|anthrazit|silber|gold|cognac|creme|olive|lila|pink/i;
      return nonEmpty.filter((v) => colorWords.test(String(v ?? ""))).length / nonEmpty.length > 0.4;
    },
    brand: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 3) return false;
      // Brand: short strings, relatively few unique values (same brand repeated)
      const unique = new Set(nonEmpty.map((v) => String(v ?? "").trim().toLowerCase()));
      return (
        unique.size <= Math.ceil(nonEmpty.length * 0.5) &&
        nonEmpty.every((v) => {
          const s = String(v ?? "").trim();
          return s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s);
        })
      );
    },
    description: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 2) return false;
      return nonEmpty.filter((v) => String(v ?? "").trim().length > 80).length / nonEmpty.length > 0.5;
    },
    name: (values) => {
      const nonEmpty = values.filter((v) => String(v ?? "").trim());
      if (nonEmpty.length < 2) return false;
      return (
        nonEmpty.filter((v) => {
          const s = String(v ?? "").trim();
          return s.length >= 10 && s.length <= 200 && !/^\d+$/.test(s);
        }).length /
          nonEmpty.length >
        0.7
      );
    },
  };

  const usedHeaders = new Set();

  for (const field of unmappedFields) {
    if (!fieldDetectors[field]) continue;
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const values = sample.map((r) => r[header]).filter((v) => v != null && v !== "");
      if (values.length && fieldDetectors[field](values)) {
        result[field] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  return result;
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

function resolveImageSrc(u) {
  const raw = String(u ?? "").trim();
  if (!raw) return "";

  // Preserve remote images as-is.
  if (/^https?:\/\//i.test(raw)) return raw;

  // Remove wrapping quotes and ignore query/hash when mapping local files.
  const cleaned = raw
    .replace(/^["']|["']$/g, "")
    .replace(/[?#].*$/, "");

  // Only map local references that point to our `product_images` folder (or are bare filenames).
  const EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
  if (!EXT_RE.test(cleaned)) return raw;

  let rel = cleaned.replace(/^\/+/, "");
  rel = rel.replace(/^product_images\//, "");

  // If the token contains subfolders other than `product_images`, we can't safely map it.
  // (But `product_images/sub/x.jpg` is handled by stripping the prefix above.)
  if (rel.includes("/")) {
    // Allowed only if it came from `product_images/...` (after stripping, still may contain `/`).
    // If user provided a random absolute path like `/Users/.../x.jpg`, that would become
    // `Users/.../x.jpg`, which we intentionally reject.
    if (!cleaned.startsWith("product_images/") && !raw.startsWith("/product_images/") && !raw.startsWith("product_images/")) {
      return raw;
    }
  }

  // Map `image.jpg` -> `/api/product-images/image.jpg`
  const parts = rel.split("/").filter(Boolean).map((p) => encodeURIComponent(p));
  return `/api/product-images/${parts.join("/")}`;
}

function extractImageUrlsFromCell(cellValue) {
  const raw = String(cellValue ?? "").trim();
  if (!raw) return [];

  // If the cell contains http(s) URLs, extract each URL directly. URLs can't
  // contain whitespace or common separators like , ; | < > " ', so we grab
  // each full URL via regex. This correctly handles comma-separated lists of
  // URLs (e.g., "https://a/1.jpg, https://a/2.jpg, https://a/3.jpg").
  let tokens;
  if (/https?:\/\//i.test(raw)) {
    tokens = (raw.match(/https?:\/\/[^\s,;|<>"']+/gi) || []).map((t) => t.trim()).filter(Boolean);
  } else {
    tokens = raw.split(/[;\n\r|,]+/).map((t) => t.trim()).filter(Boolean);
  }
  const out = [];

  const stripPunctuation = (s) => String(s ?? "").trim().replace(/^[<\s(]+|[>\s),.;:]+$/g, "");

  for (const t0 of tokens) {
    const t = stripPunctuation(t0).replace(/^["']|["']$/g, "");
    if (!t) continue;

    // Accept:
    // - full http(s) URLs
    // - anything containing `product_images/`
    // - bare filenames with an image extension
    if (/^https?:\/\//i.test(t)) out.push(t);
    else if (/^\/+product_images\//i.test(t) || /^product_images\//i.test(t)) out.push(t);
    else if (!t.includes("/") && /\.(jpe?g|png|webp|gif)$/i.test(t)) out.push(t);
    else if (t.includes("product_images/") && /\.(jpe?g|png|webp|gif)$/i.test(t)) out.push(t);
  }

  // De-dupe while keeping original order.
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }

  return uniq;
}

function countNonEmptyImageLinks(row, imageCols) {
  let count = 0;
  for (const c of imageCols) {
    const refs = extractImageUrlsFromCell(row?.[c]);
    count += refs.length;
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

function normalizePreviewText(value) {
  const s = String(value ?? "");
  if (!s) return s;
  return s
    // Replace Unicode replacement chars (�) by a neutral quote
    .replace(/\uFFFD/g, '"')
    // Normalize common smart quotes to straight equivalents
    .replace(/["""]/g, '"')
    .replace(/[‚‘’]/g, "'")
    // Optionally collapse weird double quotes patterns like ""Text""
    .replace(/"{2,}([^"]*?)"{2,}/g, '"$1"');
}

function buildEmail({ shopName, issues, tips, canStart }) {
  const subject = "CHECK24: Handlungsbedarf bei Ihren Produktdaten";

  // Clean text: strip trailing counts like "in 12 Zeilen"
  const clean = (s) => s
    .replace(/\s*in \d+[\w\s-]*\.?/g, ".")
    .replace(/\s*bei \d+[\w\s-]*\.?/g, ".")
    .replace(/\.\./g, ".").trim();

  const allIssues = issues.map(clean).filter(Boolean);
  const allTips = tips.map(clean).filter(Boolean);
  const all = [...allIssues, ...allTips];

  const has = (kw) => all.some((s) => s.toLowerCase().includes(kw));
  const hasTitel = has("titel") || has("produktname");
  const hasDesc = has("beschreibung") || has("extern") || has("platzhalter");
  const hasBilder = has("bild") || has("image");
  const hasVersand = has("shipping") || has("versand") || has("lieferumfang") || has("lieferzeit");
  const hasMaterial = has("material") || has("farbe");
  const hasHersteller = has("hersteller");
  const hasEan = has("ean") || has("gtin");
  const hasPreis = has("preis") || has("price");
  const hasBestand = has("bestand");

  const name = shopName ? `${shopName}` : "Ihr Shop";

  let body = `Guten Tag,\n\n`;
  body += `ich habe den Feed von ${name} geprüft und dabei folgende Punkte festgestellt, die einer Überarbeitung bedürfen, um die Sichtbarkeit auf CHECK24 zu verbessern:\n`;

  if (allIssues.length > 0) {
    body += "\nFEHLER (müssen behoben werden)\n";
    for (const issue of allIssues) {
      body += `- ${issue}\n`;
    }
  }

  if (allTips.length > 0) {
    body += "\nHINWEISE (empfohlen)\n";
    for (const tip of allTips) {
      body += `- ${tip}\n`;
    }
  }

  body += "\nKONKRETE ANFORDERUNGEN\n";

  if (hasTitel) {
    body += "- Titel: Bitte aussagekräftige Titel mit Marke, Produkttyp, Farbe und wichtigsten Maßen verwenden. Doppelte oder zu kurze Titel verringern die Auffindbarkeit.\n";
  }
  if (hasDesc) {
    body += "- Beschreibung: Mindestens 80 Zeichen, keine Platzhalter oder externen Links. Beschreiben Sie Vorteile, Material und Einsatzbereiche des Produkts.\n";
  }
  if (hasBilder) {
    body += "- Bilder: Mindestens 3 Bilder pro Artikel. Das erste Bild als Freisteller auf weißem Hintergrund, weitere als Milieu- und Detailaufnahmen.\n";
  }
  if (hasVersand) {
    if (has("lieferumfang")) body += "- Lieferumfang: Bitte im Format \"1x Tisch, 4x Stuhl\" angeben.\n";
    if (has("lieferzeit")) body += "- Lieferzeit: Bitte als Werktage-Bereich angeben, z.B. \"3-5 Werktage\".\n";
    if (has("shipping") || has("versand")) body += "- Versandart: Nur \"Paket\" oder \"Spedition\" sind gültige Werte.\n";
  }
  if (hasMaterial) {
    body += "- Material & Farbe: Bitte für jeden Artikel vollständig angeben.\n";
  }
  if (hasHersteller) {
    body += "- Herstellerangaben: Bitte Hersteller und Herstellernummer ergänzen.\n";
  }
  if (hasEan) {
    body += "- EAN/GTIN: Bitte gültige 8- bis 14-stellige EAN-Nummern angeben.\n";
  }
  if (hasPreis) {
    body += "- Preis: Bitte Preise ohne Währungssymbol angeben (nur Zahl, z.B. \"49.99\").\n";
  }
  if (hasBestand) {
    body += "- Bestand: Bitte nur ganze Zahlen verwenden.\n";
  }

  body += canStart
    ? "\nIch freue mich, dass der Feed grundsätzlich bereit ist. Bitte beheben Sie die oben genannten Hinweise, um das volle Potenzial auszuschöpfen. Für Rückfragen stehe ich gerne zur Verfügung."
    : "\nBitte beheben Sie die oben genannten Punkte und senden mir den korrigierten Feed zu. Für Rückfragen stehe ich gerne zur Verfügung.";

  body += "\n\nMit freundlichen Grüßen\nIhr CHECK24-Partnerbetreuer";

  return { subject, body };
}

function Pill({ tone, children }) {
  const bg =
    tone === "ok"
      ? "#E8F5E9"
      : tone === "warn"
      ? "#FFF8E1"
      : tone === "bad"
      ? "#FFEBEE"
      : BRAND_COLOR;
  const fg =
    tone === "ok"
      ? "#1B5E20"
      : tone === "warn"
      ? "#7A5B00"
      : tone === "bad"
      ? "#B71C1C"
      : "#FFFFFF";
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
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function StepCard({ title, status, subtitle, action, children }) {
  const borderColor =
    status === "ok" ? "#A7F3D0" : status === "warn" ? "#FCD34D" : status === "bad" ? "#FCA5A5" : "#E5E7EB";
  const dotColor =
    status === "ok" ? "#16A34A" : status === "warn" ? "#D97706" : status === "bad" ? "#DC2626" : "#9CA3AF";

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        padding: "14px 16px",
        background: "#FFFFFF",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
        boxSizing: "border-box",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{title}</div>
            {subtitle ? (
              <div style={{ marginTop: 2, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>{subtitle}</div>
            ) : null}
          </div>
        </div>
        {action ? (
          <div style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {action}
          </div>
        ) : null}
      </div>
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

function SmallText({ children }) {
  return <div style={{ fontSize: 12, color: "#6B7280", lineHeight: "18px" }}>{children}</div>;
}

function Table({ columns, rows, highlight }) {
  return (
    <div style={{ overflowX: "auto", width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, boxSizing: "border-box" }}>
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
                  whiteSpace: "nowrap",
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
                      whiteSpace: "nowrap",
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

function ResizableTable({
  columns,
  rows,
  criticalRowIndexSet,
  rowCriticalIssuesByIndex,
  getRowTargetKey,
  targetRowKey,
  highlightedRowKey,
  highlightedColumnKey,
  onTargetHandled,
}) {
  const isNameColumn = (key) => {
    const k = String(key).toLowerCase();
    return k === "name" || k === "title" || k === "titel" || k === "product_name" || k === "produktname";
  };
  const computeInitialWidth = (col) => {
    const label = String(col.label || col.key || "");
    if (isNameColumn(col.key)) {
      return Math.max(220, label.length * 8 + 60);
    }
    const approx = label.length * 7 + 24;
    return Math.max(90, approx);
  };

  const [widths, setWidths] = useState(() =>
    Object.fromEntries(columns.map((c) => [c.key, computeInitialWidth(c)]))
  );
  const MIN_ROW_HEIGHT = 28;
  const MAX_ROW_HEIGHT = 48; // enforce compact preview height cap
  const [rowHeight, setRowHeight] = useState(32);
  const [descriptionModal, setDescriptionModal] = useState(null);
  const [descriptionHtmlView, setDescriptionHtmlView] = useState(false);
  const [rowIssueModal, setRowIssueModal] = useState(null);
  const [hoveredCriticalRowIndex, setHoveredCriticalRowIndex] = useState(null);
  const dragRef = useRef(null);
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const isLongTextColumn = (key) => {
    const norm = normalizeKey(key);
    return norm.startsWith("description") || norm.includes("beschreibung");
  };

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current) return;
      const { type } = dragRef.current;
      if (type === "col") {
        const { key, startX, startWidth } = dragRef.current;
        const deltaX = e.clientX - startX;
        const nextWidth = Math.max(90, startWidth + deltaX);
        setWidths((prev) => ({
          ...prev,
          [key]: nextWidth,
        }));
      } else if (type === "row") {
        const { startY, startHeight } = dragRef.current;
        const deltaY = e.clientY - startY;
        const next = startHeight + deltaY;
        setRowHeight(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, next)));
      }
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!targetRowKey || !getRowTargetKey) return;
    const rowIdx = rows.findIndex((r, i) => String(getRowTargetKey(r, i)) === String(targetRowKey));
    if (rowIdx === -1) return;
    if (containerRef.current) {
      const targetScrollTop = rowIdx * rowHeight - containerRef.current.clientHeight / 2 + rowHeight / 2;
      containerRef.current.scrollTop = Math.max(0, targetScrollTop);
      setScrollTop(Math.max(0, targetScrollTop));
    }
    if (typeof onTargetHandled === "function") onTargetHandled();
  }, [targetRowKey, rows, getRowTargetKey, rowHeight, onTargetHandled]);

  const startResize = (key, event) => {
    const th = event.currentTarget.parentElement;
    if (!th) return;
    const rect = th.getBoundingClientRect();
    dragRef.current = {
      type: "col",
      key,
      startX: event.clientX,
      startWidth: rect.width,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const startRowResize = (event) => {
    dragRef.current = {
      type: "row",
      startY: event.clientY,
      startHeight: rowHeight,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  // Virtual scroll — only render rows inside the visible viewport (+buffer)
  const VIRT_BUFFER = 8;
  const containerH = containerRef.current?.clientHeight || 720;
  const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRT_BUFFER);
  const visibleEnd = Math.min(rows.length, visibleStart + Math.ceil(containerH / rowHeight) + VIRT_BUFFER * 2);
  const topSpacer = visibleStart * rowHeight;
  const bottomSpacer = Math.max(0, (rows.length - visibleEnd)) * rowHeight;

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{
        width: "100%",
        maxHeight: 720,
        overflow: "auto",
        border: "1px solid #E5E7EB",
        borderRadius: 12,
        boxSizing: "border-box",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 11,
          width: "max-content",
          minWidth: "100%",
          tableLayout: "fixed",
          border: "1px solid #E5E7EB",
        }}
      >
        <thead>
          <tr style={{ background: "#F9FAFB" }}>
            <th
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                textAlign: "right",
                padding: "6px 8px",
                border: "1px solid #E5E7EB",
                color: "#6B7280",
                whiteSpace: "nowrap",
                background: "#F9FAFB",
                width: 60,
                maxWidth: 60,
                minWidth: 48,
              }}
            >
              #
            </th>
            {columns.map((c) => {
              const w = widths[c.key] ?? 90;
              const isHighlightedCol = highlightedColumnKey && c.key === highlightedColumnKey;
              return (
                <th
                  key={c.key}
                  data-col={c.key}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    textAlign: "left",
                    padding: "6px 8px",
                    border: isHighlightedCol ? "1px solid #F59E0B" : "1px solid #E5E7EB",
                    color: isHighlightedCol ? "#92400E" : "#111827",
                    fontWeight: isHighlightedCol ? 700 : undefined,
                    whiteSpace: "normal",
                    background: isHighlightedCol ? "#FEF3C7" : "#F9FAFB",
                    width: w,
                    maxWidth: w,
                    minWidth: w,
                  }}
                >
                  {c.label}
                  <span
                    onMouseDown={(e) => startResize(c.key, e)}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      width: 6,
                      height: "100%",
                      cursor: "col-resize",
                      userSelect: "none",
                    }}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {topSpacer > 0 && <tr key="__virt_top"><td colSpan={columns.length + 1} style={{ height: topSpacer, padding: 0, border: 0 }} /></tr>}
          {rows.slice(visibleStart, visibleEnd).map((r, localIdx) => {
            const i = visibleStart + localIdx;
            const zebra = i % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
            const absRowIndex = r?.__rowIndex;
            const isCritical = absRowIndex != null && criticalRowIndexSet?.has(absRowIndex);
            const rowIssueMessages = isCritical ? rowCriticalIssuesByIndex?.[absRowIndex] ?? [] : [];
            const rowIssueText = rowIssueMessages?.length ? String(rowIssueMessages.join(" • ")) : "";
            const rowBg = isCritical ? "#FEE2E2" : zebra;
            const isCriticalHovered =
              hoveredCriticalRowIndex != null &&
              absRowIndex != null &&
              String(absRowIndex) === String(hoveredCriticalRowIndex);
            return (
              <tr
                key={i}
                title={isCritical && rowIssueText ? rowIssueText : ""}
                onMouseEnter={() => {
                  if (isCritical) setHoveredCriticalRowIndex(absRowIndex);
                }}
                onMouseLeave={() => {
                  setHoveredCriticalRowIndex(null);
                }}
                style={{
                  background: rowBg,
                  outline: isCriticalHovered ? "2px solid #F97316" : undefined,
                  outlineOffset: -2,
                }}
              >
              <td
                style={{
                  padding: "0 8px",
                  border: "1px solid #E5E7EB",
                  color: "#6B7280",
                  whiteSpace: "nowrap",
                  textAlign: "right",
                  width: 60,
                  maxWidth: 60,
                  minWidth: 48,
                  height: rowHeight,
                  maxHeight: rowHeight,
                  overflow: "hidden",
                  lineHeight: "14px",
                  background: rowBg,
                }}
              >
                <div
                  style={{
                    height: rowHeight,
                    maxHeight: rowHeight,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    overflow: "hidden",
                    width: "100%",
                  }}
                >
                  <div style={{ width: 30, textAlign: "right", color: "#6B7280" }}>{i + 1}</div>
                  {isCritical && rowIssueMessages?.length ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRowIssueModal({
                          rowIndex: absRowIndex,
                          rowNumber: i + 1,
                          messages: rowIssueMessages,
                        });
                      }}
                      style={{
                        width: 20,
                        height: 20,
                        padding: 0,
                        borderRadius: 999,
                        border: "1px solid #EF4444",
                        background: "#FFFFFF",
                        color: "#B91C1C",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                      aria-label="Kritischer Fehler Details anzeigen"
                      title="Details anzeigen"
                    >
                      i
                    </button>
                  ) : null}
                </div>
              </td>
              {columns.map((c) => {
                const w = widths[c.key] ?? 90;
                const longText = isLongTextColumn(c.key);
                const rawValue = String(r?.[c.key] ?? "");
                const displayValue = normalizePreviewText(rawValue);
                const tooltip = isCritical && rowIssueText ? rowIssueText : "";
                const isHighlightedCol = highlightedColumnKey && c.key === highlightedColumnKey;
                const cellBg = isCritical
                  ? (isHighlightedCol ? "#FED7AA" : "#FEE2E2")
                  : (isHighlightedCol ? "#FEF3C7" : zebra);
                return (
                  <td
                    key={c.key}
                    title={tooltip}
                    style={{
                      padding: "0 8px",
                      border: isHighlightedCol ? "1px solid #F59E0B" : "1px solid #E5E7EB",
                      color: "#111827",
                      whiteSpace: "normal",
                      width: w,
                      maxWidth: w,
                      minWidth: w,
                      height: rowHeight,
                      maxHeight: rowHeight,
                      overflow: "hidden",
                      lineHeight: "14px",
                      wordBreak: "break-word",
                      background: cellBg,
                      cursor: longText && rawValue ? "pointer" : "default",
                    }}
                    onClick={() => {
                      if (longText && rawValue) {
                        setDescriptionModal({ title: c.label || c.key, text: displayValue });
                      }
                    }}
                  >
                    {longText ? (
                      rawValue ? (
                        <div style={{ height: rowHeight, maxHeight: rowHeight, display: "flex", alignItems: "center", overflow: "hidden" }}>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#111827",
                              maxHeight: rowHeight - 2,
                              overflow: "hidden",
                              lineHeight: "14px",
                              wordBreak: "break-word",
                            }}
                          >
                            {displayValue.length > 220
                              ? `${displayValue.slice(0, 220)}…`
                              : displayValue}
                          </div>
                        </div>
                      ) : (
                        <div style={{ height: rowHeight, maxHeight: rowHeight, display: "flex", alignItems: "center", overflow: "hidden" }}>
                          <span style={{ fontSize: 10, color: "#9CA3AF" }}>Keine Beschreibung</span>
                        </div>
                      )
                    ) : (
                      <div
                        style={{
                          height: rowHeight, maxHeight: rowHeight, display: "flex", alignItems: "center", overflow: "hidden",
                          cursor: displayValue && displayValue.length > 30 ? "pointer" : "default",
                        }}
                        onClick={() => {
                          if (displayValue && displayValue.length > 30) {
                            setDescriptionModal({ title: c.label || c.key, text: rawValue || displayValue });
                          }
                        }}
                      >
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: isNameColumn(c.key) ? "normal" : "nowrap",
                          lineHeight: isNameColumn(c.key) ? "14px" : "inherit",
                          maxHeight: rowHeight - 4,
                          wordBreak: isNameColumn(c.key) ? "break-word" : "normal",
                          display: "-webkit-box",
                          WebkitLineClamp: isNameColumn(c.key) ? 2 : 1,
                          WebkitBoxOrient: "vertical",
                        }}>
                          {displayValue}
                        </span>
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
            );
          })}
          {bottomSpacer > 0 && <tr key="__virt_bottom"><td colSpan={columns.length + 1} style={{ height: bottomSpacer, padding: 0, border: 0 }} /></tr>}
        </tbody>
      </table>
      <div
        onMouseDown={startRowResize}
        style={{
          height: 6,
          cursor: "row-resize",
          background: "#E5E7EB",
          borderTop: "1px solid #D1D5DB",
        }}
      />
      {descriptionModal ? (
        <div
          onClick={() => setDescriptionModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            zIndex: 40,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 800,
              width: "100%",
              maxHeight: "80vh",
              background: "#FFFFFF",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
              padding: 16,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{descriptionModal.title}</div>
                <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #D1D5DB" }}>
                  <button onClick={() => setDescriptionHtmlView(false)}
                    style={{ padding: "3px 10px", border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer", background: !descriptionHtmlView ? BRAND_COLOR : "#FFF", color: !descriptionHtmlView ? "#FFF" : "#374151" }}>
                    Text
                  </button>
                  <button onClick={() => setDescriptionHtmlView(true)}
                    style={{ padding: "3px 10px", border: "none", borderLeft: "1px solid #D1D5DB", fontSize: 10, fontWeight: 600, cursor: "pointer", background: descriptionHtmlView ? BRAND_COLOR : "#FFF", color: descriptionHtmlView ? "#FFF" : "#374151" }}>
                    HTML
                  </button>
                </div>
              </div>
              <button
                onClick={() => { setDescriptionModal(null); setDescriptionHtmlView(false); }}
                style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", fontSize: 11, cursor: "pointer" }}>
                Schließen
              </button>
            </div>
            <div
              style={{
                marginTop: 4,
                padding: 10,
                borderRadius: 12,
                border: "1px solid #E5E7EB",
                fontSize: 12,
                lineHeight: "18px",
                color: "#111827",
                overflow: "auto",
                flex: 1,
                minHeight: 0,
              }}
            >
              {descriptionHtmlView ? (
                <div dangerouslySetInnerHTML={{ __html: descriptionModal.text }} />
              ) : (
                descriptionModal.text
              )}
            </div>
          </div>
        </div>
      ) : null}

      {rowIssueModal ? (
        <div
          onClick={() => setRowIssueModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            zIndex: 45,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 720,
              width: "100%",
              maxHeight: "80vh",
              background: "#FFFFFF",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
              padding: 16,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#B91C1C" }}>
                Kritischer Fehler (Zeile {rowIssueModal.rowNumber})
              </div>
              <button
                onClick={() => setRowIssueModal(null)}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid #E5E7EB",
                  background: "#FFFFFF",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Schließen
              </button>
            </div>
            <div
              style={{
                marginTop: 4,
                padding: 10,
                borderRadius: 12,
                border: "1px solid #FEE2E2",
                background: "#FEF2F2",
                fontSize: 12,
                lineHeight: "18px",
                color: "#111827",
                overflow: "auto",
              }}
            >
              {rowIssueModal.messages?.length ? (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {rowIssueModal.messages.map((m, idx) => (
                    <li key={idx}>{m}</li>
                  ))}
                </ul>
              ) : (
                <div>Keine weiteren Details.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
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

const EXAMPLE_TEMPLATE_VALUES = {
  two_men_handling: ['"Bordsteinkante" oder "bis in die Wohnung"'],
  energy_efficiency_label: ['https://beispielprodukt.link.de/eek_label/T12345.jpg'],
  lighting_included: ['ja oder nein'],
  illuminant_included: ['ja oder nein'],
  EPREL_registration_number: ['RF-A19D-W2SV0612-P8'],
  product_data_sheet: ['https://beispielprodukt.link.de/produktdatenblatt/T12345.pdf'],
  assembly_instructions: [
    'https://beispielprodukt.link.de/anleitung/T34567.pdf',
    'https://beispielprodukt.link.de/anleitung/T12345.pdf',
  ],
  size_diameter: ['500 mm'],
  size_lying_surface: ['140x200 cm'],
  size_seat_height: ['40 cm'],
  size_seat_depth: ['50 cm'],
  size_seat_width: ['50 cm'],
  weight: ['26,5 kg'],
  weight_capacity: ['120 kg'],
  model: ['T12345678-123'],
  series: ['Premiumline'],
  cover: ['Samt / 100 % Polyester'],
};

function groupByValueWithEans(items) {
  const map = new Map();
  for (const it of items) {
    const value = String(it.value ?? "").trim();
    const ean = String(it.ean ?? "").trim();
    if (!value || !ean) continue;
    if (!map.has(value)) map.set(value, new Set());
    map.get(value).add(ean);
  }
  return Array.from(map.entries()).map(([value, eanSet]) => ({
    value,
    eans: Array.from(eanSet).sort(),
  }));
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
      const refs = extractImageUrlsFromCell(r?.[c]);
      for (const ref of refs) {
        const src = resolveImageSrc(ref);
        if (src) urls.push(src);
      }
      if (urls.length >= limit * 10) break;
    }
    if (urls.length >= limit * 10) break;
  }
  return uniqueNonEmpty(urls).slice(0, limit);
}

function CollapsibleList({ title, items, tone, hint, onItemClick }) {
  const count = items.length;
  const shownItems = items.slice(0, 500);
  const parsed = shownItems.map((raw) => {
    // Support both plain strings and grouped objects { value, eans: [] }.
    if (raw && typeof raw === "object" && Array.isArray(raw.eans)) {
      const value = String(raw.value ?? "");
      const eans = raw.eans.map((e) => String(e ?? "").trim()).filter(Boolean);
      const restPart = eans.join(", ");
      return {
        text: `${value} – ${eans.length} EANs`,
        isLong: false,
        isValueWithEans: true,
        valuePart: value,
        restPart,
        firstEan: eans[0] || "",
      };
    }

    const text = String(raw ?? "");
    const isLong = text.length > 60;
    const isValueWithEans = text.includes(" EANs:");
    let valuePart = "";
    let restPart = "";
    let firstEan = "";
    if (isValueWithEans) {
      const idx = text.indexOf(" – ");
      if (idx !== -1) {
        valuePart = text.slice(0, idx);
        restPart = text.slice(idx + 3);
      }
      if (restPart) {
        // Try to extract first EAN from "... EANs: 123, 456"
        const afterColon = restPart.split("EANs:")[1] || restPart;
        const first = (afterColon || "").split(",")[0].trim();
        firstEan = first;
      }
    }
    if (!firstEan) firstEan = text.trim();
    return { text, isLong, isValueWithEans, valuePart, restPart, firstEan };
  });
  const hasLong = parsed.some((p) => p.isLong || p.isValueWithEans);

  return (
    <details style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, background: "white", boxSizing: "border-box", width: "100%" }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill tone={tone}>{count}</Pill>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{title}</span>
        {hint ? (
          <span style={{ fontSize: 12, color: "#6B7280" }}>{hint}</span>
        ) : (
          <span style={{ fontSize: 12, color: "#6B7280" }}></span>
        )}
      </summary>
      <div style={{ marginTop: 10 }}>
        {hasLong ? (
          parsed.map((item, idx) => {
            const canJump = !!onItemClick && !!item.firstEan;
            return (
              <div
                key={`${item.text}-${idx}`}
                style={{
                  display: "flex", alignItems: "flex-start", width: "100%",
                  padding: "6px 4px", borderBottom: "1px solid #F3F4F6", fontSize: 12, lineHeight: "18px",
                  color: "#111827", wordBreak: "break-word", cursor: canJump ? "pointer" : "default",
                }}
                onClick={() => { if (canJump) onItemClick(item.firstEan); }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {item.isValueWithEans && item.valuePart && item.restPart ? (
                    <>
                      <div style={{ fontWeight: 600 }}>{item.valuePart}</div>
                      <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{item.restPart}</div>
                    </>
                  ) : item.text}
                </div>
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 12, color: "#111827", lineHeight: "22px", wordBreak: "break-all" }}>
            {parsed.map((item, idx) => {
              const canJump = !!onItemClick && !!item.firstEan;
              return (
                <span key={`${item.text}-${idx}`}>
                  {idx > 0 && <span style={{ color: "#9CA3AF" }}>, </span>}
                  <span
                    onClick={() => { if (canJump) onItemClick(item.firstEan); }}
                    style={{ cursor: canJump ? "pointer" : "default", textDecoration: canJump ? "underline" : "none", textDecorationColor: "#D1D5DB" }}
                    title={canJump ? "Zum Datensatz springen" : ""}
                  >{item.text}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {items.length > 500 ? <SmallText>Es werden nur die ersten 500 Werte angezeigt, damit die Ansicht schnell bleibt.</SmallText> : null}
    </details>
  );
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ fontSize: 13, color: "#111827", fontWeight: 700, flexShrink: 0 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: "1 1 200px", minWidth: 0, padding: "8px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", boxSizing: "border-box" }}
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
  assert(mail && typeof mail.subject === "string" && typeof mail.body === "string", "buildEmail returns { subject, body }");

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

  const [shippingText, setShippingText] = useState(
    () => (rules?.allowed_shipping_mode || []).join(", ")
  );
  const [materialText, setMaterialText] = useState(
    () => (rules?.allowed_material || []).join(", ")
  );
  const [colorText, setColorText] = useState(
    () => (rules?.allowed_color || []).join(", ")
  );
  const [deliveryIncludesText, setDeliveryIncludesText] = useState(
    () => (rules?.delivery_includes_allowlist || []).join(", ")
  );

  useEffect(() => {
    setDraft(rules);
    setShippingText((rules?.allowed_shipping_mode || []).join(", "));
    setMaterialText((rules?.allowed_material || []).join(", "));
    setColorText((rules?.allowed_color || []).join(", "));
    setDeliveryIncludesText((rules?.delivery_includes_allowlist || []).join(", "));
  }, [rules]);

  const [rulesView, setRulesView] = useState("checker");

  function setField(key, value) {
    setDraft((r) => ({ ...r, [key]: value }));
  }

  function parseListString(raw) {
    return String(raw || "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Regeln</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>
            Global gespeichert. Änderungen gelten sofort für alle.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={adminToken}
            onChange={(e) => updateAdminToken(e.target.value)}
            placeholder="Passwort"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #E5E7EB",
              fontSize: 13,
              minWidth: 0,
              background: "#FFFFFF",
            }}
          />
          {savedAt ? <Pill tone="info">Zuletzt gespeichert {savedAt}</Pill> : <Pill tone="info">Noch nicht gespeichert</Pill>}
          <button
            onClick={() => {
              const next = {
                ...draft,
                allowed_shipping_mode: parseListString(shippingText),
                allowed_material: parseListString(materialText),
                allowed_color: parseListString(colorText),
                delivery_includes_allowlist: parseListString(deliveryIncludesText),
              };
              setDraft(next);
              onSave(next);
            }}
            disabled={saving}
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              border: `1px solid ${BRAND_COLOR}`,
              background: saving ? "#9CA3AF" : BRAND_COLOR,
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 800,
              color: "#FFFFFF",
            }}
          >
            {saving ? "Speichern..." : "Speichern"}
          </button>
        </div>
      </div>

      {saveError ? <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>Fehler {saveError}</div> : null}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "inline-flex", gap: 8, padding: 4, borderRadius: 999, background: "#F3F4F6" }}>
          <button
            onClick={() => setRulesView("checker")}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid transparent",
              background: rulesView === "checker" ? BRAND_COLOR : "transparent",
              color: rulesView === "checker" ? "#FFFFFF" : "#111827",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Checker
          </button>
          <button
            onClick={() => setRulesView("qs")}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid transparent",
              background: rulesView === "qs" ? BRAND_COLOR : "transparent",
              color: rulesView === "qs" ? "#FFFFFF" : "#111827",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            QS/APA
          </button>
        </div>

        {rulesView === "checker" ? (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte Versandarten</div>
                <SmallText>Kommagetrennt. Beispiel Paket, Spedition</SmallText>
                <textarea
                  rows={2}
                  value={shippingText}
                  onChange={(e) => setShippingText(e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(draft.allowed_shipping_mode || []).map((val, idx) => (
                    <button
                      key={`${val}-${idx}`}
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          allowed_shipping_mode: (r.allowed_shipping_mode || []).filter((x) => x !== val),
                        }))
                      }
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #E5E7EB",
                        background: "#F9FAFB",
                        fontSize: 11,
                        cursor: "pointer",
                        color: "#111827",
                      }}
                    >
                      {val} ✕
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte Materialien</div>
                <SmallText>Kommagetrennt. Beispiel Holz, Metall, Kunststoff</SmallText>
                <textarea
                  rows={2}
                  value={materialText}
                  onChange={(e) => setMaterialText(e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(draft.allowed_material || []).map((val, idx) => (
                    <button
                      key={`${val}-${idx}`}
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          allowed_material: (r.allowed_material || []).filter((x) => x !== val),
                        }))
                      }
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #E5E7EB",
                        background: "#F9FAFB",
                        fontSize: 11,
                        cursor: "pointer",
                        color: "#111827",
                      }}
                    >
                      {val} ✕
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte Farbwerte</div>
                <SmallText>Kommagetrennt. Beispiel weiß, schwarz, blau</SmallText>
                <textarea
                  rows={2}
                  value={colorText}
                  onChange={(e) => setColorText(e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(draft.allowed_color || []).map((val, idx) => (
                    <button
                      key={`${val}-${idx}`}
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          allowed_color: (r.allowed_color || []).filter((x) => x !== val),
                        }))
                      }
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #E5E7EB",
                        background: "#F9FAFB",
                        fontSize: 11,
                        cursor: "pointer",
                        color: "#111827",
                      }}
                    >
                      {val} ✕
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang-Muster</div>
                <SmallText>Regulärer Ausdruck. Default ist Anzahl x Produkt.</SmallText>
                <input
                  value={draft.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern}
                  onChange={(e) => setField("delivery_includes_pattern", e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang Allowlist</div>
                <SmallText>Einzelne Lieferumfang-Werte, die trotz Format-Abweichung als gültig gelten.</SmallText>
                <textarea
                  rows={2}
                  value={deliveryIncludesText}
                  onChange={(e) => setDeliveryIncludesText(e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(draft.delivery_includes_allowlist || []).map((val, idx) => (
                    <button
                      key={`${val}-${idx}`}
                      onClick={() =>
                        setDraft((r) => ({
                          ...r,
                          delivery_includes_allowlist: (r.delivery_includes_allowlist || []).filter((x) => x !== val),
                        }))
                      }
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #E5E7EB",
                        background: "#F9FAFB",
                        fontSize: 11,
                        cursor: "pointer",
                        color: "#111827",
                      }}
                    >
                      {val} ✕
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Mindestlänge für Titel und Beschreibung</div>
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

              <div style={{ padding: 14, borderRadius: 8, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
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
                      padding: "10px 18px",
                      borderRadius: 999,
                      border: `1px solid ${BRAND_COLOR}`,
                      background: "#FFFFFF",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 800,
                      color: BRAND_COLOR,
                    }}
                  >
                    Auf Default setzen
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Regelübersicht QS/APA</div>
            <SmallText>Die wichtigsten QS/APA Kriterien für Attribute und Bilder.</SmallText>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <StepCard title="QS/APA Attribute" status="ok" subtitle="Herstellerfeed, Titel, Beschreibung, Abmessungen, Lieferumfang, Material, Farbe, Shoptexte">
                <SmallText>
                  Wir bewerten, ob Pflichtattribute für Inhalte vernünftig gefüllt sind: Herstellerfeed, gut strukturierte Titel und Beschreibungen,
                  nachvollziehbare Abmessungen, sauberer Lieferumfang im Format &quot;1x Produkt&quot;, sinnvolle Material- und Farbangaben sowie neutrale
                  shopbezogene Texte ohne zu viel Werbung.
                </SmallText>
              </StepCard>
              <StepCard title="QS/APA Bilder" status="ok" subtitle="1. Bild, Freisteller, Milieu, Anzahl Bilder">
                <SmallText>
                  Wir prüfen, ob das erste Bild zur Offer passt und keine Dubletten hat, ob es ausreichend Freisteller- und Milieu-Bilder gibt und wie viele
                  Bilder pro Produkt vorhanden sind. Daraus entstehen Bildpunkte im QS-Tab.
                </SmallText>
              </StepCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QsPage({ headers, rows }) {
  const total = rows.length;

  const { titleCol, descCol, dimCol, deliveryCol, brandCol, eanCol, materialCol, colorCol } =
    useMemo(() => detectColumns(headers), [headers]);

  const safeStr = (v) => (v === null || v === undefined ? "" : String(v));

  const filledRate = (col) => {
    if (!col || !total) return 0;
    let filled = 0;
    for (const r of rows) {
      const v = safeStr(r?.[col]).trim();
      if (v) filled += 1;
    }
    return filled / total;
  };

  const avgLen = (col) => {
    if (!col || !total) return 0;
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = safeStr(r?.[col]).trim();
      if (!v) continue;
      sum += v.length;
      n += 1;
    }
    return n ? sum / n : 0;
  };

  const fmtPct = (x) => `${Math.round((x || 0) * 100)}%`;

  const [scores, setScores] = useState({
    herstellerfeed: 0,
    titel: 0,
    beschreibung: 0,
    abmessungen: 0,
    lieferumfang: 0,
    material: 0,
    farbe: 0,
    shoptexte: 0,
    bware: 0,
    bildmatch: 0,
    freisteller: 0,
    millieu: 0,
    anzahlbilder: 0,
  });

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveForm, setSaveForm] = useState({
    coreId: "", sellerKey: "", name: "", kommentar: "",
    coreStatus: 1,
    crossSelling: "ok", beschreibungHtml: "ok",
    duplikate: "ok", stammArtikel: "ok", encoding: "ok", bware: "ok",
    todo: "APA-Freigabe", mailPartner: "Nein",
    apaOverride: null,
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [modalScores, setModalScores] = useState(null);
  const [modalShowScores, setModalShowScores] = useState(false);

  const [autoEnabled, setAutoEnabled] = useState(true);

  const [imageSampleLimit, setImageSampleLimit] = useState(5);
  const [freistellerChecks, setFreistellerChecks] = useState({});
  const [freistellerLoading, setFreistellerLoading] = useState(false);
  const [expandedCriteria, setExpandedCriteria] = useState({});
  const toggleCriteria = (id) => setExpandedCriteria((prev) => ({ ...prev, [id]: !prev[id] }));

  const imageColumns = useMemo(() => {
    if (!headers.length) return [];
    const norms = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
    return norms
      .filter((h) => {
        const n = h.norm;
        return (
          n.startsWith("image_url") ||
          n.startsWith("image") ||
          n.startsWith("img_url") ||
          n.includes("bild") ||
          n.includes("image")
        );
      })
      .map((h) => h.raw);
  }, [headers]);

  const qsImageSamples = useMemo(() => {
    if (!rows.length || !imageColumns.length) return [];
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const urls = [];
      for (const c of imageColumns) {
        const refs = extractImageUrlsFromCell(r?.[c]);
        for (const ref of refs) {
          const src = resolveImageSrc(ref);
          if (src) urls.push(src);
        }
      }
      if (!urls.length) continue;
      const id =
        eanCol && safeStr(r[eanCol]).trim()
          ? safeStr(r[eanCol]).trim()
          : titleCol && safeStr(r[titleCol]).trim()
          ? safeStr(r[titleCol]).trim()
          : `ROW_${i + 1}`;
      out.push({ id, urls, count: urls.length });
      if (out.length >= 40) break;
    }
    return out;
  }, [rows, imageColumns, eanCol, titleCol]);

  useEffect(() => {
    if (!qsImageSamples.length) return;

    let cancelled = false;

    async function analyzeImageSamples(samples) {
      setFreistellerLoading(true);
      const result = {};

      // Returns white-border ratio for an image (0-1)
      async function getWhiteRatio(url) {
        // Proxy external images to avoid CORS issues with canvas
        const proxyUrl = /^https?:\/\//i.test(url) ? `/api/image-proxy?url=${encodeURIComponent(url)}` : url;
        return new Promise((resolve) => {
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              try {
                const canvas = document.createElement("canvas");
                const w = img.width;
                const h = img.height;
                if (!w || !h) { resolve(null); return; }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) { resolve(null); return; }
                ctx.drawImage(img, 0, 0);
                const border = 5;
                const imgData = ctx.getImageData(0, 0, w, h).data;
                let whiteLike = 0;
                let total = 0;
                for (let y = 0; y < h; y += 4) {
                  for (let x = 0; x < w; x += 4) {
                    if (!(x < border || y < border || x >= w - border || y >= h - border)) continue;
                    const idx = (y * w + x) * 4;
                    const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
                    total += 1;
                    const brightness = (r + g + b) / 3;
                    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
                    if (brightness >= 235 && chroma <= 20) whiteLike += 1;
                  }
                }
                resolve(total ? whiteLike / total : 0);
              } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = proxyUrl;
          } catch (e) { resolve(null); }
        });
      }

      // Process samples in parallel batches of 5 for speed
      for (let b = 0; b < samples.length; b += 5) {
        if (cancelled) break;
        const batch = samples.slice(b, b + 5);
        await Promise.all(batch.map(async (sample) => {
          if (cancelled) return;
          const urls = Array.isArray(sample.urls) ? sample.urls.slice(0, 3) : [];
          let hasFreisteller = false, hasMilieu = false, checkedCount = 0;
          const ratios = await Promise.all(urls.map((u) => getWhiteRatio(u)));
          ratios.forEach((ratio, i) => {
            if (ratio === null) return;
            checkedCount += 1;
            if (i === 0 && ratio >= 0.5) hasFreisteller = true;
            if (i > 0 && ratio < 0.30) hasMilieu = true;
          });
          result[sample.id] = { hasFreisteller, hasMilieu, checkedCount };
        }));
      }

      if (!cancelled) {
        setFreistellerChecks(result);
        setFreistellerLoading(false);
      }
    }

    if (typeof window === "undefined") return;
    analyzeImageSamples(qsImageSamples.slice(0, 20));
    return () => { cancelled = true; };
  }, [qsImageSamples]);

  const autoSuggested = useMemo(
    () => computeAutoScores({ headers, rows, qsImageSamples, freistellerChecks, imageColumns }),
    [headers, rows, qsImageSamples, freistellerChecks, imageColumns],
  );

  useEffect(() => {
    if (!autoEnabled || !autoSuggested) return;
    setScores((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === "herstellerfeed") continue;
        if (next[key] === 0) next[key] = autoSuggested[key];
      }
      return next;
    });
  }, [autoEnabled, autoSuggested]);

  const { attributeScore, imageScore } = calcScores(scores);
  const total180 = attributeScore + imageScore;
  const totalPercent = (total180 / 180) * 100;

  const apaEligible = checkApaEligibility(scores, attributeScore, imageScore);

  const mS = modalScores || scores;
  const { attributeScore: mAttr, imageScore: mImg } = calcScores(mS);
  const mApa = saveForm.apaOverride !== null ? saveForm.apaOverride : checkApaEligibility(mS, mAttr, mImg);

  const avgImageCount = useMemo(() => {
    if (!rows.length) return 0;
    if (!headers.length) return 0;
    const norms = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
    const imgCols = norms
      .filter((h) => h.norm.startsWith("image_url") || h.norm.startsWith("image") || h.norm.startsWith("img_url"))
      .map((h) => h.raw);
    if (!imgCols.length) return 0;
    let total = 0;
    let n = 0;
    for (const r of rows) {
      let c = 0;
      for (const col of imgCols) {
        const v = safeStr(r[col]).trim();
        if (!v) continue;
        c += 1;
      }
      total += c;
      n += 1;
    }
    return n ? total / n : 0;
  }, [rows, headers]);

  const scoreReasons = useMemo(() => {
    const reasons = {};

    reasons.herstellerfeed = `Herstellerfeed manuell bewertet: ${scores.herstellerfeed} Punkte (Ja = 20, Nein = 0).`;

    if (!titleCol) {
      reasons.titel = "Keine Titel-Spalte erkannt – 0 Punkte.";
    } else {
      const vals = rows.map((r) => safeStr(r[titleCol]).trim().toLowerCase());
      const filled = vals.filter((v) => v).length;
      const fillRate = (rows.length ? filled / rows.length : 0) || 0;
      const uniq = new Set(vals.filter(Boolean));
      const dupRate = filled ? 1 - uniq.size / filled : 0;
      const avg = avgLen(titleCol);
      if (scores.titel === 20) {
        reasons.titel = `Titel fast immer vorhanden (${fmtPct(fillRate)}), Ø ca. ${Math.round(avg)} Zeichen, wenige Dubletten – 20 Punkte.`;
      } else if (scores.titel === 10) {
        reasons.titel = `Titel oft vorhanden (${fmtPct(fillRate)}), Ø ca. ${Math.round(avg)} Zeichen, aber teils unvollständig oder häufigere Dubletten – 10 Punkte.`;
      } else {
        reasons.titel = `Titel selten oder sehr kurz (${fmtPct(fillRate)}, Ø ca. ${Math.round(avg)} Zeichen) – 0 Punkte.`;
      }
    }

    if (!descCol) {
      reasons.beschreibung = "Keine Beschreibungs-Spalte erkannt – 0 Punkte.";
    } else {
      const fillRate = filledRate(descCol);
      const avg = avgLen(descCol);
      if (scores.beschreibung === 10) {
        reasons.beschreibung = `Beschreibungen für ca. ${fmtPct(fillRate)} der Produkte, Ø ca. ${Math.round(avg)} Zeichen – 10 Punkte.`;
      } else if (scores.beschreibung === 5) {
        reasons.beschreibung = `Beschreibungen teils vorhanden (${fmtPct(fillRate)}), aber eher kurz (Ø ca. ${Math.round(avg)} Zeichen) – 5 Punkte.`;
      } else {
        reasons.beschreibung = `Beschreibungen oft fehlend oder sehr kurz (${fmtPct(fillRate)}, Ø ca. ${Math.round(avg)} Zeichen) – 0 Punkte.`;
      }
    }

    const dimCandidates = [dimCol, titleCol, descCol].filter(Boolean);
    if (!dimCandidates.length) {
      reasons.abmessungen = "Keine erkennbaren Abmessungs-Angaben – 0 Punkte.";
    } else {
      let hits = 0;
      let meaningful = 0;
      for (const r of rows) {
        const blob = dimCandidates.map((c) => safeStr(r[c])).join(" ");
        const s = blob.trim();
        if (!s) continue;
        meaningful += 1;
        if (DIM_RE.test(s)) hits += 1;
      }
      const rate = meaningful ? hits / meaningful : 0;
      if (scores.abmessungen === 10) {
        reasons.abmessungen = `Verständliche Maße in vielen Produkten (${fmtPct(rate)}) – 10 Punkte.`;
      } else if (scores.abmessungen === 5) {
        reasons.abmessungen = `Maße nur teilweise vorhanden (${fmtPct(rate)}) – 5 Punkte.`;
      } else {
        reasons.abmessungen = `Abmessungen kaum erkennbar (${fmtPct(rate)}) – 0 Punkte.`;
      }
    }

    if (!deliveryCol) {
      reasons.lieferumfang = "Keine Lieferumfang-Spalte erkannt – 0 Punkte.";
    } else {
      let nonEmpty = 0;
      let formatOk = 0;
      for (const r of rows) {
        const v = safeStr(r[deliveryCol]).trim();
        if (!v) continue;
        nonEmpty += 1;
        if (DELIVERY_RE.test(v)) formatOk += 1;
      }
      const filled = rows.length ? nonEmpty / rows.length : 0;
      const fmt = nonEmpty ? formatOk / nonEmpty : 0;
      if (scores.lieferumfang === 20) {
        reasons.lieferumfang = `Lieferumfang fast immer gepflegt (${fmtPct(filled)}) und meist im Format "Anzahl x Produkt" (${fmtPct(fmt)}) – 20 Punkte.`;
      } else if (scores.lieferumfang === 10) {
        reasons.lieferumfang = `Lieferumfang teils gepflegt (${fmtPct(filled)}) und häufig im gewünschten Format (${fmtPct(fmt)}) – 10 Punkte.`;
      } else {
        reasons.lieferumfang = `Lieferumfang selten gepflegt (${fmtPct(filled)}) oder kaum im gewünschten Format (${fmtPct(fmt)}) – 0 Punkte.`;
      }
    }

    if (!materialCol) {
      reasons.material = "Keine Material-Spalte erkannt – 0 Punkte.";
    } else {
      const rate = filledRate(materialCol);
      if (scores.material === 10) {
        reasons.material = `Material für ca. ${fmtPct(rate)} der Produkte sinnvoll gepflegt – 10 Punkte.`;
      } else if (scores.material === 5) {
        reasons.material = `Material nur teilweise gepflegt (ca. ${fmtPct(rate)}) oder uneinheitlich – 5 Punkte.`;
      } else {
        reasons.material = `Material kaum oder gar nicht gepflegt (ca. ${fmtPct(rate)}) – 0 Punkte.`;
      }
    }

    if (scores.farbe === 10) {
      reasons.farbe = "Farbwerte meist vorhanden und sauber benannt – 10 Punkte.";
    } else if (scores.farbe === 5) {
      reasons.farbe = "Farben nur teilweise vorhanden oder uneinheitlich – 5 Punkte.";
    } else {
      if (!colorCol) {
        reasons.farbe = "Keine Farb-Spalte erkannt – 0 Punkte.";
      } else if (!rows.length) {
        reasons.farbe = "Keine sinnvollen Farb-Beispiele im Feed gefunden – 0 Punkte.";
      } else {
        reasons.farbe = "Kaum verwertbare Farbinformationen im Feed – 0 Punkte.";
      }
    }

    if (scores.shoptexte === 10) {
      reasons.shoptexte = "Keine shopbezogenen Phrasen in Beschreibungen gefunden – 10 Punkte.";
    } else if (scores.shoptexte === 5) {
      reasons.shoptexte = "Vereinzelt shopbezogene Phrasen – 5 Punkte (manuell vergeben).";
    } else {
      let example = "";
      if (descCol) {
        for (const r of rows.slice(0, 200)) {
          const text = safeStr(r[descCol]);
          if (SHOP_TEXT_PATTERNS.some((re) => re.test(text))) {
            example = text.trim().slice(0, 80);
            break;
          }
        }
      }
      reasons.shoptexte = example
        ? `Shopbezogene Phrase erkannt: "${example}…" – 0 Punkte.`
        : "Shopbezogene Phrasen im Feed gefunden – 0 Punkte.";
    }

    {
      const bwareCols = [titleCol, descCol].filter(Boolean);
      let example = "";
      outer: for (const r of rows.slice(0, 200)) {
        for (const col of bwareCols) {
          const text = safeStr(r[col]);
          if (BWARE_PATTERNS.some((re) => re.test(text))) {
            example = text.trim().slice(0, 80);
            break outer;
          }
        }
      }
      if (scores.bware === 10) {
        reasons.bware = "Keine B-Ware / Gebraucht-Hinweise im Feed gefunden – 10 Punkte.";
      } else {
        reasons.bware = example
          ? `B-Ware erkannt: "${example}…" – 0 Punkte.`
          : "B-Ware oder Gebraucht-Hinweis im Feed gefunden – 0 Punkte.";
      }
    }

    // Bildmatch reasons
    if (qsImageSamples.length >= 5) {
      const firstUrls = qsImageSamples.map((s) => (s.urls && s.urls[0]) || "").filter(Boolean);
      const urlCounts = {};
      firstUrls.forEach((u) => { urlCounts[u] = (urlCounts[u] || 0) + 1; });
      const dupCount = Object.values(urlCounts).filter((c) => c > 1).reduce((sum, c) => sum + c, 0);
      const uniqueCount = Object.keys(urlCounts).length;
      if (scores.bildmatch === 20) {
        reasons.bildmatch = `${uniqueCount} einzigartige Erstbilder bei ${firstUrls.length} Produkten. Keine Duplikate erkannt.`;
      } else {
        reasons.bildmatch = `${dupCount} von ${firstUrls.length} Produkten teilen dasselbe Erstbild. Bitte eindeutige Bilder verwenden.`;
      }
    } else {
      reasons.bildmatch = scores.bildmatch === 20 ? "Erstbilder in Ordnung." : "Zu wenige Produkte für automatische Prüfung.";
    }

    // Freisteller + Milieu reasons from canvas analysis
    if (qsImageSamples.length && Object.keys(freistellerChecks || {}).length) {
      const samples = qsImageSamples.slice(0, 20);
      let checkedProducts = 0, withFreisteller = 0, withMilieu = 0;
      samples.forEach((s) => {
        const r = freistellerChecks[s.id];
        if (!r || !r.checkedCount) return;
        checkedProducts += 1;
        if (r.hasFreisteller) withFreisteller += 1;
        if (r.hasMilieu) withMilieu += 1;
      });
      if (checkedProducts > 0) {
        reasons.freisteller = `${withFreisteller} von ${checkedProducts} Produkten mit Freisteller (weißer Hintergrund) erkannt.`;
        reasons.millieu = `${withMilieu} von ${checkedProducts} Produkten mit Milieu-Bild (farbiger Hintergrund) erkannt.`;
      } else {
        reasons.freisteller = "Keine auswertbaren Bilder gefunden.";
        reasons.millieu = "Keine auswertbaren Bilder gefunden.";
      }
    } else {
      reasons.freisteller = scores.freisteller > 0 ? "Freisteller vorhanden." : "Kaum Freistellerbilder erkannt.";
      reasons.millieu = scores.millieu > 0 ? "Milieubilder vorhanden." : "Kaum Milieubilder erkannt.";
    }

    const avgImg = avgImageCount || 0;
    if (scores.anzahlbilder === 10) {
      reasons.anzahlbilder = `Ø ca. ${avgImg.toFixed(1)} Bilder pro Produkt – 10 Punkte.`;
    } else if (scores.anzahlbilder === 5) {
      reasons.anzahlbilder = `Ø ca. ${avgImg.toFixed(1)} Bilder pro Produkt – 5 Punkte.`;
    } else {
      reasons.anzahlbilder = `Ø ca. ${avgImg.toFixed(1)} Bilder pro Produkt – 0 Punkte.`;
    }

    return reasons;
  }, [
    rows,
    headers,
    brandCol,
    titleCol,
    descCol,
    dimCol,
    deliveryCol,
    filledRate,
    avgLen,
    fmtPct,
    scores,
    avgImageCount,
    qsImageSamples,
    freistellerChecks,
  ]);

  const attributeItems = useMemo(() => {
    const base = [
      {
        id: "herstellerfeed",
        label: "Herstellerfeed",
        status: scores.herstellerfeed === 0 ? "bad" : scores.herstellerfeed < 20 ? "warn" : "ok",
        columnLabel: "",
        editable: true,
        options: [0, 20],
        value: scores.herstellerfeed,
        onChange: (v) => setScores((s) => ({ ...s, herstellerfeed: v })),
        description: scoreReasons.herstellerfeed,
      },
      {
        id: "titel",
        label: "Titel",
        status: scores.titel === 0 ? "bad" : scores.titel < 20 ? "warn" : "ok",
        columnLabel: titleCol || "",
        editable: true,
        options: [0, 10, 20],
        value: scores.titel,
        onChange: (v) => setScores((s) => ({ ...s, titel: v })),
        description: scoreReasons.titel,
      },
      {
        id: "beschreibung",
        label: "Beschreibung",
        status: scores.beschreibung === 0 ? "bad" : scores.beschreibung < 10 ? "warn" : "ok",
        columnLabel: descCol || "",
        editable: true,
        options: [0, 5, 10],
        value: scores.beschreibung,
        onChange: (v) => setScores((s) => ({ ...s, beschreibung: v })),
        description: scoreReasons.beschreibung,
      },
      {
        id: "abmessungen",
        label: "Abmessungen",
        status: scores.abmessungen === 0 ? "bad" : scores.abmessungen < 10 ? "warn" : "ok",
        columnLabel: dimCol || "",
        editable: true,
        options: [0, 5, 10],
        value: scores.abmessungen,
        onChange: (v) => setScores((s) => ({ ...s, abmessungen: v })),
        description: scoreReasons.abmessungen,
      },
      {
        id: "lieferumfang",
        label: "Lieferumfang",
        status: scores.lieferumfang === 0 ? "bad" : scores.lieferumfang < 20 ? "warn" : "ok",
        columnLabel: deliveryCol || "",
        editable: true,
        options: [0, 10, 20],
        value: scores.lieferumfang,
        onChange: (v) => setScores((s) => ({ ...s, lieferumfang: v })),
        description: scoreReasons.lieferumfang,
      },
      {
        id: "material",
        label: "Material",
        status: scores.material === 0 ? "bad" : scores.material < 10 ? "warn" : "ok",
        columnLabel: materialCol || "",
        editable: true,
        options: [0, 5, 10],
        value: scores.material,
        onChange: (v) => setScores((s) => ({ ...s, material: v })),
        description: scoreReasons.material,
      },
      {
        id: "farbe",
        label: "Farbe",
        status: scores.farbe === 0 ? "bad" : scores.farbe < 10 ? "warn" : "ok",
        columnLabel: colorCol || "",
        editable: true,
        options: [0, 5, 10],
        value: scores.farbe,
        onChange: (v) => setScores((s) => ({ ...s, farbe: v })),
        description: scoreReasons.farbe,
      },
      {
        id: "shoptexte",
        label: "Shopbezogene Texte",
        status: scores.shoptexte === 0 ? "bad" : scores.shoptexte < 10 ? "warn" : "ok",
        columnLabel: descCol ? `Scan: ${descCol}` : "",
        editable: true,
        options: [0, 5, 10],
        value: scores.shoptexte,
        onChange: (v) => setScores((s) => ({ ...s, shoptexte: v })),
        description: scoreReasons.shoptexte,
      },
      {
        id: "bware",
        label: "B-Ware / Gebraucht",
        status: scores.bware === 0 ? "bad" : "ok",
        columnLabel: [titleCol, descCol].filter(Boolean).map((c) => `Scan: ${c}`).join(", "),
        editable: true,
        options: [0, 10],
        value: scores.bware,
        onChange: (v) => setScores((s) => ({ ...s, bware: v })),
        description: scoreReasons.bware,
      },
    ];

    return base.map((item) => ({
      ...item,
      criteria: ATTRIBUTE_CRITERIA[item.id] || null,
    }));
  }, [scores, brandCol, titleCol, descCol, dimCol, deliveryCol, materialCol, colorCol, scoreReasons]);

  const imageItems = useMemo(() => {
    const base = [
      {
        id: "bildmatch",
        label: "1. Bild & keine Dopplungen",
        status: scores.bildmatch === 0 ? "bad" : scores.bildmatch < 20 ? "warn" : "ok",
        editable: true,
        options: [0, 20],
        value: scores.bildmatch,
        onChange: (v) => setScores((s) => ({ ...s, bildmatch: v })),
        description: scoreReasons.bildmatch,
      },
      {
        id: "freisteller",
        label: "Freisteller",
        status: scores.freisteller === 0 ? "bad" : scores.freisteller < 10 ? "warn" : "ok",
        editable: true,
        options: [0, 5, 10],
        value: scores.freisteller,
        onChange: (v) => setScores((s) => ({ ...s, freisteller: v })),
        description: scoreReasons.freisteller,
      },
      {
        id: "millieu",
        label: "Milieu",
        status: scores.millieu === 0 ? "bad" : scores.millieu < 10 ? "warn" : "ok",
        editable: true,
        options: [0, 5, 10],
        value: scores.millieu,
        onChange: (v) => setScores((s) => ({ ...s, millieu: v })),
        description: scoreReasons.millieu,
      },
      {
        id: "anzahlbilder",
        label: "Anzahl Bilder",
        status: scores.anzahlbilder === 0 ? "bad" : scores.anzahlbilder < 10 ? "warn" : "ok",
        editable: true,
        options: [0, 5, 10],
        value: scores.anzahlbilder,
        onChange: (v) => setScores((s) => ({ ...s, anzahlbilder: v })),
        description: scoreReasons.anzahlbilder,
      },
    ];

    return base.map((item) => ({
      ...item,
      criteria: IMAGE_CRITERIA[item.id] || null,
    }));
  }, [scores, scoreReasons]);

  const brandExamples = useMemo(() => {
    if (!brandCol) return [];
    return sampleUniqueValues(rows, brandCol, 10);
  }, [rows, brandCol]);

  const titleExamples = useMemo(() => {
    if (!titleCol) return [];
    return sampleUniqueValues(rows, titleCol, 20);
  }, [rows, titleCol]);

  const descExamples = useMemo(() => {
    if (!descCol) return [];
    return sampleUniqueValues(rows, descCol, 20);
  }, [rows, descCol]);

  const dimExamples = useMemo(() => {
    if (dimCol) return sampleUniqueValues(rows, dimCol, 20);
    if (!titleCol && !descCol) return [];
    const texts = [];
    for (const r of rows) {
      const blob = [titleCol, descCol].filter(Boolean).map((c) => safeStr(r[c])).join(" ");
      if (!blob) continue;
      if (DIM_RE.test(blob)) texts.push(blob);
      if (texts.length >= 60) break;
    }
    return uniqueNonEmpty(texts).slice(0, 20);
  }, [rows, dimCol, titleCol, descCol]);

  const deliveryExamples = useMemo(() => {
    if (!deliveryCol) return [];
    return sampleUniqueValues(rows, deliveryCol, 20);
  }, [rows, deliveryCol]);

  const materialExamples = useMemo(() => {
    if (!materialCol) return [];
    return sampleUniqueValues(rows, materialCol, 20);
  }, [rows, materialCol]);

  const colorExamples = useMemo(() => {
    if (!colorCol) return [];
    return sampleUniqueValues(rows, colorCol, 20);
  }, [rows, colorCol]);

  const [brandExampleLimit, setBrandExampleLimit] = useState(5);
  const [titleExampleLimit, setTitleExampleLimit] = useState(5);
  const [descExampleLimit, setDescExampleLimit] = useState(3);
  const [dimExampleLimit, setDimExampleLimit] = useState(3);
  const [deliveryExampleLimit, setDeliveryExampleLimit] = useState(3);
  const [materialExampleLimit, setMaterialExampleLimit] = useState(5);
  const [colorExampleLimit, setColorExampleLimit] = useState(5);
  const [shopExampleLimit, setShopExampleLimit] = useState(3);

  if (!headers.length) {
    return (
      <div style={{ width: "100%", fontFamily: "ui-sans-serif, system-ui" }}>
        <SmallText>Bitte zuerst eine CSV Datei hochladen um das Content Scoring zu starten.</SmallText>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", fontFamily: "ui-sans-serif, system-ui", boxSizing: "border-box" }}>
      {total > 0 ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #A7F3D0", background: "#ECFDF3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#047857", fontWeight: 600 }}>Attribute Score</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>{attributeScore}</span>
                <span style={{ fontSize: 11, color: "#6B7280" }}>/ 90</span>
              </div>
            </div>
            <button
              onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(`Attribute Score ${attributeScore} von 90`).catch(() => {}); }}
              style={{ padding: "3px 7px", borderRadius: 999, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
            >Kopieren</button>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #BFDBFE", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#1D4ED8", fontWeight: 600 }}>Bild Score</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>{imageScore}</span>
                <span style={{ fontSize: 11, color: "#6B7280" }}>/ 90</span>
              </div>
            </div>
            <button
              onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(`Bild Score ${imageScore} von 90`).catch(() => {}); }}
              style={{ padding: "3px 7px", borderRadius: 999, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
            >Kopieren</button>
          </div>

          {(() => {
            const apaFailures = apaEligible ? [] : [
              attributeScore < 70 && `Attribute Score ${attributeScore}/90 — mind. 70 benötigt`,
              imageScore < 60 && `Bild Score ${imageScore}/90 — mind. 60 benötigt`,
              scores.titel < 10 && `Titel: ${scores.titel}/20 — mind. 10`,
              scores.beschreibung < 5 && `Beschreibung: ${scores.beschreibung}/10 — mind. 5`,
              scores.abmessungen < 5 && `Abmessungen: ${scores.abmessungen}/10 — mind. 5`,
              scores.lieferumfang < 10 && `Lieferumfang: ${scores.lieferumfang}/20 — mind. 10`,
              scores.material < 5 && `Material: ${scores.material}/10 — mind. 5`,
              scores.farbe < 5 && `Farbe: ${scores.farbe}/10 — mind. 5`,
              scores.shoptexte < 5 && `Shoptexte: ${scores.shoptexte}/10 — muss 10 sein (keine Shoptexte)`,
              scores.bware < 10 && `B-Ware / Gebraucht: ${scores.bware}/10 — B-Ware oder Gebraucht-Hinweis erkannt`,
              scores.bildmatch !== 20 && `1. Bild & keine Dopplungen: ${scores.bildmatch}/20 — Pflicht: 20`,
              scores.freisteller < 5 && `Freisteller: ${scores.freisteller}/10 — mind. 5`,
              scores.millieu < 5 && `Milieu: ${scores.millieu}/10 — mind. 5`,
              scores.anzahlbilder < 5 && `Anzahl Bilder: ${scores.anzahlbilder}/10 — mind. 5`,
            ].filter(Boolean);
            return (
              <div style={{ padding: "10px 14px", borderRadius: 10, border: apaEligible ? "1px solid #A7F3D0" : "1px solid #FCA5A5", background: apaEligible ? "#ECFDF3" : "#FEF2F2" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: apaEligible ? "#047857" : "#B91C1C", fontWeight: 600 }}>APA Eignung</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginTop: 2 }}>{apaEligible ? "✅ Geeignet" : "❌ Nicht geeignet"}</div>
                {apaFailures.length > 0 ? (
                  <ul style={{ margin: "6px 0 0 0", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
                    {apaFailures.map((reason, i) => (
                      <li key={i} style={{ fontSize: 11, color: "#B91C1C", lineHeight: "16px" }}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : null}

      {total > 0 ? (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => {
              setSaveForm((f) => ({
                ...f,
                todo: apaEligible ? "APA-Freigabe" : "Nein",
                mailPartner: apaEligible ? "Nein" : "Feedanpassung beim Partner anfragen",
                apaOverride: null,
              }));
              setModalScores({ ...scores });
              setModalShowScores(false);
              setSaveModalOpen(true);
              setSaveSuccess(false);
            }}
            style={{
              padding: "10px 20px", borderRadius: 8, border: `2px solid ${BRAND_COLOR}`,
              background: BRAND_COLOR, color: "#FFF", fontSize: 13, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
            }}
          >
            + Zu Tabelle hinzufügen
          </button>
        </div>
      ) : null}

      {saveModalOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setSaveModalOpen(false); }}
        >
          <div style={{
            background: "#FFF", borderRadius: 14, padding: 24, width: "100%", maxWidth: 560,
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", marginBottom: 4 }}>Zu Ergebnistabelle hinzufügen</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 18 }}>
              Scores werden automatisch übernommen. Bitte Pflichtfelder ergänzen.
            </div>

            {/* Score preview + overrides */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "10px 12px", borderRadius: 8, background: "#F3F4F6", border: "1px solid #E5E7EB", marginBottom: 6 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Attribute Score</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginTop: 2 }}>{mAttr} / 90</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Image Score</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginTop: 2 }}>{mImg} / 90</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>APA Eignung</div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 4 }}>
                    {[{ val: true, label: "✅ Ja" }, { val: false, label: "❌ Nein" }].map(({ val, label }) => {
                      const isActive = saveForm.apaOverride !== null ? saveForm.apaOverride === val : mApa === val;
                      const isOverride = saveForm.apaOverride === val;
                      return (
                        <button key={label} type="button"
                          onClick={() => setSaveForm((f) => ({ ...f, apaOverride: f.apaOverride === val ? null : val }))}
                          style={{
                            padding: "2px 8px", borderRadius: 4, border: "1px solid",
                            borderColor: isActive ? (val ? "#16A34A" : "#DC2626") : "#D1D5DB",
                            background: isActive ? (val ? "#DCFCE7" : "#FEE2E2") : "#FFF",
                            color: isActive ? (val ? "#166534" : "#991B1B") : "#9CA3AF",
                            fontSize: 11, fontWeight: isOverride ? 800 : 600, cursor: "pointer",
                            outline: isOverride ? `2px solid ${val ? "#16A34A" : "#DC2626"}` : "none",
                          }}
                        >{label}</button>
                      );
                    })}
                  </div>
                  {saveForm.apaOverride !== null && (
                    <div style={{ fontSize: 9, color: "#6B7280", marginTop: 2 }}>manuell überschrieben</div>
                  )}
                </div>
              </div>

              {/* Score editor toggle */}
              <button type="button"
                onClick={() => setModalShowScores((v) => !v)}
                style={{ fontSize: 11, color: "#1553B6", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
              >
                {modalShowScores ? "▲ Scores ausblenden" : "▼ Scores manuell anpassen"}
              </button>

              {modalShowScores && (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { key: "titel",        label: "Titel",         opts: [0, 10, 20] },
                    { key: "beschreibung", label: "Beschreibung",  opts: [0, 5, 10] },
                    { key: "abmessungen",  label: "Abmessungen",   opts: [0, 5, 10] },
                    { key: "lieferumfang", label: "Lieferumfang",  opts: [0, 10, 20] },
                    { key: "material",     label: "Material",      opts: [0, 5, 10] },
                    { key: "farbe",        label: "Farbe",         opts: [0, 5, 10] },
                    { key: "shoptexte",    label: "Shoptexte",     opts: [0, 5, 10] },
                    { key: "bware",        label: "B-Ware",        opts: [0, 10] },
                    { key: "bildmatch",    label: "Bild Match",    opts: [0, 20] },
                    { key: "freisteller",  label: "Freisteller",   opts: [0, 5, 10] },
                    { key: "millieu",      label: "Milieu",        opts: [0, 5, 10] },
                    { key: "anzahlbilder", label: "Anzahl Bilder", opts: [0, 5, 10] },
                  ].map(({ key, label, opts }) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                      <span style={{ fontSize: 11, color: "#374151" }}>{label}</span>
                      <select
                        value={mS[key]}
                        onChange={(e) => setModalScores((s) => ({ ...s, [key]: Number(e.target.value) }))}
                        style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #D1D5DB", fontSize: 11, background: "#FFF", cursor: "pointer" }}
                      >
                        {opts.map((o) => <option key={o} value={o}>{o} P</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              {[
                { key: "coreId", label: "Core ID *", placeholder: "z. B. 9CYE" },
                { key: "sellerKey", label: "Seller Key", placeholder: "z. B. tempur" },
                { key: "name", label: "Name (Bearbeiter)", placeholder: "z. B. Isa" },
                { key: "kommentar", label: "Kommentar", placeholder: "Optional" },
              ].map(({ key, label, placeholder }) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{label}</span>
                  <input
                    type="text"
                    value={saveForm[key]}
                    placeholder={placeholder}
                    onChange={(e) => setSaveForm((f) => ({ ...f, [key]: e.target.value }))}
                    style={{
                      padding: "8px 10px", borderRadius: 6, border: "1px solid #D1D5DB",
                      fontSize: 13, color: "#111827", outline: "none",
                    }}
                  />
                </label>
              ))}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Manuelle APA-Felder</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
              {[
                { key: "crossSelling",     label: "kein Cross-Selling in Beschreibung" },
                { key: "beschreibungHtml", label: "Beschreibung in HTML" },
                { key: "duplikate",        label: "Doppelte Offer Prüfung" },
                { key: "stammArtikel",     label: "keine Stamm-/Parentartikel" },
                { key: "encoding",         label: "Encoding falsch/Feed zerschossen" },
                { key: "bware",            label: "B-Ware" },
              ].map(({ key, label }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                  <span style={{ fontSize: 12, color: "#374151" }}>{label}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["ok", "Problem"].map((opt) => (
                      <button key={opt} type="button"
                        onClick={() => setSaveForm((f) => ({ ...f, [key]: opt }))}
                        style={{
                          padding: "3px 10px", borderRadius: 5, border: "1px solid",
                          borderColor: saveForm[key] === opt ? (opt === "ok" ? "#16A34A" : "#DC2626") : "#D1D5DB",
                          background: saveForm[key] === opt ? (opt === "ok" ? "#DCFCE7" : "#FEE2E2") : "#FFF",
                          color: saveForm[key] === opt ? (opt === "ok" ? "#166534" : "#991B1B") : "#6B7280",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}
                      >{opt}</button>
                    ))}
                  </div>
                </div>
              ))}

              {/* TO DO */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                <span style={{ fontSize: 12, color: "#374151" }}>TO DO</span>
                <select
                  value={saveForm.todo}
                  onChange={(e) => setSaveForm((f) => ({ ...f, todo: e.target.value }))}
                  style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #D1D5DB", fontSize: 12, background: "#FFF", cursor: "pointer" }}
                >
                  <option>APA-Freigabe</option>
                  <option>Nein</option>
                </select>
              </div>

              {/* Mail an Partner */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                <span style={{ fontSize: 12, color: "#374151" }}>Mail an Partner</span>
                <select
                  value={saveForm.mailPartner}
                  onChange={(e) => setSaveForm((f) => ({ ...f, mailPartner: e.target.value }))}
                  style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #D1D5DB", fontSize: 12, background: "#FFF", cursor: "pointer" }}
                >
                  <option>Nein</option>
                  <option>APA-Freigabe</option>
                  <option>Feedanpassung beim Partner anfragen</option>
                </select>
              </div>
            </div>

            {saveSuccess && (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "#DCFCE7", border: "1px solid #86EFAC", color: "#166534", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                ✓ Eintrag gespeichert! Gehe zu "Ergebnistabelle" um alle Einträge zu sehen.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                style={{ padding: "10px 16px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!saveForm.coreId.trim()) {
                    alert("Bitte Core ID eingeben.");
                    return;
                  }
                  const okIf = (s) => s > 0 ? "ok" : "Problem";
                  const today = new Date();
                  const datum = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getFullYear()).slice(2)}`;
                  const gtin = eanCol ? (rows.filter((r) => safeStr(r[eanCol]).trim()).length / rows.length > 0.9 ? "ok" : "Problem") : "Problem";
                  saveResultToStorage({
                    id: Date.now() + Math.random().toString(36).slice(2),
                    coreId: saveForm.coreId.trim(),
                    sellerKey: saveForm.sellerKey.trim(),
                    name: saveForm.name.trim(),
                    kommentar: saveForm.kommentar.trim(),
                    datum,
                    // QS scores (use modal-adjusted values)
                    herstellerfeed: mS.herstellerfeed,
                    titel: mS.titel,
                    beschreibung: mS.beschreibung,
                    abmessungen: mS.abmessungen,
                    lieferumfang: mS.lieferumfang,
                    material: mS.material,
                    farbe: mS.farbe,
                    shoptexte: mS.shoptexte,
                    bware: mS.bware,
                    bildmatch: mS.bildmatch,
                    freisteller: mS.freisteller,
                    millieu: mS.millieu,
                    anzahlbilder: mS.anzahlbilder,
                    attributeScore: mAttr,
                    imageScore: mImg,
                    // APA fields
                    coreStatus: saveForm.coreStatus,
                    apaFreigabe: mApa ? 1 : 0,
                    gtin,
                    titel_apa: okIf(mS.titel),
                    beschreibung_apa: okIf(mS.beschreibung),
                    shoptext_apa: okIf(mS.shoptexte),
                    bware_apa: okIf(mS.bware),
                    crossSelling: saveForm.crossSelling,
                    beschreibungHtml: saveForm.beschreibungHtml,
                    masse: okIf(mS.abmessungen),
                    material_apa: okIf(mS.material),
                    farbe_apa: okIf(mS.farbe),
                    lieferumfang_apa: okIf(mS.lieferumfang),
                    bildMatch: okIf(mS.bildmatch),
                    mangelBilder: okIf(mS.anzahlbilder),
                    duplikate: saveForm.duplikate,
                    stammArtikel: saveForm.stammArtikel,
                    encoding: saveForm.encoding,
                    bware: saveForm.bware,
                    todo: saveForm.todo,
                    mailPartner: saveForm.mailPartner,
                  });
                  setSaveSuccess(true);
                  setSaveForm((f) => ({ ...f, coreId: "", sellerKey: "", name: "", kommentar: "" }));
                }}
                style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: BRAND_COLOR, color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, padding: 16, borderRadius: 12, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Attribute Qualität</div>
        <SmallText>
          Bewertung von Herstellerfeed, Titeln, Beschreibungen, Abmessungen, Lieferumfang und Textattributen. Herstellerfeed wird
          ausschließlich manuell per Ja/Nein bewertet.
        </SmallText>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {attributeItems.map((item) => {
            const toneColor = item.status === "ok" ? "#16A34A" : item.status === "bad" ? "#DC2626" : "#F59E0B";
            const toneBg = item.status === "ok" ? "#F0FDF4" : item.status === "bad" ? "#FEF2F2" : "#FFFBEB";
            const hasColumn = !!item.columnLabel;
            const columnText = hasColumn ? `Spalte: ${item.columnLabel}` : "Spalte nicht erkannt";
            const maxPts = Math.max(...item.options);

            return (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", padding: "10px 14px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#FAFAFA", gap: 6 }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{ padding: "4px 10px", borderRadius: 6, background: toneBg, border: `1px solid ${toneColor}33`, fontSize: 13, fontWeight: 800, color: toneColor, minWidth: 52, textAlign: "center" }}>
                      {item.value}/{maxPts}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.id === "herstellerfeed" ? "Manuelle Bewertung" : columnText}
                      </div>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {item.id === "herstellerfeed" ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" onClick={() => item.onChange(20)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: item.value === 20 ? "1px solid #16A34A" : "1px solid #D1D5DB", background: item.value === 20 ? "#DCFCE7" : "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Ja
                        </button>
                        <button type="button" onClick={() => item.onChange(0)}
                          style={{ padding: "4px 10px", borderRadius: 6, border: item.value === 0 ? "1px solid #DC2626" : "1px solid #D1D5DB", background: item.value === 0 ? "#FEE2E2" : "#FFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                          Nein
                        </button>
                      </div>
                    ) : item.editable ? (
                      <select value={item.value} onChange={(e) => item.onChange(Number(e.target.value))} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 12, background: "#FFF", cursor: "pointer" }}>
                        {item.options.map((opt) => (<option key={opt} value={opt}>{opt} P</option>))}
                      </select>
                    ) : (
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600 }}>{item.value} P</span>
                    )}
                  </div>
                </div>
                {/* Description */}
                {item.description ? <div style={{ fontSize: 11, color: "#4B5563", lineHeight: "16px" }}>{item.description}</div> : null}
                {/* Per-item criteria dropdown */}
                {item.criteria?.tiers?.length ? (
                  <>
                    {expandedCriteria[item.id] ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                        {item.criteria.synonyms?.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                            <span style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginRight: 2 }}>Spalten:</span>
                            {item.criteria.synonyms.map((s) => (
                              <code key={s} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151", fontFamily: "monospace" }}>{s}</code>
                            ))}
                          </div>
                        ) : null}
                        {item.criteria.note ? (
                          <div style={{ fontSize: 10, color: "#6B7280", lineHeight: "15px" }}>{item.criteria.note}</div>
                        ) : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {item.criteria.tiers.map((line, idx) => {
                            const pts = line.match(/^(\d+)\s*P/);
                            const isActive = pts && Number(pts[1]) === item.value;
                            return (
                              <div key={idx} style={{
                                fontSize: 10, lineHeight: "14px", padding: "3px 8px", borderRadius: 6,
                                background: isActive ? toneBg : "#F3F4F6",
                                border: isActive ? `1px solid ${toneColor}44` : "1px solid #E5E7EB",
                                color: isActive ? toneColor : "#6B7280",
                                fontWeight: isActive ? 600 : 400,
                              }}>
                                {line}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleCriteria(item.id)}
                      style={{
                        alignSelf: "flex-start",
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid #D1D5DB",
                        background: "#FFF",
                        color: "#374151",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        marginTop: 2,
                      }}
                    >
                      {expandedCriteria[item.id] ? "▲ Kriterien ausblenden" : "▼ Kriterien anzeigen"}
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, borderRadius: 12, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Bildqualität</div>
        <SmallText>
          Bewertung von erstem Bild, Freistellern, Milieu und Anzahl Bilder. Alle Kriterien werden automatisch erkannt. Werte können manuell angepasst werden.
        </SmallText>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {imageItems.map((item) => {
            const toneColor = item.status === "ok" ? "#16A34A" : item.status === "bad" ? "#DC2626" : "#F59E0B";
            const toneBg = item.status === "ok" ? "#F0FDF4" : item.status === "bad" ? "#FEF2F2" : "#FFFBEB";
            const maxPts = Math.max(...item.options);
            return (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", padding: "10px 14px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#FAFAFA", gap: 6 }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <div style={{ padding: "4px 10px", borderRadius: 6, background: toneBg, border: `1px solid ${toneColor}33`, fontSize: 13, fontWeight: 800, color: toneColor, minWidth: 52, textAlign: "center" }}>
                      {item.value}/{maxPts}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{item.label}</div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {item.editable ? (
                      <select value={item.value} onChange={(e) => item.onChange(Number(e.target.value))} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 12, background: "#FFF", cursor: "pointer" }}>
                        {item.options.map((opt) => (<option key={opt} value={opt}>{opt} P</option>))}
                      </select>
                    ) : (
                      <span style={{ padding: "3px 8px", borderRadius: 6, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600 }}>{item.value} P</span>
                    )}
                  </div>
                </div>
                {/* Description */}
                {item.description ? <div style={{ fontSize: 11, color: "#4B5563", lineHeight: "16px" }}>{item.description}</div> : null}
                {/* Per-item criteria dropdown */}
                {item.criteria?.tiers?.length ? (
                  <>
                    {expandedCriteria[item.id] ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                        {item.criteria.synonyms?.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
                            <span style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginRight: 2 }}>Spalten:</span>
                            {item.criteria.synonyms.map((s) => (
                              <code key={s} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "#F3F4F6", border: "1px solid #E5E7EB", color: "#374151", fontFamily: "monospace" }}>{s}</code>
                            ))}
                          </div>
                        ) : null}
                        {item.criteria.note ? (
                          <div style={{ fontSize: 10, color: "#6B7280", lineHeight: "15px" }}>{item.criteria.note}</div>
                        ) : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {item.criteria.tiers.map((line, idx) => {
                            const pts = line.match(/^(\d+)\s*P/);
                            const isActive = pts && Number(pts[1]) === item.value;
                            return (
                              <div key={idx} style={{
                                fontSize: 10, lineHeight: "14px", padding: "3px 8px", borderRadius: 6,
                                background: isActive ? toneBg : "#F3F4F6",
                                border: isActive ? `1px solid ${toneColor}44` : "1px solid #E5E7EB",
                                color: isActive ? toneColor : "#6B7280",
                                fontWeight: isActive ? 600 : 400,
                              }}>
                                {line}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleCriteria(item.id)}
                      style={{
                        alignSelf: "flex-start",
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid #D1D5DB",
                        background: "#FFF",
                        color: "#374151",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        marginTop: 2,
                      }}
                    >
                      {expandedCriteria[item.id] ? "▲ Kriterien ausblenden" : "▼ Kriterien anzeigen"}
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Bildanalyse Details */}
        {qsImageSamples.length > 0 && Object.keys(freistellerChecks || {}).length > 0 && (() => {
          const samples = qsImageSamples.slice(0, 20);
          let checked = 0, frei = 0, mil = 0;
          samples.forEach((s) => {
            const r = freistellerChecks[s.id];
            if (!r || !r.checkedCount) return;
            checked += 1;
            if (r.hasFreisteller) frei += 1;
            if (r.hasMilieu) mil += 1;
          });
          const firstUrls = qsImageSamples.map((s) => (s.urls && s.urls[0]) || "").filter(Boolean);
          const urlCounts = {};
          firstUrls.forEach((u) => { urlCounts[u] = (urlCounts[u] || 0) + 1; });
          const uniqueFirst = Object.keys(urlCounts).length;
          const dupFirst = Object.values(urlCounts).filter((c) => c > 1).reduce((sum, c) => sum + c, 0);
          if (!checked && !firstUrls.length) return null;
          return (
            <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", fontSize: 11, color: "#6B7280", lineHeight: "18px" }}>
              <div style={{ fontWeight: 700, color: "#111827", fontSize: 12, marginBottom: 4 }}>Automatische Bildanalyse ({checked} Produkte geprüft)</div>
              {checked > 0 && <div>Freisteller: {frei}/{checked} ({Math.round(frei / checked * 100)}%) | Milieu: {mil}/{checked} ({Math.round(mil / checked * 100)}%)</div>}
              <div>Erstbilder: {uniqueFirst} einzigartig, {dupFirst} doppelt | Durchschn. {avgImageCount.toFixed(1)} Bilder/Produkt</div>
              {freistellerLoading && <div style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND_COLOR, fontWeight: 600, fontSize: 12 }}><Spinner /> Bildanalyse läuft...</div>}
            </div>
          );
        })()}

        {qsImageSamples.length ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {qsImageSamples.slice(0, imageSampleLimit).map((sample) => (
              <div key={sample.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF" }}>
                <div style={{ width: 140, flexShrink: 0 }}>
                  {sample.title && <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample.title.slice(0, 40)}</div>}
                  <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{sample.id}</div>
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>{sample.count} Bilder</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                  {sample.urls.slice(0, 5).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" title={u} style={{ display: "block" }}>
                      <img src={u} alt="" loading="lazy"
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB", display: "block" }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            ))}
            {imageSampleLimit < qsImageSamples.length && (
              <button onClick={() => setImageSampleLimit((n) => Math.min(qsImageSamples.length, n + 5))}
                style={{ padding: "8px 14px", marginBottom: 40, borderRadius: 8, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 12, fontWeight: 600, width: "fit-content" }}>
                Mehr Produkte anzeigen
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div style={{ height: 60 }} />
    </div>
  );
}

// ─── CHECK24 Merchant Center style Feed Checker ──────────────────────────────

const MC_BLUE = "#1553B6";

function McIcon({ name, active }) {
  const color = active ? MC_BLUE : "#6B7280";
  const s = { width: 18, height: 18, flexShrink: 0 };
  if (name === "dashboard") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/>
      <rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/>
    </svg>
  );
  if (name === "bestellungen") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <path d="M3 6l7-3 7 3v8l-7 3-7-3V6z"/><path d="M10 3v14M3 6l7 3 7-3"/>
    </svg>
  );
  if (name === "angebote") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>
    </svg>
  );
  if (name === "finanzen") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <circle cx="10" cy="10" r="8"/><path d="M10 5v1m0 8v1M7.5 8.5a2.5 2 0 015 0c0 1.5-2.5 2-2.5 3.5m0 0a2.5 2 0 005 0"/>
    </svg>
  );
  if (name === "einstellungen") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <circle cx="10" cy="10" r="2.5"/>
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/>
    </svg>
  );
  if (name === "pause") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <rect x="5" y="3" width="3" height="14" rx="1"/><rect x="12" y="3" width="3" height="14" rx="1"/>
    </svg>
  );
  if (name === "faq") return (
    <svg style={s} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.6">
      <circle cx="10" cy="10" r="8"/>
      <path d="M7.5 7.5a2.5 2.5 0 015 .8c0 1.7-2.5 2-2.5 3.7"/><circle cx="10" cy="15" r=".6" fill={color} stroke="none"/>
    </svg>
  );
  return null;
}

const MC_NAV_ITEMS = [
  { id: "dashboard",     label: "Dashboard",      icon: "dashboard" },
  { id: "bestellungen",  label: "Bestellungen",   icon: "bestellungen" },
  { id: "angebote",      label: "Angebote",        icon: "angebote" },
  { id: "finanzen",      label: "Finanzen",        icon: "finanzen" },
  { id: "einstellungen", label: "Einstellungen",   icon: "einstellungen", children: [
    { id: "geschaeftsdaten",      label: "Geschäftsdaten" },
    { id: "bankdaten",            label: "Bankdaten" },
    { id: "kommunikation",        label: "Kommunikation" },
    { id: "logindaten",           label: "Logindaten" },
    { id: "verpackungen",         label: "Verpackungen" },
    { id: "versand",              label: "Versand" },
    { id: "ruecksendung",         label: "Rücksendung" },
    { id: "preisnachlassregeln",  label: "Preisnachlassregeln" },
    { id: "angebotsfeed",         label: "Angebotsfeed" },
    { id: "bestelluebermittlung", label: "Bestellübermittlung" },
    { id: "produktsicherheit",    label: "Produktsicherheit (GPSR)" },
  ]},
  { id: "shop-pause",    label: "Shop pausieren",  icon: "pause" },
  { id: "faq",           label: "FAQ",             icon: "faq" },
];

// Stufe 1: Live-Fähigkeit (Hard Gate) – 25 Pflichtattribute (CHECK24 Attributübersicht V2025)
// Sortiert absteigend nach Wichtigkeit
const MC_PFLICHT_COLS = [
  // Kern-Identifikation (am wichtigsten)
  "name", "description", "brand", "category_path", "seller_offer_id", "ean",
  // Preis & Verfügbarkeit
  "price", "availability", "stock_amount", "delivery_time", "delivery_includes", "shipping_mode",
  // Hauptbild
  "image_url",
  // Produktmerkmale
  "color", "material", "size", "size_height", "size_depth", "size_diameter",
  // Herstellerangaben
  "manufacturer_name", "manufacturer_street", "manufacturer_postcode",
  "manufacturer_city", "manufacturer_country", "manufacturer_email",
];
// Stufe 2: Feed-Qualitätsscore – empfohlene Attribute (Score-relevant, 27 + Bildlink_2–10)
const MC_OPTIONAL_COLS = [
  // Informationen (2)
  "deeplink", "model",
  // Produktmerkmale (7)
  "size_lying_surface", "size_seat_height", "ausrichtung", "style", "temper", "weight", "weight_capacity",
  // Medien extra (4 non-image)
  "youtube_link", "bild_3d_glb", "bild_3d_usdz", "assembly_instructions",
  // Funktion & Ausstattung (7)
  "illuminant_included", "incl_mattress", "incl_slatted_frame", "led_verbaut", "lighting_included", "set_includes", "socket",
  // Textilien & Polster (4)
  "care_instructions", "filling", "removable_cover", "suitable_for_allergic",
  // Nachweise (2)
  "energy_efficiency_category", "product_data_sheet",
  // Herstellerangaben (1)
  "manufacturer_phone_number",
];
const MC_PFLICHT_ALIASES = {
  ean: ["ean", "gtin", "gtin14", "ean13", "barcode"],
  brand: ["brand", "marke"],
  category_path: ["category_path", "kategorie", "category", "kategoriepfad"],
  description: ["description", "beschreibung", "desc"],
  name: ["name", "title", "titel", "product_name", "produktname"],
  seller_offer_id: ["seller_offer_id", "offer_id", "sku", "merchant_sku", "eindeutige_id", "eindeutige id", "unique_id"],
  color: ["color", "farbe", "colour"],
  material: ["material", "materials"],
  material: ["material", "materials", "werkstoff", "rohstoff", "materialart", "material_art", "material_type"],
  size: ["size", "abmessung", "dimension", "größe", "groesse", "maße", "masse"],
  size_depth: ["size_depth", "tiefe", "depth"],
  size_diameter: ["size_diameter", "durchmesser", "diameter"],
  size_height: ["size_height", "höhe", "hoehe", "height"],
  image_url: ["image_url", "image", "img_url", "bild", "bild_url", "bildlink_1", "bildlink1"],
  manufacturer_name: ["manufacturer_name", "manufacturer", "hersteller"],
  manufacturer_street: ["manufacturer_street", "hersteller_strasse", "hersteller_straße"],
  manufacturer_postcode: ["manufacturer_postcode", "hersteller_plz"],
  manufacturer_city: ["manufacturer_city", "hersteller_stadt", "hersteller_ort"],
  manufacturer_country: ["manufacturer_country", "hersteller_land"],
  manufacturer_email: ["manufacturer_email", "hersteller_email"],
  availability: ["availability", "verfügbarkeit", "verfuegbarkeit", "lieferstatus"],
  delivery_time: ["delivery_time", "lieferzeit", "delivery time"],
  delivery_includes: ["delivery_includes", "lieferumfang"],
  price: ["price", "preis", "vk", "selling_price"],
  stock_amount: ["stock_amount", "stock", "bestand", "quantity", "qty"],
  shipping_mode: ["shipping_mode", "versandart", "shipping", "shipping_type", "delivery_mode", "lieferart", "versand_art", "shipment_mode", "transport_mode"],
};
const MC_OPTIONAL_ALIASES = {
  deeplink: ["deeplink", "link", "url", "produktlink"],
  model: ["model", "modell"],
  size_lying_surface: ["size_lying_surface", "liegefläche", "liegeflaeche"],
  size_seat_height: ["size_seat_height", "sitzhöhe", "sitzhoehe"],
  ausrichtung: ["ausrichtung", "orientation"],
  style: ["style", "stil"],
  temper: ["temper", "härte", "haerte"],
  weight: ["weight", "gewicht"],
  weight_capacity: ["weight_capacity", "tragkraft", "belastbarkeit"],
  youtube_link: ["youtube_link", "youtube", "video_link"],
  bild_3d_glb: ["bild_3d_glb", "3d_glb", "glb"],
  bild_3d_usdz: ["bild_3d_usdz", "3d_usdz", "usdz"],
  assembly_instructions: ["assembly_instructions", "montageanleitung", "aufbauanleitung"],
  illuminant_included: ["illuminant_included", "leuchtmittel"],
  incl_mattress: ["incl_mattress", "matratze_enthalten", "mit_matratze"],
  incl_slatted_frame: ["incl_slatted_frame", "lattenrost_enthalten"],
  led_verbaut: ["led_verbaut", "led"],
  lighting_included: ["lighting_included", "beleuchtung"],
  set_includes: ["set_includes", "set_inhalt"],
  socket: ["socket", "steckdose"],
  care_instructions: ["care_instructions", "pflegehinweise"],
  filling: ["filling", "füllung", "fuellung"],
  removable_cover: ["removable_cover", "abnehmbarer_bezug"],
  suitable_for_allergic: ["suitable_for_allergic", "allergikergeeignet"],
  energy_efficiency_category: ["energy_efficiency_category", "energieklasse"],
  product_data_sheet: ["product_data_sheet", "datenblatt"],
  manufacturer_phone_number: ["manufacturer_phone_number", "hersteller_telefon"],
};

// Tiny SVG sparkline helper
function Sparkline({ values, color = "#1553B6" }) {
  const w = 120, h = 36, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function McAngebotsfeed() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [manualMapping, setManualMapping] = useState({});
  const [mappingExpanded, setMappingExpanded] = useState(false);
  const fileRef = useRef(null);
  const [uploadMethod, setUploadMethod] = useState("upload");
  const [feedFormat, setFeedFormat] = useState("CSV");
  const [feedDelimiter, setFeedDelimiter] = useState("semicolon");
  const [feedQuoteChar, setFeedQuoteChar] = useState("");

  function parseFile(f) {
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext !== "csv" && f.type !== "text/csv" && f.type !== "application/csv") return;
    setFile(f);
    setRows([]);
    setHeaders([]);
    setManualMapping({});
    const tryParseMc = (encoding) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result;
        if (typeof text !== "string") return;
        if (encoding === "UTF-8" && /Ã¤|Ã¶|Ã¼|Ã\x84|Ã\x96|Ã\x9C|Ã\x9F/.test(text)) {
          tryParseMc("windows-1252");
          return;
        }
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          relaxColumnCount: true,
          complete: (res) => {
            const r = Array.isArray(res.data) ? res.data : [];
            const h = res.meta?.fields || Object.keys(r[0] || {});
            setHeaders(h);
            setRows(r);
          },
        });
      };
      reader.readAsText(f, encoding);
    };
    tryParseMc("UTF-8");
  }

  // ── Same 3-tier mapping as Feed Analyse tab ──

  // Tier 1: auto-detect by header name (uses same bestHeaderMatch + synonyms)
  const mcAutoMapping = useMemo(() => {
    if (!headers.length) return {};
    const m = {};
    for (const key of MC_PFLICHT_COLS) {
      if (key === "image_url") continue; // image cols handled via imageColumns
      m[key] = bestHeaderMatch(headers, MC_PFLICHT_ALIASES[key] || [key]) || null;
    }
    for (const key of MC_OPTIONAL_COLS) {
      m[key] = bestHeaderMatch(headers, MC_OPTIONAL_ALIASES[key] || [key]) || null;
    }
    return m;
  }, [headers]);

  // Tier 2: content-based fallback for fields not found by name
  const mcContentMapping = useMemo(() => {
    if (!headers.length || !rows.length) return {};
    const allFields = [...MC_PFLICHT_COLS.filter((f) => f !== "image_url"), ...MC_OPTIONAL_COLS];
    const unmapped = allFields.filter((f) => !mcAutoMapping[f]);
    if (!unmapped.length) return {};
    return detectFieldByContent(unmapped, headers, rows);
  }, [headers, rows, mcAutoMapping]);

  // Final mapping: auto → content → manual overrides
  const mcMapping = useMemo(
    () => ({ ...mcAutoMapping, ...mcContentMapping, ...manualMapping }),
    [mcAutoMapping, mcContentMapping, manualMapping]
  );

  // Image columns (all headers that look like images)
  const mcImageColumns = useMemo(
    () => headers.filter((h) => { const n = h.toLowerCase(); return n.includes("image") || n.includes("bild") || n.includes("img"); }),
    [headers]
  );

  // Reactive analysis — re-runs whenever mapping or rows change
  // Implements Zwei-Stufen-Modell: Stufe 1 (Hard Gate) + Stufe 2 (Soft Score)
  const issues = useMemo(() => {
    if (!rows.length || !headers.length) return null;

    const missingPflichtCols = MC_PFLICHT_COLS.filter((c) => {
      if (c === "image_url") return mcImageColumns.length === 0;
      // Dimension columns are a group: any one of them satisfies the requirement
      const DIM_PFLICHT = ["size", "size_height", "size_depth", "size_diameter"];
      if (DIM_PFLICHT.includes(c)) return !DIM_PFLICHT.some((k) => !!mcMapping[k]);
      return !mcMapping[c];
    });
    const missingOptionalCols = MC_OPTIONAL_COLS.filter((c) => !mcMapping[c]);

    const pflichtErrors = [];
    const optionalHints = [];
    const duplicateEans = {}, duplicateNameEans = {};
    let pflichtOkCount = 0, totalOptionalFieldsPresent = 0;
    // Stufe 2: 27 recommended cols + 9 extra image slots (Bildlink_2–10)
    const optionalFieldCount = MC_OPTIONAL_COLS.length + 9;

    const pflichtErrorRowNums = new Set();

    rows.forEach((row, i) => {
      const rn = i + 1;
      const ean = mcMapping.ean ? String(row[mcMapping.ean] ?? "").trim() : "";
      const name = mcMapping.name ? String(row[mcMapping.name] ?? "").trim() : "";
      let pflichtOk = true;
      let optionalFieldsPresent = 0;

      for (const key of MC_PFLICHT_COLS) {
        if (key === "image_url") continue;
        const col = mcMapping[key];
        if (!col) continue;
        const val = String(row[col] ?? "").trim();
        if (!val) { pflichtErrors.push({ row: rn, ean, field: key, type: "missing" }); pflichtOk = false; continue; }
        if (key === "ean" && !/^\d{8,14}$/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; }
        if (key === "price") {
          if (/^[€$£]/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid_currency", value: val }); pflichtOk = false; }
          else { const n = parseFloat(val.replace(",", ".")); if (isNaN(n) || n <= 0) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; } }
        }
        if (key === "stock_amount" && !/^\d+$/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; }
        if (key === "shipping_mode" && val.toLowerCase() !== "paket" && val.toLowerCase() !== "spedition") { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; }
      }
      if (mcImageColumns.length > 0) {
        const imgCount = mcImageColumns.reduce((c, col) => c + (String(row[col] ?? "").trim() ? 1 : 0), 0);
        if (imgCount === 0) { pflichtErrors.push({ row: rn, ean, field: "image_url", type: "missing" }); pflichtOk = false; }
        else {
          const firstImgVal = String(row[mcImageColumns[0]] ?? "").trim();
          if (firstImgVal && !/^https?:\/\//i.test(firstImgVal)) { pflichtErrors.push({ row: rn, ean, field: "image_url", type: "invalid_url", value: firstImgVal }); pflichtOk = false; }
        }
      }

      // Stufe 2: recommended field fill rate
      for (const key of MC_OPTIONAL_COLS) {
        const col = mcMapping[key];
        if (!col) continue;
        if (!String(row[col] ?? "").trim()) { optionalHints.push({ row: rn, ean, field: key }); }
        else { optionalFieldsPresent++; }
      }
      // Extra image slots (Bildlink_2 to Bildlink_10 = up to 9 bonus slots)
      const extraImageCols = mcImageColumns.slice(1, 10);
      optionalFieldsPresent += extraImageCols.filter((col) => String(row[col] ?? "").trim()).length;

      // EAN tracking (Stufe 1: duplicates = hard error)
      if (ean) { if (!duplicateEans[ean]) duplicateEans[ean] = []; duplicateEans[ean].push(rn); }
      // Name+EAN tracking (Stufe 2: identical name+EAN = malus)
      if (name && ean) { const k = `${name}|||${ean}`; if (!duplicateNameEans[k]) duplicateNameEans[k] = []; duplicateNameEans[k].push(rn); }

      if (pflichtOk) { pflichtOkCount++; } else { pflichtErrorRowNums.add(rn); }
      totalOptionalFieldsPresent += optionalFieldsPresent;
    });

    // Stufe 1: Check for mixed units (mm/cm) within individual dimension columns
    const UNIT_EXTRACT_RE = /\b\d+(?:[.,]\d+)?\s*(mm|cm)\b/gi;
    const mixedUnitErrors = [];
    for (const key of ["size", "size_height", "size_depth", "size_diameter"]) {
      const col = mcMapping[key];
      if (!col) continue;
      const unitsFound = new Set();
      for (const r of rows) {
        UNIT_EXTRACT_RE.lastIndex = 0;
        let m;
        while ((m = UNIT_EXTRACT_RE.exec(String(r[col] ?? ""))) !== null) unitsFound.add(m[1].toLowerCase());
        if (unitsFound.size > 1) break;
      }
      if (unitsFound.size > 1) mixedUnitErrors.push({ col, units: [...unitsFound] });
    }

    // Stufe 1: EAN duplicates are a hard gate error
    const dupEanCount = Object.values(duplicateEans).filter((r) => r.length > 1).reduce((s, r) => s + r.length, 0);
    const eanDupRows = new Set(Object.values(duplicateEans).filter((r) => r.length > 1).flat());
    // Stufe 1: live-fähig = no pflicht errors AND no EAN duplicate
    const livefaehigCount = rows.filter((_, i) => !pflichtErrorRowNums.has(i + 1) && !eanDupRows.has(i + 1)).length;

    // Stufe 2: name+EAN duplicate malus (same product listed twice)
    const dupNameEanCount = Object.values(duplicateNameEans).filter((r) => r.length > 1).reduce((s, r) => s + r.length, 0);

    // Categorise Stufe 1 errors by attribute group
    const PFLICHT_CAT = {
      ean: "informationen", brand: "informationen", category_path: "informationen",
      description: "informationen", name: "informationen", seller_offer_id: "informationen",
      color: "produktmerkmale", material: "produktmerkmale", size: "produktmerkmale",
      size_depth: "produktmerkmale", size_diameter: "produktmerkmale", size_height: "produktmerkmale",
      image_url: "medien",
      manufacturer_name: "hersteller", manufacturer_street: "hersteller", manufacturer_postcode: "hersteller",
      manufacturer_city: "hersteller", manufacturer_country: "hersteller", manufacturer_email: "hersteller",
      availability: "preis", delivery_time: "preis", delivery_includes: "preis", price: "preis", stock_amount: "preis",
      shipping_mode: "versand",
    };
    const catRows = { informationen: new Set(), produktmerkmale: new Set(), medien: new Set(), hersteller: new Set(), preis: new Set(), versand: new Set() };
    pflichtErrors.forEach((e) => { const c = PFLICHT_CAT[e.field]; if (c) catRows[c].add(e.row); });
    eanDupRows.forEach((rn) => catRows.informationen.add(rn));
    const pflichtCategoryErrors = Object.fromEntries(Object.entries(catRows).map(([k, s]) => [k, s.size]));

    // Scoring (Stufe 2) – Pflichtfelder-Score (max. 70) + Empfohlene-Felder-Score (max. 30)
    const pflichtScore = rows.length ? Math.round((pflichtOkCount / rows.length) * 70) : 0;
    const optionalFillRatio = rows.length && optionalFieldCount > 0 ? (totalOptionalFieldsPresent / (rows.length * optionalFieldCount)) : 0;
    const optionalScore = Math.round(optionalFillRatio * 30);
    const totalScore = Math.max(0, Math.min(100, pflichtScore + optionalScore));

    return {
      totalRows: rows.length,
      pflichtMapping: MC_PFLICHT_COLS.reduce((m, k) => { m[k] = k === "image_url" ? (mcImageColumns[0] || null) : (mcMapping[k] || null); return m; }, {}),
      optionalMapping: MC_OPTIONAL_COLS.reduce((m, k) => { m[k] = mcMapping[k] || null; return m; }, {}),
      imageColumns: mcImageColumns,
      missingPflichtCols, missingOptionalCols,
      pflichtErrors, optionalHints,
      pflichtOkCount, livefaehigCount, blockiertCount: rows.length - livefaehigCount,
      totalOptionalFieldsPresent, optionalFieldCount,
      dupEanCount, dupNameEanCount,
      pflichtCategoryErrors,
      mixedUnitErrors,
      pflichtScore, optionalScore, optionalFillRatio, totalScore,
    };
  }, [rows, headers, mcMapping, mcImageColumns]);

  const mcIsWrongFile = rows.length > 0 && Object.values(mcMapping).filter(Boolean).length === 0 && mcImageColumns.length === 0;

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", margin: "0 0 12px 0" }}>Ihr Angebotsfeed</h2>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* ── LEFT: Upload & Settings ── */}
      <div style={{ flex: "0 1 50%", minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
        {/* Upload Method Toggle */}
        <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", marginBottom: 10 }}>Wie möchten Sie Ihren Feed übermitteln?</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid #E5E7EB", borderRadius: 6, overflow: "hidden" }}>
            <button onClick={() => setUploadMethod("server")}
              style={{ padding: "8px 0", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: uploadMethod === "server" ? MC_BLUE : "#FFF", color: uploadMethod === "server" ? "#FFF" : "#374151", borderRight: "1px solid #E5E7EB" }}>
              Eigener Server
            </button>
            <button onClick={() => setUploadMethod("upload")}
              style={{ padding: "8px 0", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", background: uploadMethod === "upload" ? MC_BLUE : "#FFF", color: uploadMethod === "upload" ? "#FFF" : "#374151" }}>
              Bei CHECK24 hochladen
            </button>
          </div>

          {uploadMethod === "server" && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {[
                { label: "FTP-Link", value: "ftp://partner31679@partnerftp.shopping.check24.de:44021/inbound/offerfeed_MeinShop.csv", mono: true },
                { label: "Benutzer", value: "partner31679", copy: true },
                { label: "Passwort", value: "••••••••", copy: true },
              ].map((r) => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", width: 60, flexShrink: 0 }}>{r.label}</span>
                  <div style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB", fontSize: 11, color: "#111827", fontFamily: r.mono ? "monospace" : "inherit", wordBreak: "break-all" }}>
                    {r.value} {r.copy && <span style={{ cursor: "pointer", color: "#9CA3AF" }}>⧉</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {uploadMethod === "upload" && (
            <div style={{ marginTop: 12 }}>
              {file && <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB", fontSize: 11, color: "#111827" }}>{file.name} | {(file.size / 1024).toFixed(1)} KB</div>}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) parseFile(f); }}
                onClick={() => fileRef.current?.click()}
                style={{ background: dragging ? "#EEF4FF" : "#F9FAFB", border: `2px dashed ${dragging ? MC_BLUE : "#D1D5DB"}`, borderRadius: 8, padding: "20px 16px", textAlign: "center", cursor: "pointer" }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 2 }}>Datei hierher ziehen oder anklicken</div>
                <div style={{ fontSize: 10, color: "#6B7280" }}>CSV, max. 64 MB</div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => parseFile(e.target.files?.[0] || null)} />
              </div>
            </div>
          )}
        </div>

        {/* Workflow hint */}
        {issues && (
          <div style={{ background: "#EEF4FF", borderLeft: `3px solid ${MC_BLUE}`, borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: MC_BLUE, marginBottom: 4 }}>So verbessern Sie Ihren Feed</div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: "17px" }}>
              1. Fehlerliste herunterladen<br />
              2. Fehler in Ihrer Datei korrigieren<br />
              3. Korrigierte Datei neu hochladen<br />
              4. Erneut prüfen lassen
            </div>
          </div>
        )}

        {/* Feed Settings */}
        <details style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8 }}>
          <summary style={{ padding: "12px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#111827" }}>
            Feed-Einstellungen
          </summary>
          <div style={{ padding: "0 16px 16px", display: "grid", gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>Format</div>
              <select value={feedFormat} onChange={(e) => setFeedFormat(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, color: "#111827", background: "#FFF", cursor: "pointer" }}>
                <option value="CSV">CSV</option>
                <option value="CSV (UTF-8)">CSV (UTF-8)</option>
                <option value="CSV (Windows-1252)">CSV (Windows-1252)</option>
                <option value="TSV">TSV (Tab-getrennt)</option>
                <option value="TXT">TXT</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>Trennzeichen</div>
              <select value={feedDelimiter} onChange={(e) => setFeedDelimiter(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, color: "#111827", background: "#FFF", cursor: "pointer" }}>
                <option value="semicolon">Semikolon ( ; )</option>
                <option value="comma">Komma ( , )</option>
                <option value="tab">Tab</option>
                <option value="pipe">Pipe ( | )</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 4 }}>Umschließungszeichen (optional)</div>
              <input value={feedQuoteChar} onChange={(e) => setFeedQuoteChar(e.target.value)} placeholder="z.B. &quot;"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E5E7EB", fontSize: 12, color: "#111827", boxSizing: "border-box" }} />
            </div>
          </div>
        </details>

        {/* Spalten-Zuordnung */}
        {issues && !mcIsWrongFile && (() => {
          const LEFT_FL = {
            name: "Artikelname", description: "Beschreibung", brand: "Marke",
            category_path: "Kategoriepfad", seller_offer_id: "Eigene Artikel-ID",
            ean: "EAN (GTIN14)", price: "Preis", availability: "Verfügbarkeit",
            stock_amount: "Bestand", delivery_time: "Lieferzeit",
            delivery_includes: "Lieferumfang", shipping_mode: "Versandart",
            image_url: "Hauptbild", color: "Farbe", material: "Material",
            size: "Maße (Gesamt)", size_height: "Höhe", size_depth: "Tiefe",
            size_diameter: "Durchmesser", manufacturer_name: "Herstellername",
            manufacturer_street: "Herstellerstraße", manufacturer_postcode: "Herstellerpostleitzahl",
            manufacturer_city: "Herstellerstadt", manufacturer_country: "Herstellerland",
            manufacturer_email: "Hersteller-E-Mail",
            deeplink: "Deeplink", model: "Modellbezeichnung",
            size_lying_surface: "Liegefläche", size_seat_height: "Sitzhöhe",
            ausrichtung: "Ausrichtung", style: "Stil", temper: "Härtegrad",
            weight: "Gewicht", weight_capacity: "Belastbarkeit",
            youtube_link: "Youtube-Video", bild_3d_glb: "3D-Ansicht (GLB)", bild_3d_usdz: "3D-Ansicht (USDZ)",
            assembly_instructions: "Montageanleitung",
            illuminant_included: "Leuchtmittel inklusive", incl_mattress: "Matratze inklusive",
            incl_slatted_frame: "Lattenrost inklusive", led_verbaut: "LED verbaut",
            lighting_included: "Beleuchtung inklusive", set_includes: "Set-Inhalt", socket: "Steckdose/Anschluss",
            care_instructions: "Pflegehinweise", filling: "Füllung",
            removable_cover: "Bezug abnehmbar", suitable_for_allergic: "Allergikergeeignet",
            energy_efficiency_category: "Energieeffizienzklasse", product_data_sheet: "Produktdatenblatt",
            manufacturer_phone_number: "Herstellertelefonnummer",
          };
          const allMcFields = [...MC_PFLICHT_COLS.filter((f) => f !== "image_url"), ...MC_OPTIONAL_COLS];
          const totalFields = allMcFields.length + 1;
          const foundFields = allMcFields.filter((f) => mcMapping[f]).length + (mcImageColumns.length > 0 ? 1 : 0);
          const hasMissing = issues.missingPflichtCols.length > 0;
          return (
            <details
              style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8 }}
              open={mappingExpanded}
              onToggle={(e) => setMappingExpanded(e.currentTarget.open)}
            >
              <summary style={{ padding: "12px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#111827" }}>
                Spalten-Zuordnung <span style={{ color: "#6B7280", fontWeight: 400, fontSize: 11 }}>({foundFields}/{totalFields} erkannt)</span>
                {hasMissing && <span style={{ marginLeft: 8, fontSize: 10, color: "#B91C1C", fontWeight: 700 }}>· {issues.missingPflichtCols.length} Pflichtspalten fehlen</span>}
              </summary>
              <div style={{ padding: "0 16px 16px", display: "grid", gap: 4 }}>
                {/* Hauptbild-Zuordnung (separat, nicht konfigurierbar – kommt aus Spaltenerkennung) */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#374151", width: 150, flexShrink: 0 }}>Hauptbild (+ Zusatzb.)</span>
                  <div style={{ flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 5, border: `1px solid ${mcImageColumns.length > 0 ? "#D1D5DB" : "#FCA5A5"}`, background: "#F9FAFB", color: mcImageColumns.length > 0 ? "#166534" : "#DC2626", fontWeight: 600 }}>
                    {mcImageColumns.length > 0 ? mcImageColumns.join(", ") : "–"}
                  </div>
                </div>
                {(() => {
                  const manufacturerPflichtEnd = allMcFields.indexOf("manufacturer_email");
                  const displayFields = [
                    ...allMcFields.slice(0, manufacturerPflichtEnd + 1),
                    "manufacturer_phone_number",
                    ...allMcFields.filter((f) => f !== "manufacturer_phone_number" && allMcFields.indexOf(f) > manufacturerPflichtEnd),
                  ].filter((f) => mcMapping[f] || MC_PFLICHT_COLS.includes(f));
                  const hiddenCount = allMcFields.filter((f) => !mcMapping[f] && !MC_PFLICHT_COLS.includes(f) && f !== "manufacturer_phone_number").length;
                  return (
                    <>
                      {displayFields.map((f) => {
                        const isManual = f in manualMapping;
                        const col = mcMapping[f];
                        const isPflicht = MC_PFLICHT_COLS.includes(f);
                        const missing = !col && isPflicht;
                        return (
                          <div key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, color: "#374151", width: 150, flexShrink: 0 }}>{LEFT_FL[f] || f}{isPflicht && <span style={{ color: "#DC2626", marginLeft: 2 }}>*</span>}</span>
                            <select
                              value={col || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualMapping((prev) => { const next = { ...prev }; if (val === "") delete next[f]; else next[f] = val; return next; });
                              }}
                              style={{ flex: 1, fontSize: 10, padding: "3px 6px", borderRadius: 5, border: `1px solid ${missing ? "#FCA5A5" : "#D1D5DB"}`, background: "#FFF", cursor: "pointer" }}
                            >
                              <option value="">-- Nicht zugeordnet --</option>
                              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                            {isManual && (
                              <button type="button" onClick={() => setManualMapping((prev) => { const next = { ...prev }; delete next[f]; return next; })}
                                style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #C4B5FD", background: "#FFF", color: "#7C3AED", cursor: "pointer" }}>↩</button>
                            )}
                          </div>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>{hiddenCount} weitere optionale Felder nicht im Feed</div>
                      )}
                    </>
                  );
                })()}
              </div>
            </details>
          );
        })()}

        {/* Content Tips */}
        <details style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8 }}>
          <summary style={{ padding: "12px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#111827" }}>
            Tipps für besseren Content
          </summary>
          <div style={{ padding: "0 16px 16px", display: "grid", gap: 8 }}>
            {[
              { title: "Produkttitel", desc: "Mind. 40 Zeichen. Marke + Produkttyp + Merkmal." },
              { title: "Beschreibung", desc: "Mind. 80 Zeichen. Vorteile, Material, Einsatzbereich. Keine externen Links." },
              { title: "Bilder", desc: "Mind. 3 pro Produkt. Erstes Bild als Freisteller, dazu Milieu-Bilder." },
              { title: "Lieferumfang", desc: "Format: 1x Tisch, 4x Stuhl. Versandart nicht vergessen." },
            ].map((t) => (
              <div key={t.title} style={{ padding: "6px 0", borderBottom: "1px solid #F3F4F6" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{t.title}</div>
                <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </details>

        {/* Downloads */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={() => window.open("http://media-partner.moebel.check24.de/feedvorlagen/Feedleitfaden_Anhang_2026/CHECK24_Feedvorlage_V2025.xlsx", "_blank", "noopener,noreferrer")}
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #A7F3D0", background: "#ECFDF5", cursor: "pointer", textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#065F46" }}>Feedvorlage</div>
            <div style={{ fontSize: 10, color: "#059669", marginTop: 2 }}>Excel-Vorlage</div>
          </button>
          <button type="button" onClick={() => window.open("http://media-partner.moebel.check24.de/feedvorlagen/Feedleitfaden_Anhang_2026/CHECK24_Feedleitfaden_2025.pdf", "_blank", "noopener,noreferrer")}
            style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #BFDBFE", background: "#EFF6FF", cursor: "pointer", textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#1E3A8A" }}>Feedleitfaden</div>
            <div style={{ fontSize: 10, color: "#2563EB", marginTop: 2 }}>PDF-Anleitung</div>
          </button>
        </div>
      </div>

      {/* ── RIGHT: Analysis Results ── */}
      {mcIsWrongFile && (
        <div style={{ flex: "0 1 50%", minWidth: 0, alignSelf: "start", padding: "16px 18px", borderRadius: 10, border: "1px solid #FECACA", background: "#FEF2F2", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C", marginBottom: 4 }}>Diese Datei sieht nicht wie ein gültiger Produkt-Feed aus.</div>
            <div style={{ fontSize: 11, color: "#7F1D1D", lineHeight: "1.6" }}>
              Es konnten keine bekannten Spalten erkannt werden. Bitte laden Sie eine andere Datei hoch.
              Erwartete Spalten sind z.&nbsp;B. <code>ean</code>, <code>name</code>, <code>price</code>, <code>shipping_mode</code> o.&nbsp;ä.
            </div>
          </div>
        </div>
      )}
      {issues && !mcIsWrongFile && (() => {
        // ── Gesamt-Pass/Fail-Logik ──
        // Technische Prüfung bestanden = Fehlerquote ≤ 5% (gleicher Schwellwert wie APA)
        const errorRate = issues.totalRows > 0 ? (issues.blockiertCount / issues.totalRows) * 100 : 0;
        const stufe1Passed = errorRate <= 5;
        const score = issues.totalScore;
        const campaignEligible = stufe1Passed && score >= 70;
        const fillPct = Math.round(issues.optionalFillRatio * 100);

        // Deutsche Feld-Labels (sortiert nach Wichtigkeit)
        const FL = {
          name: "Artikelname", description: "Beschreibung", brand: "Marke",
          category_path: "Kategoriepfad", seller_offer_id: "Eigene Artikel-ID",
          ean: "EAN (GTIN14)", price: "Preis", availability: "Verfügbarkeit",
          stock_amount: "Bestand", delivery_time: "Lieferzeit",
          delivery_includes: "Lieferumfang", shipping_mode: "Versandart",
          image_url: "Hauptbild", color: "Farbe", material: "Material",
          size: "Maße (Gesamt)", size_height: "Höhe", size_depth: "Tiefe",
          size_diameter: "Durchmesser", manufacturer_name: "Herstellername",
          manufacturer_street: "Herstellerstraße", manufacturer_postcode: "Herstellerpostleitzahl",
          manufacturer_city: "Herstellerstadt", manufacturer_country: "Herstellerland",
          manufacturer_email: "Hersteller-E-Mail",
        };

        // Top-Fehlergruppen berechnen (für Fehlerfall oben im Pflichtattribute-Block)
        const rowsByGroup = { desc: new Set(), size: new Set(), mfr: new Set(), img: new Set(), price: new Set(), ids: new Set() };
        issues.pflichtErrors.forEach((e) => {
          if (e.field === "description") rowsByGroup.desc.add(e.row);
          else if (["size", "size_height", "size_depth", "size_diameter"].includes(e.field)) rowsByGroup.size.add(e.row);
          else if (e.field.startsWith("manufacturer_")) rowsByGroup.mfr.add(e.row);
          else if (e.field === "image_url") rowsByGroup.img.add(e.row);
          else if (["price", "availability", "stock_amount", "delivery_time", "delivery_includes", "shipping_mode"].includes(e.field)) rowsByGroup.price.add(e.row);
          else if (["name", "brand", "category_path", "seller_offer_id", "ean"].includes(e.field)) rowsByGroup.ids.add(e.row);
        });
        const topGroups = [
          { key: "desc", label: "Beschreibung", hint: "Fehlt oder leer", count: rowsByGroup.desc.size },
          { key: "size", label: "Maße / Höhe / Tiefe", hint: "Unvollständig", count: rowsByGroup.size.size },
          { key: "mfr", label: "Herstellerangaben", hint: "Name, Adresse oder E-Mail fehlt", count: rowsByGroup.mfr.size },
          { key: "img", label: "Hauptbild", hint: "Fehlt oder nicht erreichbar", count: rowsByGroup.img.size },
          { key: "price", label: "Preis & Verfügbarkeit", hint: "Unvollständig", count: rowsByGroup.price.size },
          { key: "ids", label: "Identifikation", hint: "Name, Marke oder EAN fehlen", count: rowsByGroup.ids.size },
        ].filter((g) => g.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);

        return (
        <div style={{ flex: "0 1 50%", minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>

          {/* ── STUFE 1 – TECHNISCHE PRÜFUNG ── */}
          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
            {/* Partner-Status-Banner (eigener innerer Kasten) */}
            <div style={{
              margin: "12px 18px 0",
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${stufe1Passed ? "#BBF7D0" : "#FECACA"}`,
              background: stufe1Passed ? "#F0FDF4" : "#FEF2F2",
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <div style={{ fontSize: 12, color: "#111827", lineHeight: "1.5" }}>
                <strong style={{ color: stufe1Passed ? "#166534" : "#991B1B" }}>
                  {stufe1Passed ? "Account freigeschaltet." : "Account nicht aktivierbar."}
                </strong>{" "}
                {stufe1Passed
                  ? "Die technische Prüfung wurde bestanden. Ihre Artikel werden angelegt."
                  : "Bitte beheben Sie die Fehler und laden Sie den Feed erneut hoch."}
              </div>
            </div>

            {/* Sektion-Label + Status-Pille */}
            <div style={{ padding: "14px 18px 8px", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MC_BLUE, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap" }}>STUFE 1 — TECHNISCHE PRÜFUNG</span>
                <span style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
              </div>
              {stufe1Passed
                ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#DCFCE7", color: "#16A34A", whiteSpace: "nowrap" }}>✓ Bestanden</span>
                : <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#FEE2E2", color: "#DC2626", whiteSpace: "nowrap" }}>✗ Nicht bestanden</span>}
            </div>

            {/* Titel */}
            <div style={{ padding: "0 18px 14px" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Datenvalidierung</div>
            </div>

            {/* Pflichtattribute-Block */}
            <div style={{ margin: "0 18px 14px", borderRadius: 8, borderLeft: `4px solid ${stufe1Passed ? "#16A34A" : "#DC2626"}`, background: stufe1Passed ? "#F0FDF4" : "#FEF2F2", padding: "10px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Pflichtattribute (25 Attribute)</div>

              {/* Top 3 Fehlergruppen – nur wenn nicht bestanden */}
              {!stufe1Passed && topGroups.length > 0 && (
                <div style={{ display: "grid", gap: 5, marginBottom: 8 }}>
                  {topGroups.map((g) => (
                    <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#374151" }}>
                      <span style={{ width: 44, padding: "2px 0", borderRadius: 4, background: "#DC2626", color: "#FFF", fontWeight: 700, textAlign: "center", fontSize: 10, flexShrink: 0 }}>{g.count}</span>
                      <span style={{ fontWeight: 700, color: "#111827" }}>{g.label}</span>
                      <span style={{ color: "#6B7280", fontStyle: "italic" }}>— {g.hint}</span>
                    </div>
                  ))}
                </div>
              )}

              {issues.mixedUnitErrors?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {issues.mixedUnitErrors.map(({ col, units }) => (
                    <div key={col} style={{ fontSize: 11, padding: "5px 8px", borderRadius: 5, background: "#FEF9C3", border: "1px solid #FDE047", color: "#854D0E", marginBottom: 4 }}>
                      ⚠️ <strong>{col}</strong>: Gemischte Einheiten ({units.join(" + ")}) — bitte einheitlich {units[0] === "mm" ? "mm" : "cm"} verwenden
                    </div>
                  ))}
                </div>
              )}

              {issues.blockiertCount > 0 && (
                <div style={{ fontSize: 11, color: "#374151", marginBottom: 8, fontStyle: "italic" }}>
                  {issues.blockiertCount.toLocaleString("de-DE")} Artikel mit fehlenden Pflichtfeldern werden nicht gelistet.
                </div>
              )}

              {/* Pflichtattribute-Dropdown mit allen 25 Feldnamen */}
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 11, color: "#4B5563", fontWeight: 600, userSelect: "none" }}>Pflichtattribute anzeigen</summary>
                <div style={{ marginTop: 6, fontSize: 10, color: "#9CA3AF", lineHeight: "1.6", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {MC_PFLICHT_COLS.map((f, i) => (
                    <React.Fragment key={f}>
                      {i > 0 && <span style={{ margin: "0 4px" }}>·</span>}
                      {FL[f]}
                    </React.Fragment>
                  ))}
                </div>
              </details>
            </div>

            {/* Stats: Vollständig | Unvollständig | Gesamt (kompakt, mit Tooltips) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "0 18px 10px" }}>
              {[
                {
                  val: issues.pflichtOkCount, label: "Vollständig", color: "#16A34A",
                  tip: "Artikel, bei denen alle 25 Pflichtattribute befüllt und gültig sind. Diese Artikel werden bei CHECK24 angelegt.",
                },
                {
                  val: issues.blockiertCount, label: "Unvollständig", color: "#DC2626",
                  tip: "Artikel mit mindestens einem fehlenden oder ungültigen Pflichtattribut. Diese Artikel werden nicht gelistet, bis die Fehler behoben sind.",
                },
                {
                  val: issues.totalRows, label: "Gesamt", color: "#111827",
                  tip: "Gesamtzahl der Artikel in Ihrem hochgeladenen Feed.",
                },
              ].map(({ val, label, color, tip }) => (
                <div key={label} style={{ padding: "6px 4px", borderRadius: 5, border: "1px solid #E5E7EB", background: "#FFF", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{val.toLocaleString("de-DE")}</div>
                  <Tooltip text={tip}>
                    <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 3, cursor: "help" }}>
                      {label}
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="1.5"><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="8"/><circle cx="8" cy="11" r=".6" fill="#9CA3AF"/></svg>
                    </div>
                  </Tooltip>
                </div>
              ))}
            </div>

          </div>

          {/* ── CSV DOWNLOAD (highlighted primary action) ── */}
          <div style={{ padding: "14px 16px", borderRadius: 10, border: `2px solid ${MC_BLUE}`, background: "#EEF4FF", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px rgba(21, 83, 182, 0.12)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Fehlerbericht herunterladen</div>
            </div>
            <button
              type="button"
              onClick={() => {
                const pflichtByRow = {}, optionalByRow = {};
                issues.pflichtErrors.forEach((e) => { if (!pflichtByRow[e.row]) pflichtByRow[e.row] = []; const msg = e.type === "invalid_currency" ? `${e.field} enthält Währungssymbol` : e.type === "invalid" ? `${e.field} ungültig` : `${e.field} fehlt`; pflichtByRow[e.row].push(msg); });
                issues.optionalHints.forEach((e) => { if (!optionalByRow[e.row]) optionalByRow[e.row] = []; optionalByRow[e.row].push(e.field + " fehlt"); });
                const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
                const sep = ";";
                const headerRow = ["Fehler Pflichtfelder", "Fehler Optionale Felder", ...headers].map(esc).join(sep);
                const lines = rows.map((r, i) => {
                  const rn = i + 1;
                  const p = pflichtByRow[rn] ? [...new Set(pflichtByRow[rn])].join("; ") : "";
                  const o = optionalByRow[rn] ? [...new Set(optionalByRow[rn])].join("; ") : "";
                  return [esc(p), esc(o), ...headers.map((h) => esc(r[h]))].join(sep);
                });
                const csv = [headerRow, ...lines].join("\n");
                const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `feed-fehlerliste-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              style={{ padding: "10px 18px", borderRadius: 6, border: "none", background: MC_BLUE, color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              CSV herunterladen
            </button>
          </div>

          {/* ── STUFE 2 – FEED-QUALITÄTSSCORE (Soft Score) ── */}
          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", position: "relative" }}>

            <div style={{ opacity: stufe1Passed ? 1 : 0.55 }}>

              {/* Sektion-Label */}
              <div style={{ padding: "14px 18px 8px", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: MC_BLUE, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ whiteSpace: "nowrap" }}>STUFE 2 — FEED-QUALITÄTSSCORE</span>
                  <span style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
                </div>
                {score >= 70
                  ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#DCFCE7", color: "#16A34A", whiteSpace: "nowrap" }}>✓ Zielwert erreicht</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#FEE2E2", color: "#DC2626", whiteSpace: "nowrap" }}>✗ Zielwert nicht erreicht</span>}
              </div>

              {/* Score */}
              <div style={{ padding: "0 18px 10px", display: "flex", justifyContent: "flex-start", alignItems: "flex-end" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: campaignEligible ? "#16A34A" : "#111827", lineHeight: 1 }}>
                  {score}<span style={{ fontWeight: 600, color: "#9CA3AF" }}>/100</span>
                </div>
              </div>

              {/* Fortschrittsbalken mit 70-Marker */}
              <div style={{ padding: "0 18px 4px" }}>
                <div style={{ position: "relative", paddingTop: 34 }}>
                  {/* 70-Marker Pille */}
                  <div style={{ position: "absolute", top: 0, left: "70%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: campaignEligible ? "#166534" : "#4B5563", whiteSpace: "nowrap", padding: "1px 5px", borderRadius: 3, background: campaignEligible ? "#DCFCE7" : "#F3F4F6", border: `1px solid ${campaignEligible ? "#86EFAC" : "#E5E7EB"}` }}>Zielwert erreicht</div>
                    <div style={{ width: 1, height: 14, background: campaignEligible ? "#16A34A" : "#9CA3AF" }} />
                  </div>
                  {/* Balken */}
                  <div style={{ height: 16, borderRadius: 8, background: "#E5E7EB", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${score}%`, background: campaignEligible ? "#16A34A" : score >= 50 ? "#D97706" : "#DC2626", transition: "width 0.4s" }} />
                  </div>
                  {/* Notch an 70% */}
                  <div style={{ position: "absolute", top: 34, left: "70%", transform: "translateX(-50%)", width: 2, height: 16, background: campaignEligible ? "#16A34A" : "#6B7280", pointerEvents: "none" }} />
                  <div style={{ display: "flex", fontSize: 9, color: "#9CA3AF", marginTop: 3, position: "relative" }}>
                    <span>0</span>
                    <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>50</span>
                    <span style={{ position: "absolute", left: "70%", transform: "translateX(-50%)", color: campaignEligible ? "#16A34A" : "#4B5563", fontWeight: 700 }}>70</span>
                    <span style={{ marginLeft: "auto" }}>100</span>
                  </div>
                </div>
              </div>

              {/* Scoring-Logik – als Dropdown, geschlossen (direkt unter Progress-Bar) */}
              <details style={{ padding: "0 18px", marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 11, color: "#4B5563", fontWeight: 600, userSelect: "none", padding: "6px 0" }}>Scoring-Logik anzeigen</summary>

                <div style={{ marginTop: 4, padding: "7px 12px", borderRadius: 6, background: "#F9FAFB", border: "1px solid #E5E7EB", fontSize: 11, fontFamily: "monospace", color: "#374151", marginBottom: 10 }}>
                  Score = Pflichtfelder-Score + Empfohlene-Felder-Score
                </div>

                {/* Pflichtfelder-Score */}
                <div style={{ padding: "10px 12px", borderRadius: 6, borderLeft: "3px solid #3B82F6", background: "#EFF6FF", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Pflichtfelder-Score (max. 70 Pkt.)</div>
                  <div style={{ fontSize: 11, color: "#374151", marginBottom: 4 }}>
                    {issues.pflichtOkCount.toLocaleString("de-DE")} von {issues.totalRows.toLocaleString("de-DE")} Artikeln mit vollständigen Pflichtattributen.
                  </div>
                  <div style={{ fontSize: 11, color: "#111827", fontWeight: 600 }}>
                    → <strong>{issues.pflichtOkCount.toLocaleString("de-DE")}/{issues.totalRows.toLocaleString("de-DE")} × 70 = {issues.pflichtScore}/70 Punkte</strong>
                  </div>
                </div>

                {/* Empfohlene Felder */}
                <div style={{ padding: "10px 12px", borderRadius: 6, borderLeft: "3px solid #EAB308", background: "#FEFCE8", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Empfohlene Felder (max. 30 Pkt.)</div>
                  <div style={{ fontSize: 11, color: "#374151", marginBottom: 4 }}>
                    Durchschnittlich {fillPct}% der empfohlenen Felder je Artikel befüllt.
                  </div>
                  <div style={{ fontSize: 11, color: "#111827", fontWeight: 600, marginBottom: 8 }}>
                    → <strong>{issues.optionalFillRatio.toFixed(2)} × 30 = {issues.optionalScore}/30 Punkte</strong>
                  </div>
                  <div style={{ fontSize: 10, color: "#6B7280", lineHeight: "1.6" }}>
                    <div><strong style={{ color: "#374151" }}>Produktinfos:</strong> Deeplink · Modellbezeichnung</div>
                    <div><strong style={{ color: "#374151" }}>Produktmerkmale:</strong> Stil · Gewicht · Belastbarkeit · Sitzhöhe · Liegefläche · Ausrichtung · Härtegrad</div>
                    <div><strong style={{ color: "#374151" }}>Bilder & Medien:</strong> Zusatzbilder (2–10) · Youtube-Video · 3D-Ansicht (GLB/USDZ) · Montageanleitung</div>
                    <div><strong style={{ color: "#374151" }}>Ausstattung:</strong> Set-Inhalt · Leuchtmittel inklusive · Matratze inklusive · Lattenrost inklusive · LED verbaut · Beleuchtung inklusive · Steckdose/Anschluss</div>
                    <div><strong style={{ color: "#374151" }}>Textilien:</strong> Pflegehinweise · Füllung · Bezug abnehmbar · Allergikergeeignet</div>
                    <div><strong style={{ color: "#374151" }}>Nachweise:</strong> Energieeffizienzklasse · Produktdatenblatt</div>
                    <div><strong style={{ color: "#374151" }}>Hersteller:</strong> Telefonnummer</div>
                  </div>
                </div>

                {/* Gesamt */}
                <div style={{ padding: "10px 14px", borderRadius: 6, border: `1px solid ${campaignEligible ? "#86EFAC" : "#E5E7EB"}`, background: campaignEligible ? "#F0FDF4" : "#F9FAFB", textAlign: "center", fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
                  Gesamt: {issues.pflichtScore} + {issues.optionalScore} = {score}/100 → {campaignEligible ? "Kampagnen-berechtigt ✓" : "Nicht kampagnen-berechtigt"}
                </div>
              </details>

              {/* Kampagnen-Karte */}
              <div style={{ margin: "10px 18px 0", borderRadius: 8, border: `1px solid ${campaignEligible ? "#86EFAC" : "#FECACA"}`, background: campaignEligible ? "#F0FDF4" : "#FEF2F2", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: campaignEligible ? "#16A34A" : "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                      {campaignEligible ? "✓" : "!"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>Kampagnen-Teilnahme</div>
                  </div>
                  <details style={{ marginTop: 5 }}>
                    <summary style={{ cursor: "pointer", fontSize: 10, color: "#4B5563", fontWeight: 600, userSelect: "none" }}>Alle Kampagnen-Kriterien anzeigen</summary>
                    <div style={{ fontSize: 10, color: "#374151", marginTop: 4 }}>
                      Ab <strong>70/100</strong> ist Ihr Feed für Kampagnen freigeschaltet. Zusätzlich müssen auch die weiteren Shop-KPIs erfüllt sein:
                    </div>
                    <ul style={{ margin: "3px 0 0 0", paddingLeft: 16, fontSize: 10, color: "#374151", lineHeight: "1.6", listStyleType: "disc", listStylePosition: "outside" }}>
                      <li style={{ display: "list-item" }}>Stornoquote ≤ 2,5 %</li>
                      <li style={{ display: "list-item" }}>Liefertermintreue ≥ 94 %</li>
                      <li style={{ display: "list-item" }}>Trackingquote ≥ 92 %</li>
                      <li style={{ display: "list-item" }}>Preisparität ≥ 95 %</li>
                    </ul>
                  </details>
                </div>
                <a
                  href={campaignEligible ? "http://mc.moebel.check24.de/campaigns" : undefined}
                  target={campaignEligible ? "_blank" : undefined}
                  rel={campaignEligible ? "noopener noreferrer" : undefined}
                  onClick={(e) => { if (!campaignEligible) e.preventDefault(); }}
                  aria-disabled={!campaignEligible}
                  style={{ padding: "10px 18px", borderRadius: 6, border: "none", background: campaignEligible ? "#16A34A" : "#D1D5DB", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: campaignEligible ? "pointer" : "not-allowed", whiteSpace: "nowrap", textDecoration: "none", flexShrink: 0, opacity: campaignEligible ? 1 : 0.7 }}
                >
                  Zum Deal-Tool →
                </a>
              </div>

              {/* APA-Karte */}
              <div style={{ margin: "10px 18px 14px", borderRadius: 8, border: `1px solid ${stufe1Passed ? "#86EFAC" : "#FECACA"}`, background: stufe1Passed ? "#F0FDF4" : "#FEF2F2", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: stufe1Passed ? "#16A34A" : "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                      {stufe1Passed ? "✓" : "!"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>APA (Automatische Produktanlage)</div>
                  </div>
                  <div style={{ fontSize: 10, color: "#374151", marginTop: 4 }}>
                    {stufe1Passed ? "✓" : "✗"} {stufe1Passed ? "Berechtigt für APA" : "Nicht berechtigt für APA"} · Fehlerquote: {errorRate.toFixed(1).replace(".", ",")}% (Max. 5%)
                  </div>
                  <div style={{ fontSize: 10, color: stufe1Passed ? "#166534" : "#991B1B", fontWeight: 600, marginTop: 2 }}>
                    {stufe1Passed ? "Ihre Artikel werden automatisch innerhalb von 2–3 Tagen angelegt." : "Ohne APA werden Artikel manuell angelegt. Das kann 1–3 Wochen dauern."}
                  </div>
                </div>
                <a
                  href={stufe1Passed ? ("mailto:partnerbetreuung@check24.de?subject=" + encodeURIComponent("APA-Freischaltung anfordern") + "&body=" + encodeURIComponent("Hallo CHECK24-Team,\n\nwir möchten die automatische Produktanlage (APA) für unseren Shop aktivieren. Unsere aktuelle Fehlerquote liegt bei " + errorRate.toFixed(1).replace(".", ",") + "% und damit innerhalb des Grenzwerts von 5%.\n\nBitte schalten Sie uns für APA frei.\n\nVielen Dank\nIhr Partner")) : undefined}
                  onClick={(e) => { if (!stufe1Passed) e.preventDefault(); }}
                  aria-disabled={!stufe1Passed}
                  style={{ padding: "10px 18px", borderRadius: 6, border: "none", background: stufe1Passed ? "#16A34A" : "#D1D5DB", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: stufe1Passed ? "pointer" : "not-allowed", whiteSpace: "nowrap", textDecoration: "none", flexShrink: 0, opacity: stufe1Passed ? 1 : 0.7 }}
                >
                  APA-Zugang per E-Mail anfordern
                </a>
              </div>
            </div>
          </div>

        </div>
        );
      })()}
    </div>
    </div>
  );
}

function McDashboard() {
  const kpis = [
    {
      label: "Stornoquote", value: "0,0", unit: "%", ziel: "≤ 2,5 %",
      color: "#16A34A", good: true,
      spark: [1.2, 0.8, 0.5, 0.3, 0.2, 0.0, 0.0, 0.0],
    },
    {
      label: "Liefertermintreue", value: "100,0", unit: "%", ziel: "≥ 94 %",
      color: "#1553B6", good: true,
      spark: [92, 95, 97, 99, 100, 100, 100, 100],
    },
    {
      label: "Trackingquote", value: "100,0", unit: "%", ziel: "≥ 92 %",
      color: "#1553B6", good: true,
      spark: [88, 91, 94, 97, 100, 100, 100, 100],
    },
    {
      label: "Preisparität", value: "98,3", unit: "%", ziel: "≥ 95 %",
      color: "#1553B6", good: true,
      spark: [94, 95, 96, 97, 97, 98, 98, 98.3],
    },
    {
      label: "Content Score", value: "74", unit: "/ 100", ziel: "≥ 70",
      color: "#D97706", good: false,
      spark: [60, 62, 65, 68, 70, 71, 73, 74],
      highlight: true,
      tooltip: "Der Content Score zeigt den Anteil fehlerfreier Zeilen in Ihrem Feed. Ab 70/100 kann der Feed freigeschaltet werden. Klicken Sie hier, um zur Analyse zu gelangen.",
    },
  ];

  const actions = [
    { icon: "🛒", label: "Neue Bestellungen akzeptieren", badge: null },
    { icon: "↩️", label: "Stornoanfragen prüfen", badge: 3 },
    { icon: "📦", label: "Rücksendeanfragen prüfen", badge: 217 },
    { icon: "🔧", label: "Ersatzteilanfragen prüfen", badge: 26 },
    { icon: "💳", label: "Zahlungen", badge: null },
  ];

  return (
    <div style={{ maxWidth: 860, display: "grid", gap: 28 }}>

      {/* KPI section */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 14 }}>
          Aktuelle Performance Ihres Shops (67AX)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {kpis.map((k) => (
            <div key={k.label}
              onClick={() => k.highlight ? setMcActiveNav("angebotsfeed") : null}
              style={{
                background: "#FFFFFF",
                border: k.highlight ? "1.5px solid #FCD34D" : "1px solid #E5E7EB",
                borderRadius: 8,
                padding: "14px 14px 10px",
                display: "flex", flexDirection: "column", gap: 2,
                boxShadow: k.highlight ? "0 0 0 3px rgba(251,191,36,0.12)" : "none",
                cursor: k.highlight ? "pointer" : "default",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>{k.label}</span>
                {k.highlight ? (
                  <span style={{ fontSize: 10, background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 999, fontWeight: 600 }}>NEU</span>
                ) : (
                  <Tooltip text={k.tooltip || ""}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="1.5" style={{ cursor: "help", flexShrink: 0 }}><circle cx="8" cy="8" r="7"/><line x1="8" y1="5" x2="8" y2="8"/><circle cx="8" cy="11" r=".6" fill="#9CA3AF"/></svg>
                  </Tooltip>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 4 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</span>
                <span style={{ fontSize: 13, color: k.color, fontWeight: 600 }}>{k.unit}</span>
                <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: "auto", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 600, display: "block", textAlign: "right", lineHeight: 1.1 }}>ZIELWERT</span>
                  {k.ziel}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <Sparkline values={k.spark} color={k.color} />
              </div>
              {k.highlight && (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: MC_BLUE, textDecoration: "underline" }}>Zur Analyse</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Kontostand & Auszahlungen */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 12 }}>
          Kontostand &amp; Auszahlungen
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { value: "188.136,56 €", label: "Umsatz aus versendeten Bestellungen\nin diesem Kalendermonat" },
            { value: "2.467", label: "Versendete Bestellungen\nin diesem Kalendermonat" },
            { value: "385.061,87 €", label: "Aktueller Kontostand" },
            { value: "13.04.2026", label: "Nächste Auszahlung" },
          ].map((c) => (
            <div key={c.label} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, padding: "18px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: "#111827" }}>{c.value}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4, whiteSpace: "pre-line", lineHeight: 1.5 }}>{c.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Action rows */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
        {actions.map((a, i) => (
          <div key={a.label} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "16px 20px",
            borderTop: i > 0 ? "1px solid #F3F4F6" : "none",
            cursor: "pointer",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontSize: 20 }}>{a.icon}</span>
              <span style={{ fontSize: 14, color: "#111827" }}>{a.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {a.badge ? (
                <span style={{ background: MC_BLUE, color: "#FFFFFF", fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 999, minWidth: 28, textAlign: "center" }}>
                  {a.badge}
                </span>
              ) : null}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <path d="M6 3l5 5-5 5"/>
              </svg>
            </div>
          </div>
        ))}
      </div>

      {/* Contact box */}
      <div style={{ background: "#F0F4FF", border: "1px solid #C7D8F8", borderRadius: 8, padding: "20px 28px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 10 }}>Haben Sie Fragen? Wir helfen gerne!</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#374151" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1553B6" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.22 1.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
            089 - 2424 1158 300
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#374151" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1553B6" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            partner-moebel@check24.de
          </div>
        </div>
      </div>

    </div>
  );
}

function CheckerMCPage() {
  const [mcActiveNav, setMcActiveNav] = useState("angebotsfeed");
  const [mcOpenGroups, setMcOpenGroups] = useState(new Set(["einstellungen"]));
  const toggleGroup = (id) => setMcOpenGroups((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "#F5F6FA" }}>

      {/* MC mock sub-header — matches the screenshot exactly */}
      <div style={{ background: "#1B3461", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#FFFFFF", fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", fontFamily: "Arial, sans-serif" }}>CHECK24</span>
          <span style={{ color: "#8AAFD4", fontSize: 14, fontWeight: 400 }}>Partnerportal</span>
        </div>
        {/* Right items */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#FFFFFF", fontSize: 13, cursor: "pointer" }}>
            <span style={{ fontSize: 16 }}>🇩🇪</span>
            <span>Deutsch</span>
            <span style={{ fontSize: 10, color: "#8AAFD4" }}>▾</span>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8AAFD4" strokeWidth="2" style={{ cursor: "pointer" }}>
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#FFFFFF", borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 28 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8AAFD4" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.22 1.18 2 2 0 012.22 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>089 - 2424 1158 300</div>
              <div style={{ color: "#8AAFD4", fontSize: 11 }}>Haben Sie Fragen?</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#FFFFFF", borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 28, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8AAFD4" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Termin buchen</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "#FFFFFF", borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 28, cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8AAFD4" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Daniel Haag</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* LEFT SIDEBAR — matches screenshot */}
        <div style={{ width: 200, background: "#FFFFFF", borderRight: "1px solid #E5E7EB", flexShrink: 0, paddingTop: 6, overflowY: "auto" }}>
          {MC_NAV_ITEMS.map((item) => {
            const isGroupOpen = item.children && mcOpenGroups.has(item.id);
            const isParentActive = item.children && item.children.some((c) => c.id === mcActiveNav);
            const isItemActive = !item.children && mcActiveNav === item.id;
            return (
              <div key={item.id}>
                <div
                  onClick={() => {
                    if (item.children) {
                      toggleGroup(item.id);
                    } else {
                      setMcActiveNav(item.id);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 11,
                    padding: "11px 18px",
                    cursor: "pointer",
                    fontSize: 14,
                    color: (isItemActive || isParentActive) ? MC_BLUE : "#374151",
                    fontWeight: (isItemActive || isParentActive) ? 600 : 400,
                    userSelect: "none",
                  }}
                >
                  <McIcon name={item.icon} active={isItemActive || isParentActive} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.children ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9CA3AF" strokeWidth="1.8"
                      style={{ transform: isGroupOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                      <path d="M2 4l4 4 4-4"/>
                    </svg>
                  ) : null}
                </div>
                {item.children && isGroupOpen ? (
                  <div style={{ background: "#F9FAFB", borderTop: "1px solid #F3F4F6", borderBottom: "1px solid #F3F4F6" }}>
                    {item.children.map((child) => {
                      const childActive = mcActiveNav === child.id;
                      return (
                        <div
                          key={child.id}
                          onClick={() => setMcActiveNav(child.id)}
                          style={{
                            padding: "9px 18px 9px 47px",
                            fontSize: 13,
                            cursor: "pointer",
                            color: childActive ? MC_BLUE : "#4B5563",
                            fontWeight: childActive ? 600 : 400,
                            borderLeft: childActive ? `3px solid ${MC_BLUE}` : "3px solid transparent",
                            background: childActive ? "#EEF3FC" : "transparent",
                          }}
                        >
                          {child.label}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, padding: "28px 36px", overflowY: "auto" }}>

          {/* ── DASHBOARD ── */}
          {mcActiveNav === "dashboard" ? (
            <McDashboard />
          ) : null}

          {/* ── ANGEBOTSFEED ── */}
          {mcActiveNav === "angebotsfeed" ? (
            <McAngebotsfeed />
          ) : null}

          {/* ── OTHER PAGES placeholder ── */}
          {mcActiveNav !== "dashboard" && mcActiveNav !== "angebotsfeed" ? (
            <div style={{ color: "#6B7280", fontSize: 14, marginTop: 40, textAlign: "center" }}>
              Diese Seite ist noch nicht verfügbar.
            </div>
          ) : null}
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: "#FFFFFF", borderTop: "1px solid #E5E7EB", padding: "14px 32px", display: "flex", justifyContent: "center", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
          {["News", "Karriere", "Presse", "Marktplatzpartner", "Affiliate-Programm", "Gutscheine", "Unternehmen", "Kontakt", "AGB", "Datenschutz", "Impressum"].map((l) => (
            <span key={l} style={{ fontSize: 12, color: MC_BLUE, cursor: "pointer" }}>{l}</span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#9CA3AF" }}>© 2026 CHECK24 Vergleichsportal Möbel GmbH.</div>
      </div>
    </div>
  );
}

function McIssueCard({ title, severity, description, items, more, fixInstruction, compactList }) {
  const [expanded, setExpanded] = useState(false);
  const isError = severity === "error";
  const accent = isError ? "#B91C1C" : "#92400E";
  const bg = isError ? "#FEF2F2" : "#FFFBEB";
  const border = isError ? "#FECACA" : "#FCD34D";
  const badgeBg = isError ? "#FEE2E2" : "#FEF3C7";
  const icon = isError ? "❌" : "⚠️";

  // For compactList cards the count badge in the header is enough — no need
  // to repeat it or list individual row numbers inside the expanded view.
  const totalCount = items.length + (more || 0);

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 8, border: "1px solid #E5E7EB", overflow: "hidden" }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 12px", cursor: "pointer", borderLeft: `4px solid ${accent}`,
          background: bg, borderBottom: expanded ? `1px solid ${border}` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>{title}</span>
          {totalCount > 0 && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: badgeBg, color: accent, fontWeight: 600, flexShrink: 0 }}>
              {totalCount} Artikel
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <div style={{ padding: "10px 12px" }}>
          {fixInstruction && (
            <p style={{ fontSize: 11, color: "#666", fontStyle: "italic", margin: "0 0 8px", padding: "6px 8px", background: "#F9FAFB", borderRadius: 4 }}>
              {fixInstruction}
            </p>
          )}
          {/* For compactList (row-error) cards, the CSV export has the exact row numbers.
              We only show item detail for structural issues (missing columns etc.). */}
          {!compactList && (
            <div style={{ display: "grid", gap: 5 }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, background: "#F9FAFB", border: "1px solid #F3F4F6" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#111827" }}>{item.label}</span>
                  {item.hint && <span style={{ fontSize: 10, color: "#6B7280" }}>{item.hint}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
    if (typeof window === "undefined") return "feed-analyse";
    const hash = window.location.hash;
    if (hash === "#/rules") return "rules";
    if (hash === "#/feed-analyse" || hash === "#/qs" || hash === "#/feed-checker" || hash === "#/checker") return "feed-analyse";
    if (hash === "#/analytics") return "analytics";
    if (hash === "#/checker-mc") return "checker-mc";
    if (hash === "#/ergebnistabelle") return "ergebnistabelle";
    return "feed-analyse";
  });
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [rules, setRules] = useState(DEFAULT_RULES);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesSaveError, setRulesSaveError] = useState("");
  const [rulesSavedAt, setRulesSavedAt] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const hash = window.location.hash;
      if (hash === "#/rules") setRoute("rules");
      else if (hash === "#/feed-analyse" || hash === "#/qs" || hash === "#/feed-checker" || hash === "#/checker") setRoute("feed-analyse");
      else if (hash === "#/analytics") setRoute("analytics");
      else if (hash === "#/checker-mc") setRoute("checker-mc");
      else if (hash === "#/ergebnistabelle") setRoute("ergebnistabelle");
      else setRoute("feed-analyse");
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
  const [parseWarnings, setParseWarnings] = useState([]);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef(null);
  const [feedDragging, setFeedDragging] = useState(false);

  const [shopName, setShopName] = useState("");
  const [eanSearch, setEanSearch] = useState("");
  const parseEanSearchTerms = (value) =>
    String(value ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  const eanSearchTerms = useMemo(() => parseEanSearchTerms(eanSearch), [eanSearch]);
  const [visibleColumns, setVisibleColumns] = useState(null);
  const [columnFilterOpen, setColumnFilterOpen] = useState(false);
  const [showIssueRowsOnly, setShowIssueRowsOnly] = useState(false);
  const eanSearchBeforeIssueOnlyRef = useRef("");
  const [activeStep, setActiveStep] = useState(1);
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [pageMode, setPageMode] = useState("feed-checker");
  const [generatedEmail, setGeneratedEmail] = useState(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailContent, setEmailContent] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [mcUnlocked, setMcUnlocked] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("mc_auth") === "1";
  });
  const [mcPasswordInput, setMcPasswordInput] = useState("");
  const [mcPasswordError, setMcPasswordError] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState(0);

  const [imageMin, setImageMin] = useState(DEFAULT_RULES.image_min_per_product);
  const [imageSampleLimitStep5, setImageSampleLimitStep5] = useState(5);
  const [brokenImageIds, setBrokenImageIds] = useState([]);
  const [eanImageViewerOpen, setEanImageViewerOpen] = useState(false);
  const [eanImageViewerInput, setEanImageViewerInput] = useState("");
  const [eanImageViewerEan, setEanImageViewerEan] = useState("");
  const [eanImageViewerUrls, setEanImageViewerUrls] = useState([]);
  const [eanImageViewerLimit, setEanImageViewerLimit] = useState(24);

  const previewColumns = useMemo(() => {
    if (!headers.length) return [];
    const all = headers.map((h) => ({ key: h, label: String(h) }));
    if (!Array.isArray(visibleColumns)) return all;
    const allowed = new Set(visibleColumns);
    return all.filter((c) => allowed.has(c.key));
  }, [headers, visibleColumns]);

  useEffect(() => {
    setImageMin(Number(rules?.image_min_per_product ?? DEFAULT_RULES.image_min_per_product));
  }, [rules]);

  const [optionalFields] = useState([
    "washable_cover",
    "mounting_side",
  ]);

  const [requiredFields] = useState([
    "ean",
    "seller_offer_id",
    "name",
    "price",
    "stock_amount",
    "delivery_time",
    "shipping_mode",
    "brand",
    "description",
    "category_path",
    "material",
    "color",
    "delivery_includes",
    "manufacturer_name",
    "size",
  ]);

  // Manual overrides set by the user in the mapping UI
  const [manualMapping, setManualMapping] = useState({});

  // Step 1: auto-detect columns by header name matching
  const autoMapping = useMemo(() => {
    if (!headers.length) return {};
    const candidates = {
      ean: ["ean", "gtin", "gtin14", "ean13", "barcode"],
      seller_offer_id: ["seller_offer_id", "seller offer id", "offer_id", "offer id", "sku", "merchant_sku", "eindeutige id", "eindeutige_id", "unique_id"],
      name: ["name", "product_name", "title", "produktname", "produkt titel"],
      category_path: ["category_path", "category", "kategorie", "kategoriepfad"],
      description: ["description", "beschreibung", "desc"],
      stock_amount: ["stock_amount", "stock", "bestand", "quantity", "qty", "availability", "verfügbarkeit", "verfuegbarkeit"],
      shipping_mode: ["shipping_mode", "versandart", "shipping_type", "shipping type", "delivery_mode", "lieferart", "versand_art", "shipment_mode", "transport_mode"],
      delivery_time: ["delivery_time", "lieferzeit", "lead_time", "lead time", "shippingtime", "shipping_time", "shipping time"],
      price: ["price", "preis", "amount"],
      brand: ["brand", "marke"],
      material: ["material", "materials"],
      color: ["color", "farbe"],
      delivery_includes: ["delivery_includes", "lieferumfang"],
      size: [
        "size", "abmessungen", "dimension", "dimensions", "maße", "masse",
        "size_height", "height", "höhe", "hoehe",
        "size_depth", "depth", "tiefe",
        "size_width", "width", "breite",
        "size_diameter", "diameter", "durchmesser",
      ],
      washable_cover: ["washable_cover", "waschbarer bezug", "waschbarer_bezug"],
      mounting_side: ["mounting_side", "montageseite", "montage_seite", "montageseitig"],
      hs_code: ["hs_code", "hs-code", "hs code", "zolltarifnummer", "warennummer"],
      manufacturer_name: ["manufacturer_name", "hersteller", "herstellername", "manufacturer"],
      manufacturer_country: ["manufacturer_country", "hersteller_land", "herstellerland", "country_of_origin", "ursprungsland"],
      energy_efficiency_label: [
        "energy_efficiency_label",
        "energieeffizienzlabel",
        "energieeffizienz_label",
        "energie label",
      ],
      lighting_included: ["lighting_included", "beleuchtung_enthalten", "inkl_beleuchtung", "beleuchtung"],
      eprel_registration_number: [
        "EPREL_registration_number",
        "eprel_registration_number",
        "eprel",
        "eprel_nr",
      ],
    };

    const m = {};
    for (const key of Object.keys(candidates)) {
      m[key] = bestHeaderMatch(headers, candidates[key]) || null;
    }
    return m;
  }, [headers]);

  // Step 2: content-based fallback – inspect first 10 rows for fields not found by name
  const contentMapping = useMemo(() => {
    if (!headers.length || !rawRows.length) return {};
    const allFields = [...requiredFields, ...optionalFields];
    const unmapped = allFields.filter((f) => !autoMapping[f]);
    if (!unmapped.length) return {};
    return detectFieldByContent(unmapped, headers, rawRows);
  }, [headers, rawRows, autoMapping, requiredFields, optionalFields]);

  // Final mapping: header-name match → content-based → manual override
  const mapping = useMemo(
    () => ({ ...autoMapping, ...contentMapping, ...manualMapping }),
    [autoMapping, contentMapping, manualMapping]
  );

  // True only when a file is loaded but zero fields could be matched at all
  const isWrongFile = rawRows.length > 0 && Object.values(mapping).filter(Boolean).length === 0;

  const imageColumns = useMemo(() => {
    if (!headers.length) return [];
    const norms = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
    return norms
      .filter((h) => {
        const n = h.norm;
        return (
          n.startsWith("image_url") ||
          n.startsWith("image") ||
          n.startsWith("img_url") ||
          n.includes("bild") ||
          n.includes("image")
        );
      })
      .map((h) => h.raw);
  }, [headers]);

  const rows = useMemo(() => {
    return rawRows.map((r, idx) => {
      const o = {};
      o.__rowIndex = idx;
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

  const optionalPresence = useMemo(() => {
    const missing = [];
    const found = [];
    for (const f of optionalFields) {
      if (mapping[f]) found.push({ field: f, column: mapping[f] });
      else missing.push(f);
    }
    return { found, missing };
  }, [mapping, optionalFields]);

  const stage1Status = useMemo(() => {
    if (!headers.length) return "idle";
    return requiredPresence.missing.length === 0 ? "ok" : "warn";
  }, [headers, requiredPresence]);

  const allRequiredOk = requiredPresence.missing.length === 0;

  const eanColumn = mapping.ean;
  const titleColumn = mapping.name;
  const sellerColumn = mapping.seller_offer_id;

  const openEanImageViewer = (ean) => {
    const target = String(ean ?? "").trim();
    setEanImageViewerInput(target);
    setEanImageViewerEan(target);
    setEanImageViewerLimit(24);

    if (!target || !eanColumn || !rows.length || !imageColumns.length) {
      setEanImageViewerUrls([]);
      setEanImageViewerOpen(true);
      return;
    }

    const seen = new Set();
    const urls = [];

    rows.forEach((r) => {
      const rowEan = String(r?.[eanColumn] ?? "").trim();
      if (rowEan !== target) return;

      for (const c of imageColumns) {
        const refs = extractImageUrlsFromCell(r?.[c]);
        for (const ref of refs) {
          const src = resolveImageSrc(ref);
          if (!src) continue;
          if (seen.has(src)) continue;
          seen.add(src);
          urls.push(src);
        }
      }
    });

    setEanImageViewerUrls(urls);
    setEanImageViewerOpen(true);
  };

  const duplicates = useMemo(() => {
    if (!rows.length) return { eanDup: new Set(), titleDup: new Set(), sellerDup: new Set() };
    const eanValues = eanColumn ? rows.map((r) => r[eanColumn]) : [];
    const titleValues = titleColumn ? rows.map((r) => r[titleColumn]) : [];
    return {
      eanDup: findDuplicateIndexes(eanValues),
      titleDup: findDuplicateIndexes(titleValues),
      sellerDup: sellerColumn ? findDuplicateIndexes(rows.map((r) => r[sellerColumn])) : new Set(),
    };
  }, [rows, eanColumn, titleColumn, sellerColumn]);

  const highlightedCells = useMemo(() => {
    const set = new Set();
    if (!rows.length) return set;

    // Duplikate EANs → EAN-Spalte hervorheben (kritisch)
    if (eanColumn) {
      duplicates.eanDup.forEach((idx) => {
        set.add(`${idx}:${eanColumn}`);
      });
    }

    // Duplikate Titel → ebenfalls die EAN-Zelle hervorheben (Warnung),
    // damit man direkt die betroffenen Produkte identifizieren kann.
    if (duplicates.titleDup.size > 0) {
      if (eanColumn) {
        duplicates.titleDup.forEach((idx) => {
          set.add(`${idx}:${eanColumn}`);
        });
      } else if (titleColumn) {
        // Fallback: wenn keine EAN-Spalte gemappt ist, Titel-Spalte markieren
        duplicates.titleDup.forEach((idx) => {
          set.add(`${idx}:${titleColumn}`);
        });
      }
    }

    requiredFields.forEach((fieldKey) => {
      const col = mapping[fieldKey];
      if (!col) return;
      rows.forEach((r, idx) => {
        if (isBlank(r[col])) {
          set.add(`${idx}:${col}`);
        }
      });
    });

    return set;
  }, [rows, eanColumn, titleColumn, duplicates, requiredFields, mapping]);

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

  const duplicateSellerOfferIds = useMemo(() => {
    if (!rows.length || !sellerColumn) return [];
    const vals = rows.map((r) => r[sellerColumn]);
    const idxSet = findDuplicateIndexes(vals);
    const ids = Array.from(idxSet).map((i) => String(vals[i] ?? "").trim());
    return uniqueNonEmpty(ids).sort();
  }, [rows, sellerColumn]);

  const duplicateTitleRows = useMemo(() => {
    if (!rows.length || !titleColumn) return [];
    const titleMap = new Map();
    rows.forEach((r, idx) => {
      const t = String(r?.[titleColumn] ?? "").trim();
      if (!t) return;
      const arr = titleMap.get(t) || [];
      arr.push(idx);
      titleMap.set(t, arr);
    });

    const out = [];
    for (const [title, idxs] of titleMap.entries()) {
      if (idxs.length < 2) continue;
      idxs.forEach((idx) => {
        const row = rows[idx];
        const eanVal = eanColumn ? String(row?.[eanColumn] ?? "").trim() : "";
        out.push({
          ean: eanVal || `ROW_${idx + 1}`,
          title,
          row: idx + 1,
        });
      });
    }
    return out;
  }, [rows, titleColumn, eanColumn]);

  const stage2Status = useMemo(() => {
    if (!headers.length) return "idle";
    if (!eanColumn || !titleColumn || !sellerColumn) return "warn";
    const dupCount = duplicates.eanDup.size + duplicates.titleDup.size + duplicates.sellerDup.size;
    return dupCount === 0 ? "ok" : "warn";
  }, [headers, eanColumn, titleColumn, sellerColumn, duplicates]);

  const optionalFindings = useMemo(() => {
    if (!rows.length) {
      return {
        missingEansByField: {
          material: [],
          color: [],
          delivery_includes: [],
          delivery_time: [],
          price: [],
          hs_code: [],
          manufacturer_name: [],
          manufacturer_country: [],
        },
        samplesByField: { material: [], color: [], delivery_includes: [] },
        missingEANs: [],
        imageZeroEans: [],
        imageOneEans: [],
        imageLowEans: [],
        imagePreviewUrls: [],
        scientificEans: [],
        invalidShipping: [],
        missingShipping: [],
        invalidMaterial: [],
        invalidColor: [],
        invalidDeliveryIncludes: [],
        titleIssues: { tooShort: [], seeAbove: [], missingAttributes: [] },
        descriptionIssues: {
          tooShort: [],
          advertising: [],
          externalLinks: [],
          variants: [],
          contactHint: [],
          templateLike: [],
        },
        invalidWashableCover: [],
        invalidMountingSide: [],
        invalidDeliveryTime: [],
        invalidStock: [],
        templateValueHits: [],
        lightingEnergyMissing: [],
      };
    }

    // --- SINGLE-PASS row iteration for all validations ---
    const eans = rows.map((r, idx) => {
      const v = eanColumn ? String(r[eanColumn] ?? "").trim() : "";
      return v || `ROW_${idx + 1}`;
    });

    const missingEANs = [];
    const missingEansByField = { material: [], color: [], delivery_includes: [], delivery_time: [], price: [], hs_code: [], manufacturer_name: [], manufacturer_country: [] };
    const invalidDeliveryIncludes = [], invalidWashableCover = [], invalidMountingSide = [], invalidDeliveryTime = [], invalidStock = [];
    const imageZero = [], imageOne = [], imageLow = [], scientificEans = [];
    const invalidShipping = [], missingShipping = [], invalidMaterial = [], invalidColor = [];
    const titleIssues = { tooShort: [], seeAbove: [], missingAttributes: [] };
    const descriptionIssues = { tooShort: [], advertising: [], externalLinks: [], variants: [], contactHint: [], templateLike: [] };
    const templateValueHits = [], lightingEnergyMissing = [];

    // Precompute configs once
    const missingFieldCols = {};
    const allMissingFields = [...new Set([...optionalFields, "material", "color", "delivery_includes", "price", "hs_code", "manufacturer_name", "manufacturer_country"])];
    for (const f of allMissingFields) { if (mapping[f]) missingFieldCols[f] = mapping[f]; }

    let deliveryRe = null;
    let deliveryAllowList = [];
    if (mapping.delivery_includes) {
      try { deliveryRe = new RegExp(String(rules?.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern), "i"); } catch (e) { deliveryRe = null; }
      deliveryAllowList = (rules?.delivery_includes_allowlist || DEFAULT_RULES.delivery_includes_allowlist || []).map((x) => String(x).trim());
    }
    const dtReUnit = /^\s*\d+(?:\s*-\s*\d+)?\s*(tage?|werktage?|arbeitstage?|wochen?|woche|wk\.?|wt\.?|d|days?)\s*$/i;
    const dtReNum = /^\s*\d+(?:\s*-\s*\d+)?\s*$/;
    const shippingAllowed = mapping.shipping_mode ? (rules?.allowed_shipping_mode || DEFAULT_RULES.allowed_shipping_mode).map((x) => String(x).toLowerCase()) : [];
    const shippingModeAliases = { package: "paket", pakete: "paket", parcel: "paket", pkg: "paket", karton: "paket", shipment: "spedition", spedition_ware: "spedition", speditionsware: "spedition", freight: "spedition", forwarding: "spedition" };
    // Safety: only validate mounting_side if the mapped column actually contains
    // mounting-side-like values (links/rechts/beidseitig). Avoids false positives
    // from auto-detected columns that aren't really mounting side. Also skip any
    // column whose header looks like assembly/montage/instruction — those should
    // never produce errors.
    const montageInstrRe = /(montage|instruction|anleitung)/i;
    const mountingRe = /^(links|rechts|beidseitig|beide|left|right|both)$/i;
    let validateMountingSide = false;
    if (mapping.mounting_side && !montageInstrRe.test(String(mapping.mounting_side))) {
      let mountingHits = 0;
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        const v = String(rows[i]?.[mapping.mounting_side] ?? "").trim();
        if (v && mountingRe.test(v)) { mountingHits++; if (mountingHits >= 2) break; }
      }
      validateMountingSide = mountingHits >= 2;
    }
    const matAllowedBase = mapping.material ? (rules?.allowed_material || DEFAULT_RULES.allowed_material).map((x) => String(x).toLowerCase().trim()) : [];
    const matBlacklist = ["keine angabe"];
    const matAllowed = matAllowedBase.filter((t) => t && !matBlacklist.includes(t));
    const colorAllowed = mapping.color ? (rules?.allowed_color || DEFAULT_RULES.allowed_color).map((x) => String(x).toLowerCase().trim()) : [];
    const minTitle = Number(rules?.title_min_length ?? DEFAULT_RULES.title_min_length);
    const minDesc = Number(rules?.description_min_length ?? DEFAULT_RULES.description_min_length);
    const lampTokens = ["lampe", "leuchte", "leuchten", "licht", "beleuchtung", "led"];
    const energyCol = mapping.energy_efficiency_label, lightingInclCol = mapping.lighting_included, eprelCol = mapping.eprel_registration_number;
    const hasEnergyCols = energyCol || lightingInclCol || eprelCol;
    const templateColumnsMap = {};
    for (const field of Object.keys(EXAMPLE_TEMPLATE_VALUES)) {
      const ex = (EXAMPLE_TEMPLATE_VALUES[field] || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      if (ex.length && mapping[field]) templateColumnsMap[field] = { col: mapping[field], examples: new Set(ex) };
    }

    // SINGLE PASS over all rows
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const ean = eans[idx];

      // Missing EAN
      if (eanColumn && isBlank(r[eanColumn])) {
        const nameVal = mapping.name ? String(r[mapping.name] ?? "").trim() : "";
        const sellerVal = mapping.seller_offer_id ? String(r[mapping.seller_offer_id] ?? "").trim() : "";
        let label;
        if (nameVal) label = `${nameVal} · Zeile ${idx + 1}`;
        else if (sellerVal) label = `Offer ID ${sellerVal} · Zeile ${idx + 1}`;
        else label = `Zeile ${idx + 1}`;
        missingEANs.push(label);
      }
      // Scientific EAN
      if (eanColumn && looksLikeScientificEAN(r[eanColumn])) scientificEans.push(ean);

      // Missing fields
      for (const f in missingFieldCols) { if (isBlank(r[missingFieldCols[f]])) { if (!missingEansByField[f]) missingEansByField[f] = []; missingEansByField[f].push(ean); } }

      // Delivery includes
      if (mapping.delivery_includes) {
        const vRaw = String(r[mapping.delivery_includes] ?? "").trim();
        if (vRaw && !deliveryAllowList.includes(vRaw)) {
          const ok = deliveryRe ? deliveryRe.test(vRaw) : /(^|\s)(\d+)\s*[xX×]\s*\S+/i.test(vRaw);
          if (!ok) invalidDeliveryIncludes.push({ ean, value: vRaw });
        }
      }
      // Washable cover
      if (mapping.washable_cover) { const v = String(r[mapping.washable_cover] ?? "").trim().toLowerCase(); if (v && v !== "ja" && v !== "nein") invalidWashableCover.push({ ean, value: v }); }
      // Mounting side – only when the mapped column truly looks like mounting-side data
      if (validateMountingSide) { const v = String(r[mapping.mounting_side] ?? "").trim().toLowerCase(); if (v && v !== "links" && v !== "rechts" && v !== "beidseitig") invalidMountingSide.push({ ean, value: v }); }
      // Delivery time
      if (mapping.delivery_time) { const v = String(r[mapping.delivery_time] ?? "").trim(); if (!v || (!dtReUnit.test(v) && !dtReNum.test(v))) invalidDeliveryTime.push({ ean, value: v }); }
      // Stock amount – must be a non-negative integer
      if (mapping.stock_amount) { const v = String(r[mapping.stock_amount] ?? "").trim(); if (v && !/^\d+$/.test(v)) invalidStock.push({ ean, value: v }); }
      // Images
      const imgCount = countNonEmptyImageLinks(r, imageColumns);
      if (imgCount === 0) imageZero.push(ean);
      if (imgCount === 1) imageOne.push(ean);
      if (imgCount < imageMin) imageLow.push(ean);
      // Shipping (accept aliases like "Package" → "Paket")
      if (mapping.shipping_mode) { const v = String(r[mapping.shipping_mode] ?? "").trim(); if (!v) missingShipping.push(ean); else { const vl = v.toLowerCase(); const canon = shippingModeAliases[vl] || vl; if (!shippingAllowed.includes(canon)) invalidShipping.push({ ean, value: v }); } }
      // Material
      if (matAllowed.length && mapping.material) { const v = String(r[mapping.material] ?? "").trim(); if (v) { const vl = v.toLowerCase(); if (!matAllowed.some((t) => vl.includes(t)) || matBlacklist.some((b) => vl.includes(b))) invalidMaterial.push({ ean, value: v }); } }
      // Color
      if (colorAllowed.length && mapping.color) { const v = String(r[mapping.color] ?? "").trim(); if (v && !colorAllowed.some((t) => v.toLowerCase().includes(t))) invalidColor.push({ ean, value: v }); }
      // Title
      if (mapping.name) {
        const title = String(r[mapping.name] ?? "").trim();
        if (title.length < minTitle) titleIssues.tooShort.push(ean);
        if (/siehe oben/i.test(title)) titleIssues.seeAbove.push(ean);
      }
      // Description
      if (mapping.description) {
        const desc = String(r[mapping.description] ?? "").trim();
        if (desc.length < minDesc) descriptionIssues.tooShort.push(ean);
        if (/www\.|http|https/i.test(desc)) descriptionIssues.externalLinks.push(ean);
        if (/jetzt kaufen|rabatt|angebot/i.test(desc)) descriptionIssues.advertising.push(ean);
        const titleVal = mapping.name ? String(r[mapping.name] ?? "").trim() : "";
        if (desc && titleVal && desc.toLowerCase() === titleVal.toLowerCase()) descriptionIssues.templateLike.push(ean);
        else { const wc = desc ? desc.split(/\s+/).filter(Boolean).length : 0; if (wc > 0 && wc <= 3) descriptionIssues.templateLike.push(ean); else if (/beispieltext|musterbeschreibung|lorem ipsum/i.test(desc.toLowerCase())) descriptionIssues.templateLike.push(ean); }
      }
      // Template values
      for (const field in templateColumnsMap) { const v = String(r[templateColumnsMap[field].col] ?? "").trim(); if (v && templateColumnsMap[field].examples.has(v.toLowerCase())) templateValueHits.push({ ean, column: field, value: v }); }
      // Lighting energy
      if (hasEnergyCols && mapping.name) {
        const t = String(r[mapping.name] ?? "").toLowerCase();
        const noLightingInTitle = /ohne\s+(beleuchtung|lichter?|licht)\b/i.test(t) || /nicht\s+beleuchtet/i.test(t);
        const liVal = lightingInclCol ? String(r[lightingInclCol] ?? "").trim().toLowerCase() : "";
        const declaredNoLighting = !!liVal && ["nein", "0", "no", "false", "ohne", "nicht"].includes(liVal);
        if (t && !noLightingInTitle && !declaredNoLighting && lampTokens.some((tok) => t.includes(tok))) {
          if ((energyCol && isBlank(r[energyCol])) || (lightingInclCol && isBlank(r[lightingInclCol])) || (eprelCol && isBlank(r[eprelCol]))) lightingEnergyMissing.push(ean);
        }
      }
    }

    // Deduplicate missing fields
    for (const f in missingEansByField) missingEansByField[f] = uniqueNonEmpty(missingEansByField[f]).sort();

    const samplesByField = {
      material: sampleUniqueValues(rows, mapping.material, 5),
      color: sampleUniqueValues(rows, mapping.color, 5),
      delivery_includes: sampleUniqueValues(rows, mapping.delivery_includes, 5),
    };
    const imagePreviewUrls = firstImageUrls(rows, imageColumns, 6);

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
      invalidMaterial,
      invalidColor,
      invalidDeliveryIncludes,
      titleIssues,
      descriptionIssues,
      invalidWashableCover,
      invalidMountingSide,
      invalidDeliveryTime,
      invalidStock,
      templateValueHits,
      lightingEnergyMissing: uniqueNonEmpty(lightingEnergyMissing).sort(),
    };
  }, [rows, optionalFields, mapping, imageColumns, imageMin, eanColumn, rules]);

  const stage3Status = useMemo(() => {
    if (!headers.length) return "idle";
    const byField = optionalFindings.missingEansByField || {};
    const anyMissing =
      (byField.material || []).length +
        (byField.color || []).length +
        (byField.delivery_includes || []).length +
        (byField.delivery_time || []).length +
        optionalFindings.missingEANs.length >
      0;
    const imagesBad = optionalFindings.imageZeroEans.length > 0 || optionalFindings.imageOneEans.length > 0;
    const shipBad = optionalFindings.invalidShipping.length > 0 || optionalFindings.missingShipping.length > 0;
    const materialBad = optionalFindings.invalidMaterial?.length > 0;
    const colorBad = optionalFindings.invalidColor?.length > 0;
    const deliveryTimeBad = optionalFindings.invalidDeliveryTime?.length > 0;
    const stockBad = optionalFindings.invalidStock?.length > 0;
    const templateValuesBad = optionalFindings.templateValueHits?.length > 0;
    return anyMissing || imagesBad || shipBad || materialBad || colorBad || deliveryTimeBad || stockBad || templateValuesBad
      ? "warn"
      : "ok";
  }, [headers, optionalFindings]);

  const hasOptionalShippingFindings = useMemo(() => {
    if (!headers.length) return false;
    const byField = optionalFindings.missingEansByField || {};
    const missingCount =
      (byField.material || []).length +
      (byField.color || []).length +
      (byField.delivery_includes || []).length +
      (byField.delivery_time || []).length +
      (optionalFindings.missingEANs || []).length;
    return (
      missingCount > 0 ||
      (optionalFindings.invalidShipping || []).length > 0 ||
      (optionalFindings.missingShipping || []).length > 0 ||
      (optionalFindings.invalidMaterial || []).length > 0 ||
      (optionalFindings.invalidColor || []).length > 0 ||
      (optionalFindings.invalidDeliveryIncludes || []).length > 0 ||
      (optionalFindings.invalidDeliveryTime || []).length > 0 ||
      (optionalFindings.invalidStock || []).length > 0 ||
      (optionalFindings.templateValueHits || []).length > 0 ||
      (optionalFindings.invalidWashableCover || []).length > 0 ||
      (optionalFindings.invalidMountingSide || []).length > 0 ||
      (optionalFindings.scientificEans || []).length > 0
    );
  }, [headers, optionalFindings]);

  const imageSamples = useMemo(() => {
    if (!rows.length || !imageColumns.length) return [];
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const urls = [];
      for (const c of imageColumns) {
        const refs = extractImageUrlsFromCell(r?.[c]);
        for (const ref of refs) {
          const src = resolveImageSrc(ref);
          if (src) urls.push(src);
        }
      }
      if (!urls.length) continue;
      const id = eanColumn
        ? String(r?.[eanColumn] ?? "").trim() || `ROW_${i + 1}`
        : `ROW_${i + 1}`;
      const title = titleColumn ? String(r?.[titleColumn] ?? "").trim() : "";
      out.push({ id, title, urls, count: urls.length });
      if (out.length >= 50) break;
    }
    return out;
  }, [rows, imageColumns, eanColumn]);

  const imageBuckets = useMemo(() => {
    const buckets = {};
    if (!rows.length || !imageColumns.length) return buckets;

    const ids = rows.map((r, idx) => {
      if (eanColumn) {
        const v = String(r?.[eanColumn] ?? "").trim();
        if (v) return v;
      }
      return `ROW_${idx + 1}`;
    });

    rows.forEach((r, idx) => {
      const count = countNonEmptyImageLinks(r, imageColumns);
      const key = count;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(ids[idx]);
    });

    return buckets;
  }, [rows, imageColumns, eanColumn]);

  const summary = useMemo(() => {
    if (!headers.length) {
      return { score: 0, canStart: false, issues: [], tips: [], issueTargets: [] };
    }

    const issues = [];
    const issueTargets = [];
    const tips = [];
    const tipTargets = [];
    const addTip = (message, target = null) => {
      tips.push(message);
      tipTargets.push(target);
    };

    // Track which rows are affected by critical issues vs warnings.
    // This enables the summary UI to show "X von Y Zeilen" consistently.
    const criticalRowIdx = new Set();
    const warningRowIdx = new Set();
    const eanToRowIndices = new Map();

    if (eanColumn) {
      rows.forEach((r, idx) => {
        const v = String(r?.[eanColumn] ?? "").trim();
        if (!v) return;
        if (!eanToRowIndices.has(v)) eanToRowIndices.set(v, new Set());
        eanToRowIndices.get(v).add(idx);
      });
    }

    const addRowsByEans = (eans, targetSet) => {
      if (!eanColumn) return;
      const list = Array.isArray(eans) ? eans : [];
      for (const e of list) {
        const key = String(e ?? "").trim();
        if (!key) continue;
        const idxSet = eanToRowIndices.get(key);
        if (!idxSet) continue;
        idxSet.forEach((idx) => targetSet.add(idx));
      }
    };

    const addRowsByEanObjects = (arr, targetSet) => {
      if (!eanColumn) return;
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        const key = String(it?.ean ?? "").trim();
        if (!key) continue;
        const idxSet = eanToRowIndices.get(key);
        if (!idxSet) continue;
        idxSet.forEach((idx) => targetSet.add(idx));
      }
    };

    const addAllRows = (targetSet) => {
      for (let i = 0; i < rows.length; i += 1) targetSet.add(i);
    };

    const addIssue = (message, target = null) => {
      issues.push(message);
      issueTargets.push(target);
    };
    const findTargetByEan = (ean) => {
      const value = String(ean ?? "").trim();
      if (!value) return null;
      const rowIndex = rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === value);
      if (rowIndex < 0) return null;
      return { rowIndex, ean: value };
    };
    const findTargetsByEans = (eans) => {
      const list = Array.isArray(eans) ? eans : [];
      const normalized = list.map((e) => String(e ?? "").trim()).filter(Boolean);
      if (!normalized.length) return null;

      const rowIndicesSet = new Set();
      for (const e of normalized) {
        const idxSet = eanToRowIndices.get(e);
        if (!idxSet) continue;
        idxSet.forEach((idx) => rowIndicesSet.add(idx));
      }
      const rowIndices = Array.from(rowIndicesSet).sort((a, b) => a - b);
      const firstRowIndex = rowIndices.length ? rowIndices[0] : null;
      return { eans: normalized, rowIndices, rowIndex: firstRowIndex, ean: normalized[0] };
    };
    const findTargetByRowIndex = (rowIndex) => {
      if (rowIndex == null || rowIndex < 0 || rowIndex >= rows.length) return null;
      const ean = eanColumn ? String(rows[rowIndex]?.[eanColumn] ?? "").trim() : "";
      return { rowIndex, ean: ean || null };
    };

    if (requiredPresence.missing.length) {
      addIssue(`Pflichtfelder fehlen oder wurden nicht erkannt: ${requiredPresence.missing.join(", ")}`);
      addTip("Bitte prüfen Sie die Spaltennamen oder liefern Sie die fehlenden Pflichtfelder nach.");
    }

    // Category path missing – critical, because without it we cannot filter out
    // irrelevant products (e.g., goods that don't fit the CHECK24 furniture range).
    if (!mapping.category_path) {
      addIssue("Kategoriepfad fehlt. Ohne Kategoriepfad können nicht zum Sortiment passende Artikel nicht herausgefiltert werden.");
      addTip("Bitte liefern Sie eine Spalte mit dem Kategoriepfad (z. B. \"Kategorie\", \"category\" oder \"category_path\"), idealerweise mit Ebenen, die mit \" > \" getrennt sind.");
    }

    // Encoding check: detect mojibake (typical Windows-1252 → UTF-8 double-encoding
    // artifacts like "Ã¤" instead of "ä") and the Unicode replacement character.
    (() => {
      const textCols = ["name", "description", "color", "material", "delivery_includes", "category_path"]
        .map((f) => mapping[f])
        .filter(Boolean);
      if (!textCols.length || !rows.length) return;
      const mojibakeRe = /(Ã[¤¶¼Ÿ©¨]|â€œ|â€�|â€“|â€”|Â |\uFFFD)/;
      const badRows = new Set();
      for (let i = 0; i < rows.length; i++) {
        for (const c of textCols) {
          if (mojibakeRe.test(String(rows[i]?.[c] ?? ""))) { badRows.add(i); break; }
        }
      }
      if (badRows.size > 0) {
        badRows.forEach((idx) => criticalRowIdx.add(idx));
        addIssue(
          `Zeichencodierung fehlerhaft in ${badRows.size} Artikeln (z. B. "Ã¤" statt "ä").`,
          { rowIndices: Array.from(badRows).sort((a, b) => a - b), rowIndex: Math.min(...badRows) }
        );
        addTip("Die Datei bitte als UTF-8 speichern und erneut hochladen. Aktuell sieht es so aus, als wäre Windows-1252-Text fälschlich als UTF-8 gelesen (oder umgekehrt) worden.");
      }
    })();

    // Language check: flag feeds whose content is in English rather than German.
    // Scan name/description/color/material/delivery_includes text across a sample of rows
    // and compare German vs English function-word hits. A clear English majority
    // (and absence of German diacritics/stopwords) is surfaced as a critical issue.
    (() => {
      const textCols = ["name", "description", "color", "material", "delivery_includes", "category_path"]
        .map((f) => mapping[f])
        .filter(Boolean);
      if (!textCols.length || !rows.length) return;
      const sample = rows.slice(0, Math.min(50, rows.length));
      const bigText = sample
        .map((r) => textCols.map((c) => String(r?.[c] ?? "")).join(" "))
        .join(" ")
        .toLowerCase();
      if (bigText.trim().length < 40) return;
      const countMatches = (regex) => (bigText.match(regex) || []).length;
      // German function words / diacritics
      const germanScore =
        countMatches(/\b(der|die|das|den|dem|des|und|oder|mit|für|von|vom|zur|zum|ein|eine|einen|einer|eines|auf|aus|bei|nicht|auch|sowie|inkl|ohne|als|wie|sehr|bis)\b/g) +
        countMatches(/[äöüß]/g);
      // English function words
      const englishScore = countMatches(/\b(the|and|with|for|of|from|this|that|these|those|are|is|was|were|has|have|including|without|made|use|used|product|features|material|color|size|height|width|length|depth|black|white|brown|grey|gray)\b/g);
      const total = germanScore + englishScore;
      if (total < 20) return; // not enough signal
      if (englishScore >= germanScore * 2 && germanScore < 10) {
        addIssue("Der Feed-Inhalt (z. B. Produktname, Beschreibung, Farbe, Lieferumfang) scheint auf Englisch zu sein. Bitte liefern Sie den Content auf Deutsch.");
        addTip("Übersetzen Sie Produkttitel, Beschreibungen sowie Farb- und Materialangaben ins Deutsche, bevor Sie den Feed erneut hochladen.");
      }
    })();

    if (eanColumn) {
      const missingEanIndices = [];
      rows.forEach((r, idx) => {
        if (isBlank(r[eanColumn])) { criticalRowIdx.add(idx); missingEanIndices.push(idx); }
      });
      if (missingEanIndices.length > 0) {
        addIssue(
          `EAN fehlt in ${missingEanIndices.length} Artikeln.`,
          { rowIndices: missingEanIndices, rowIndex: missingEanIndices[0], ean: null }
        );
      }
    } else {
      addIssue("EAN-Spalte fehlt. Ohne EAN ist eine Verarbeitung nicht möglich.");
      addTip("Bitte liefern Sie eine EAN- oder GTIN-Spalte. Falls die Werte in Excel im E-Format stehen, bitte als Text formatieren.");
    }

    if (eanColumn) {
      if (duplicates.eanDup.size > 0) {
        duplicates.eanDup.forEach((idx) => criticalRowIdx.add(idx));
        const dupIndices = Array.from(duplicates.eanDup).sort((a, b) => a - b);
        const dupEans = dupIndices.map((idx) => String(rows[idx]?.[eanColumn] ?? "").trim()).filter(Boolean);
        addIssue(`Doppelte EAN erkannt in ${duplicates.eanDup.size} Zeilen.`, { rowIndices: dupIndices, rowIndex: dupIndices[0], eans: [...new Set(dupEans)], ean: dupEans[0] || null });
      }

      if (optionalFindings.scientificEans.length > 0) {
        addRowsByEans(optionalFindings.scientificEans, criticalRowIdx);
        addIssue(
          `EAN Darstellungsproblem erkannt in ${optionalFindings.scientificEans.length} Artikeln. Werte wirken wie wissenschaftliche Schreibweise.`,
          findTargetsByEans(optionalFindings.scientificEans)
        );
        addTip("Bitte EAN Spalte als Text formatieren, damit die komplette GTIN erhalten bleibt.");
      }
    }

    if (titleColumn && duplicates.titleDup.size > 0) {
      const titleDupIndices = Array.from(duplicates.titleDup).sort((a, b) => a - b);
      const titleDupEans = titleDupIndices.map((idx) => eanColumn ? String(rows[idx]?.[eanColumn] ?? "").trim() : "").filter(Boolean);
      const titleDupTarget = { rowIndices: titleDupIndices, rowIndex: titleDupIndices[0], eans: [...new Set(titleDupEans)], ean: titleDupEans[0] || null, column: titleColumn };
      if (mapping.category_path) {
        // With a category path we can filter out irrelevant products anyway,
        // so duplicate titles are just a warning.
        duplicates.titleDup.forEach((idx) => warningRowIdx.add(idx));
        addTip(`Doppelte Produkttitel in ${duplicates.titleDup.size} Zeilen. Verschiedene Varianten (z. B. Farbe, Größe) sollten sich im Titel unterscheiden.`, titleDupTarget);
      } else {
        duplicates.titleDup.forEach((idx) => criticalRowIdx.add(idx));
        addIssue(`Doppelte Produkttitel erkannt in ${duplicates.titleDup.size} Zeilen.`, titleDupTarget);
      }
    }

    if (sellerColumn && duplicates.sellerDup.size > 0) {
      duplicates.sellerDup.forEach((idx) => criticalRowIdx.add(idx));
      const sellerDupIndices = Array.from(duplicates.sellerDup).sort((a, b) => a - b);
      const sellerDupEans = sellerDupIndices.map((idx) => eanColumn ? String(rows[idx]?.[eanColumn] ?? "").trim() : "").filter(Boolean);
      addIssue(`Doppelte Seller_Offer_ID erkannt in ${duplicates.sellerDup.size} Zeilen.`, { rowIndices: sellerDupIndices, rowIndex: sellerDupIndices[0], eans: [...new Set(sellerDupEans)], ean: sellerDupEans[0] || null });
    }

    const optionalMissingCount =
      optionalFindings.missingEansByField.material.length +
      optionalFindings.missingEansByField.color.length +
      optionalFindings.missingEansByField.delivery_includes.length;

    const missingPriceCount = mapping.price ? optionalFindings.missingEansByField.price.length : 0;
    const missingHsCodeCount = mapping.hs_code ? optionalFindings.missingEansByField.hs_code.length : 0;
    const missingManufacturerNameCount = mapping.manufacturer_name
      ? optionalFindings.missingEansByField.manufacturer_name.length
      : 0;
    const missingManufacturerCountryCount = mapping.manufacturer_country
      ? optionalFindings.missingEansByField.manufacturer_country.length
      : 0;

    const lightingEnergyMissingCount = optionalFindings.lightingEnergyMissing
      ? optionalFindings.lightingEnergyMissing.length
      : 0;

    [
      { label: "Material", eans: optionalFindings.missingEansByField.material, col: mapping.material },
      { label: "Farbe",    eans: optionalFindings.missingEansByField.color,    col: mapping.color },
      { label: "Lieferumfang", eans: optionalFindings.missingEansByField.delivery_includes, col: mapping.delivery_includes },
    ].forEach(({ label, eans, col }) => {
      if (!eans.length) return;
      addRowsByEans(eans, warningRowIdx);
      addTip(`${label} fehlt bei ${eans.length} Artikel${eans.length === 1 ? "" : "n"}.`, { ...findTargetsByEans(eans), column: col });
    });

    if (missingPriceCount > 0) {
      addRowsByEans(optionalFindings.missingEansByField.price, criticalRowIdx);
      addIssue(`Preis fehlt bei ${missingPriceCount} Artikeln.`);
    }
    if (missingManufacturerNameCount > 0 || missingManufacturerCountryCount > 0) {
      addRowsByEans(optionalFindings.missingEansByField.manufacturer_name, warningRowIdx);
      addRowsByEans(optionalFindings.missingEansByField.manufacturer_country, warningRowIdx);
      addTip("Herstellerangaben fehlen.", { ...findTargetsByEans([...optionalFindings.missingEansByField.manufacturer_name, ...optionalFindings.missingEansByField.manufacturer_country]), column: mapping.manufacturer_name || mapping.manufacturer_country });
    }

    if (lightingEnergyMissingCount > 0) {
      addRowsByEans(optionalFindings.lightingEnergyMissing, criticalRowIdx);
      addIssue(
        `Energieeffizienz-Angaben fehlen bei ${lightingEnergyMissingCount} Artikeln, die als Leuchte/Lampe erkannt wurden (Titel enthält z. B. LED/Lampe/Leuchte).`,
        findTargetsByEans(optionalFindings.lightingEnergyMissing)
      );
    }

    if (imageColumns.length === 0) {
      addIssue("Keine Bildspalten erkannt.");
    } else {
      if (optionalFindings.imageZeroEans.length > 0) {
        addRowsByEans(optionalFindings.imageZeroEans, criticalRowIdx);
        addIssue(
          `Keine Bilder bei ${optionalFindings.imageZeroEans.length} Artikeln.`,
          findTargetsByEans(optionalFindings.imageZeroEans)
        );
      }
      const lowImageEans = [...new Set([...optionalFindings.imageOneEans, ...optionalFindings.imageLowEans])];
      if (lowImageEans.length > 0) {
        addRowsByEans(lowImageEans, warningRowIdx);
        addTip(`Zu wenige Bilder (mind. ${imageMin} empfohlen).`, { ...findTargetsByEans(lowImageEans), column: imageColumns[0] });
      }
      if (brokenImageIds.length > 0) {
        addRowsByEans(brokenImageIds, criticalRowIdx);
        addIssue(`Bei ${brokenImageIds.length} Produkten konnten Vorschaubilder nicht geladen werden. Bitte Bild-Links prüfen.`);
      }
    }

    let score = 100;
    score -= Math.min(40, requiredPresence.missing.length * 8);
    score -= Math.min(25, duplicates.eanDup.size > 0 ? 25 : 0);
    score -= Math.min(15, duplicates.titleDup.size > 0 ? 15 : 0);
    score -= Math.min(12, optionalFindings.imageZeroEans.length > 0 ? 12 : 0);
    score -= Math.min(6, optionalFindings.imageOneEans.length > 0 ? 6 : 0);
    score -= Math.min(10, optionalMissingCount > 0 ? 10 : 0);
    score -= Math.min(15, missingPriceCount > 0 ? 15 : 0);
    score -= Math.min(5, missingHsCodeCount > 0 ? 5 : 0);
    score -= Math.min(
      5,
      missingManufacturerNameCount + missingManufacturerCountryCount > 0 ? 5 : 0
    );
    score -= Math.min(10, lightingEnergyMissingCount > 0 ? 10 : 0);
    score -= Math.min(15, optionalFindings.invalidShipping.length > 0 ? 15 : 0);
    score -= Math.min(10, optionalFindings.missingShipping.length > 0 ? 10 : 0);
    score -= Math.min(15, eanColumn && rows.some((r) => isBlank(r[eanColumn])) ? 15 : 0);
    score -= Math.min(20, brokenImageIds.length > 0 ? 20 : 0);

    if (mapping.delivery_includes && optionalFindings.invalidDeliveryIncludes.length > 0) {
      addRowsByEanObjects(optionalFindings.invalidDeliveryIncludes, criticalRowIdx);
      addRowsByEanObjects(optionalFindings.invalidDeliveryIncludes, warningRowIdx);
      addIssue(
        `Lieferumfang-Format ungültig in ${optionalFindings.invalidDeliveryIncludes.length} Zeilen.`,
        findTargetsByEans(optionalFindings.invalidDeliveryIncludes.map((x) => x?.ean))
      );
      score -= 5;
    }

    if (mapping.delivery_time && optionalFindings.invalidDeliveryTime.length > 0) {
      addRowsByEanObjects(optionalFindings.invalidDeliveryTime, criticalRowIdx);
      addRowsByEanObjects(optionalFindings.invalidDeliveryTime, warningRowIdx);
      addIssue(
        `Lieferzeit ungültig in ${groupByValueWithEans(optionalFindings.invalidDeliveryTime).length} verschiedenen Werten.`,
        findTargetsByEans(optionalFindings.invalidDeliveryTime.map((x) => x?.ean))
      );
      score -= 5;
    }

    if (mapping.stock_amount && optionalFindings.invalidStock.length > 0) {
      addRowsByEanObjects(optionalFindings.invalidStock, criticalRowIdx);
      addIssue(
        `Bestand ungültig in ${optionalFindings.invalidStock.length} Artikeln. Es sind nur ganze Zahlen erlaubt.`,
        findTargetsByEans(optionalFindings.invalidStock.map((x) => x?.ean))
      );
      addTip("Bestand muss eine Zahl sein.", { ...findTargetsByEans(optionalFindings.invalidStock.map((x) => x?.ean)), column: mapping.stock_amount });
      score -= 5;
    }

    if (mapping.description) {
      if (optionalFindings.descriptionIssues.tooShort.length > 0) {
        addRowsByEans(optionalFindings.descriptionIssues.tooShort, criticalRowIdx);
        addRowsByEans(optionalFindings.descriptionIssues.tooShort, warningRowIdx);
        addIssue(
          `Beschreibungen zu kurz bei ${optionalFindings.descriptionIssues.tooShort.length} Artikeln.`,
          findTargetsByEans(optionalFindings.descriptionIssues.tooShort)
        );
        const descIssueEans = [...new Set([...optionalFindings.descriptionIssues.tooShort, ...(optionalFindings.descriptionIssues.templateLike || [])])];
        addTip("Beschreibungen zu kurz oder unvollständig.", { ...findTargetsByEans(descIssueEans), column: mapping.description });
        score -= 3;
      }
      if (optionalFindings.descriptionIssues.templateLike.length > 0) {
        addRowsByEans(optionalFindings.descriptionIssues.templateLike, warningRowIdx);
        score -= 3;
      }
    }

    if (mapping.shipping_mode) {
      if (optionalFindings.missingShipping.length > 0) {
        addRowsByEans(optionalFindings.missingShipping, criticalRowIdx);
        addIssue(
          `Versandart fehlt in ${optionalFindings.missingShipping.length} Artikeln.`,
          findTargetsByEans(optionalFindings.missingShipping)
        );
      }
      if (optionalFindings.invalidShipping.length > 0) {
        addRowsByEanObjects(optionalFindings.invalidShipping, criticalRowIdx);
        addIssue(
          `shipping_mode ungültig in ${optionalFindings.invalidShipping.length} Artikeln. Erlaubt sind Paket oder Spedition.`,
          findTargetsByEans(optionalFindings.invalidShipping.map((x) => x?.ean))
        );
      }
    }
    // Grammar heuristic on German descriptions – flags rows with likely
    // grammatical/typographic issues (repeated words, missing space after
    // punctuation, lowercase sentence starts, doubled punctuation).
    if (mapping.description) {
      const badRows = new Set();
      const examples = [];
      const repeatedWordRe = /\b(\w{2,})\s+\1\b/i;
      const missingSpaceRe = /[a-zäöüß][.!?][A-ZÄÖÜ]/;
      const doubledPunctRe = /[.!?]{3,}|,{2,}/;
      const lowercaseSentenceRe = /[.!?]\s+[a-zäöüß]/;
      const noSpaceCommaRe = /[a-zäöüß],[a-zäöüß]/i;
      for (let i = 0; i < rows.length; i++) {
        const v = String(rows[i]?.[mapping.description] ?? "");
        if (v.length < 40) continue;
        let hits = 0;
        if (repeatedWordRe.test(v)) hits++;
        if (missingSpaceRe.test(v)) hits++;
        if (doubledPunctRe.test(v)) hits++;
        if (lowercaseSentenceRe.test(v)) hits++;
        if (noSpaceCommaRe.test(v)) hits++;
        if (hits >= 2) {
          badRows.add(i);
          if (examples.length < 3) examples.push(v.slice(0, 80));
        }
      }
      if (badRows.size > 0 && badRows.size / Math.max(1, rows.length) > 0.05) {
        badRows.forEach((idx) => warningRowIdx.add(idx));
        addTip(
          `Mögliche grammatikalische oder typografische Auffälligkeiten in ${badRows.size} Beschreibungen (z. B. doppelte Wörter, fehlendes Leerzeichen nach Satzzeichen, kleingeschriebene Satzanfänge). Bitte Beschreibungen prüfen.`,
          { rowIndices: Array.from(badRows).sort((a, b) => a - b), rowIndex: Math.min(...badRows), column: mapping.description }
        );
        score -= 3;
      }
    }

    if (mapping.description && optionalFindings.descriptionIssues.externalLinks.length > 0) {
      addRowsByEans(optionalFindings.descriptionIssues.externalLinks, criticalRowIdx);
      addRowsByEans(optionalFindings.descriptionIssues.externalLinks, warningRowIdx);
      addIssue(
        `Externe Links in Beschreibungen bei ${optionalFindings.descriptionIssues.externalLinks.length} Artikeln.`,
        findTargetsByEans(optionalFindings.descriptionIssues.externalLinks)
      );
      addTip("Externe Links in Beschreibungen.", { ...findTargetsByEans(optionalFindings.descriptionIssues.externalLinks), column: mapping.description });
      score -= 3;
    }

    if (!mapping.size) {
      addTip(
        "Bitte Maße (z. B. Höhe/Breite/Tiefe) je Produkt klar angeben – idealerweise in separaten Spalten oder im Titel/Beschreibung."
      );
    }

    // Category-based recommended attributes and irrelevant-category hints.
    if (mapping.category_path && rows.length) {
      const catCol = mapping.category_path;
      const catCounts = new Map();
      for (let i = 0; i < rows.length; i++) {
        const v = String(rows[i]?.[catCol] ?? "").trim();
        if (!v) continue;
        catCounts.set(v, (catCounts.get(v) || 0) + 1);
      }
      const allCatText = Array.from(catCounts.keys()).join(" | ").toLowerCase();

      // #18 – recommended attributes per furniture sub-category
      const categoryRecs = [
        { match: /matratz/i, label: "Matratzen", attrs: ["Härtegrad", "Liegefläche", "Matratzenhöhe"] },
        { match: /\bbett\b|betten|boxspring/i, label: "Betten", attrs: ["Liegefläche", "Lattenrost inklusive", "Matratze inklusive"] },
        { match: /sofa|couch|ecksofa|wohnlandschaft/i, label: "Sofas", attrs: ["Sitzhöhe", "Sitztiefe", "Bezug abnehmbar"] },
        { match: /lampe|leuchte|licht|beleuchtung/i, label: "Leuchten", attrs: ["Lichtfarbe", "Leuchtmittel inklusive", "Energieeffizienzklasse"] },
        { match: /stuhl|stühle|sessel|hocker/i, label: "Stühle", attrs: ["Sitzhöhe", "Belastbarkeit", "Stil"] },
        { match: /schrank|kleiderschrank|regal/i, label: "Schränke/Regale", attrs: ["Anzahl Türen", "Anzahl Fächer", "Belastbarkeit pro Fach"] },
        { match: /tisch|esstisch|couchtisch|schreibtisch/i, label: "Tische", attrs: ["Belastbarkeit", "Ausziehbar", "Tischhöhe"] },
      ];
      for (const rec of categoryRecs) {
        if (rec.match.test(allCatText)) {
          const missingAttrs = rec.attrs.filter((attr) => {
            const k = attr.toLowerCase();
            return !headers.some((h) => String(h || "").toLowerCase().includes(k.split(" ")[0]));
          });
          if (missingAttrs.length) {
            addTip(
              `Da Sie ${rec.label} anbieten und Kunden häufig ${missingAttrs.join(", ")} prüfen, empfehlen wir, diese Attribute zu ergänzen.`
            );
          }
        }
      }

      // #21 – suggest categories that likely don't fit the CHECK24 furniture range
      const nonFurnitureRe = /(auto|kfz|motorrad|reifen|fahrrad|e-bike|spielzeug|baby(?!bett)|lebensmittel|getränk|elektronik|smartphone|handy|laptop|tablet|kamera|fernseher|kleidung|mode|schuhe|schmuck|uhren|buch|dvd|cd|software|werkzeug|baumarkt|garten(?:möbel)?s|pflanze|dünger|samen|haustier|tierfutter|kosmetik|parfum|drogerie|medikament|apotheke|sport(?:geräte|bekleidung)?|fitness|outdoor(?:bekleidung)?|camping|angeln|jagd)/i;
      const irrelevant = [];
      for (const [cat, count] of catCounts.entries()) {
        if (nonFurnitureRe.test(cat)) irrelevant.push({ cat, count });
      }
      irrelevant.sort((a, b) => b.count - a.count);
      if (irrelevant.length) {
        const top = irrelevant.slice(0, 5).map((x) => `"${x.cat}" (${x.count})`).join(", ");
        addTip(
          `Folgende Kategorien im Feed passen vermutlich nicht zum CHECK24-Möbelsortiment und sollten im Kategoriefilter angegeben werden: ${top}${irrelevant.length > 5 ? ` und ${irrelevant.length - 5} weitere` : ""}.`
        );
      }
    }

    score = Math.max(0, score);

    let shippingAllMissing = false;
    if (mapping.shipping_mode) {
      const col = mapping.shipping_mode;
      shippingAllMissing = rows.length > 0 && rows.every((r) => isBlank(r[col]));
      if (shippingAllMissing) {
        addIssue("Versandart ist für keinen Artikel befüllt.");
        addAllRows(criticalRowIdx);
        score -= 10;
      }
    }

    let deliveryAllMissing = false;
    if (mapping.delivery_includes) {
      const col = mapping.delivery_includes;
      deliveryAllMissing = rows.length > 0 && rows.every((r) => isBlank(r[col]));
      if (deliveryAllMissing) {
        addIssue("Lieferumfang ist für keinen Artikel befüllt.");
        addAllRows(criticalRowIdx);
        score -= 10;
      }
    }

    const canStart =
      score >= 50 &&
      requiredPresence.missing.length === 0 &&
      !!eanColumn;

    const criticalRowsCount = criticalRowIdx.size;
    const warningRowsCount = warningRowIdx.size;
    const criticalRowsPct = rows.length ? Math.round((criticalRowsCount / rows.length) * 1000) / 10 : 0;
    const warningRowsPct = rows.length ? Math.round((warningRowsCount / rows.length) * 1000) / 10 : 0;

    return {
      score,
      canStart,
      issues,
      tips,
      issueTargets,
      tipTargets,
      criticalRowsCount: criticalRowIdx.size,
      criticalRowsPct,
      warningRowsCount: warningRowIdx.size,
      warningRowsPct,
      criticalRowIndices: Array.from(criticalRowIdx),
      warningRowIndices: Array.from(warningRowIdx),
    };
  }, [
    headers,
    requiredPresence,
    duplicates,
    optionalFindings,
    imageColumns,
    imageMin,
    mapping,
    rows,
    eanColumn,
    titleColumn,
    brokenImageIds,
  ]);

  const emailText = useMemo(() => {
    if (!headers.length) return "";
    return buildEmail({ shopName, issues: summary.issues, tips: summary.tips, canStart: summary.canStart });
  }, [headers, shopName, summary]);

  const summaryVisual = useMemo(() => {
    const score = Number(summary?.score ?? 0);
    const band = score >= 75 ? "good" : score >= 50 ? "medium" : "low";
    const palette =
      band === "good"
        ? { border: "#A7F3D0", bg: "#ECFDF3", text: "#166534" }
        : band === "medium"
        ? { border: "#FCD34D", bg: "#FFFBEB", text: "#92400E" }
        : { border: "#FCA5A5", bg: "#FEF2F2", text: "#B91C1C" };
    const qualityLabel = score >= 80 ? "Sehr gut" : score >= 60 ? "Mittel" : "Kritisch";
    return { score, qualityLabel, ...palette };
  }, [summary]);

  const highlightedRowIndexSet = useMemo(() => {
    const set = new Set();
    highlightedCells.forEach((id) => {
      const rowIndex = Number(String(id).split(":")[0]);
      if (!Number.isNaN(rowIndex)) set.add(rowIndex);
    });
    return set;
  }, [highlightedCells]);

  const criticalRowIndexSet = useMemo(
    () => new Set(summary?.criticalRowIndices ?? []),
    [summary]
  );
  const warningRowIndexSet = useMemo(
    () => new Set(summary?.warningRowIndices ?? []),
    [summary]
  );
  const issueRowIndexSet = useMemo(
    () =>
      new Set([
        ...(summary?.criticalRowIndices ?? []),
        ...(summary?.warningRowIndices ?? []),
        ...Array.from(highlightedRowIndexSet),
      ]),
    [summary, highlightedRowIndexSet]
  );

  const affectedIssueEans = useMemo(() => {
    if (!headers.length || !eanColumn) return [];
    const s = new Set();
    const indices = [
      ...(summary?.criticalRowIndices ?? []),
      ...(summary?.warningRowIndices ?? []),
      ...Array.from(highlightedRowIndexSet),
    ];
    for (const idx of indices) {
      const v = String(rows[idx]?.[eanColumn] ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s);
  }, [headers.length, eanColumn, rows, summary, highlightedRowIndexSet]);

  const rowCriticalIssuesByIndex = useMemo(() => {
    const out = {};
    if (!headers.length || !eanColumn) return out;
    const criticalIdxs = criticalRowIndexSet;
    if (!criticalIdxs || criticalIdxs.size === 0) return out;

    const requiredLabelByKey = {
      ean: "EAN",
      seller_offer_id: "Seller_Offer_ID",
      name: "Name",
      material: "Material",
      color: "Farbe",
      delivery_includes: "Lieferumfang",
    };

    const imageZeroSet = new Set(optionalFindings.imageZeroEans || []);
    const brokenSet = new Set(brokenImageIds || []);
    const scientificSet = new Set(optionalFindings.scientificEans || []);
    const lightingMissingSet = new Set(optionalFindings.lightingEnergyMissing || []);
    const missingPriceSet = new Set(optionalFindings.missingEansByField?.price || []);
    const missingShippingSet = new Set(optionalFindings.missingShipping || []);
    const invalidShippingSet = new Set(
      (optionalFindings.invalidShipping || []).map((x) => String(x?.ean ?? "").trim()).filter(Boolean)
    );
    const invalidDeliveryIncludesSet = new Set(
      (optionalFindings.invalidDeliveryIncludes || []).map((x) => String(x?.ean ?? "").trim()).filter(Boolean)
    );
    const invalidDeliveryTimeSet = new Set(
      (optionalFindings.invalidDeliveryTime || []).map((x) => String(x?.ean ?? "").trim()).filter(Boolean)
    );
    const tooShortSet = new Set((optionalFindings.descriptionIssues?.tooShort || []).map((x) => String(x ?? "").trim()).filter(Boolean));
    const externalLinksSet = new Set((optionalFindings.descriptionIssues?.externalLinks || []).map((x) => String(x ?? "").trim()).filter(Boolean));

    for (const idx of criticalIdxs) {
      const ean = String(rows[idx]?.[eanColumn] ?? "").trim();
      const messages = [];

      for (const fieldKey of requiredFields) {
        const col = mapping[fieldKey];
        if (!col) continue;
        if (isBlank(rows[idx]?.[col])) {
          messages.push(`Pflichtfeld fehlt: ${requiredLabelByKey[fieldKey] || fieldKey}`);
        }
      }

      if (duplicates.eanDup?.has(idx)) messages.push("Doppelte EAN");
      if (duplicates.titleDup?.has(idx)) messages.push("Doppelter Produkttitel");

      if (ean) {
        if (missingPriceSet.has(ean)) messages.push("Preis fehlt");
        if (imageZeroSet.has(ean)) messages.push("Keine Bilder vorhanden");
        if (brokenSet.has(ean)) messages.push("Vorschaubild nicht ladbar");
        if (scientificSet.has(ean)) messages.push("EAN wirkt wissenschaftlich");
        if (lightingMissingSet.has(ean)) messages.push("Energieeffizienz-Angaben fehlen");
        if (missingShippingSet.has(ean)) messages.push("Versandart fehlt");
        if (invalidShippingSet.has(ean)) messages.push("Versandart ungültig");
        if (invalidDeliveryIncludesSet.has(ean)) messages.push("Lieferumfang-Format ungültig");
        if (invalidDeliveryTimeSet.has(ean)) messages.push("Lieferzeit ungültig");
        if (tooShortSet.has(ean)) messages.push("Beschreibung zu kurz");
        if (externalLinksSet.has(ean)) messages.push("Externe Links in der Beschreibung");
      }

      if (messages.length) out[idx] = messages;
    }

    return out;
  }, [
    headers.length,
    eanColumn,
    criticalRowIndexSet,
    rows,
    requiredFields,
    mapping,
    duplicates,
    optionalFindings,
    brokenImageIds,
  ]);

  const toggleIssueRowsOnly = () => {
    const next = !showIssueRowsOnly;
    if (next) {
      eanSearchBeforeIssueOnlyRef.current = eanSearch;

      const indices = [
        ...(summary?.criticalRowIndices ?? []),
        ...(summary?.warningRowIndices ?? []),
        ...Array.from(highlightedRowIndexSet),
      ];
      const maxIdx = indices.length ? Math.max(...indices) : null;
      if (maxIdx != null) setPreviewCount((c) => Math.max(c, maxIdx + 1));

      setEanSearch(affectedIssueEans.length ? affectedIssueEans.join(", ") : "");
      setShowIssueRowsOnly(true);
    } else {
      setShowIssueRowsOnly(false);
      setEanSearch(eanSearchBeforeIssueOnlyRef.current ?? "");
    }
  };

  const [step2Expanded, setStep2Expanded] = useState(false);
  const [mappingPreviewOpen, setMappingPreviewOpen] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const step6Ref = useRef(null);
  const previewTableRef = useRef(null);
  const [pendingJumpRowKey, setPendingJumpRowKey] = useState(null);
  const [highlightedJumpRowKey, setHighlightedJumpRowKey] = useState(null);
  const [highlightedColumnKey, setHighlightedColumnKey] = useState(null);

  const filteredPreviewRows = useMemo(() => {
    const hasSearch = eanSearchTerms.length > 0;
    const termsLower = hasSearch && !eanColumn ? eanSearchTerms.map((t) => t.toLowerCase()) : [];
    return rows.filter((r) => {
      if (showIssueRowsOnly && !issueRowIndexSet.has(r.__rowIndex)) return false;
      if (!hasSearch) return true;
      if (eanColumn) return eanSearchTerms.some((t) => String(r[eanColumn] ?? "").includes(t));
      return Object.values(r).some((v) => { const c = String(v ?? "").toLowerCase(); return termsLower.some((t) => c.includes(t)); });
    });
  }, [rows, eanSearchTerms, eanColumn, showIssueRowsOnly, issueRowIndexSet]);

  useEffect(() => {
    if (!headers.length) return;
    if (!allRequiredOk) setStep2Expanded(true);
  }, [allRequiredOk, headers.length]);

  useEffect(() => {
    if (highlightedJumpRowKey == null) return;
    const t = window.setTimeout(() => setHighlightedJumpRowKey(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlightedJumpRowKey]);

  useEffect(() => {
    if (highlightedColumnKey == null) return;
    const t = window.setTimeout(() => setHighlightedColumnKey(null), 4000);
    return () => window.clearTimeout(t);
  }, [highlightedColumnKey]);

  const jumpToIssueTarget = (target) => {
    if (!target) return;
    setShowIssueRowsOnly(false);
    const targetEans = Array.isArray(target.eans)
      ? target.eans
      : target.ean
        ? [target.ean]
        : [];
    setEanSearch(targetEans.length ? targetEans.join(", ") : "");

    const rowIndicesArr = Array.isArray(target.rowIndices)
      ? target.rowIndices
      : Number.isInteger(target.rowIndex)
        ? [target.rowIndex]
        : [];
    const targetFirstRowIndex = rowIndicesArr.length ? Math.min(...rowIndicesArr) : null;
    if (targetFirstRowIndex != null && targetFirstRowIndex >= 0) {
      const rowKey = String(targetFirstRowIndex);
      setPendingJumpRowKey(rowKey);
      setHighlightedJumpRowKey(rowKey);
    }

    previewTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Auto-filter columns to show EAN + name + the problem column
    if (target.column) {
      const cols = [eanColumn, titleColumn, target.column].filter(Boolean);
      const unique = [...new Set(cols)];
      setVisibleColumns(unique);
      setHighlightedColumnKey(target.column);
      setTimeout(() => {
        const th = previewTableRef.current?.querySelector(`th[data-col="${CSS.escape(target.column)}"]`);
        if (th) th.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }, 300);
    } else {
      setHighlightedColumnKey(null);
    }
  };

  function onPickFile(file) {
    setParseError("");
    setParseWarnings([]);
    setFileName(file?.name || "");
    setEanSearch("");
    setRawRows([]);
    setHeaders([]);
    setManualMapping({});
    setBrokenImageIds([]);
    setGeneratedEmail(null);
    setEmailContent("");
    setEmailSubject("");
    setEditingEmail(false);

    if (!file) return;
    setParsing(true);

    const name = (file.name || "").toLowerCase();
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");

    if (isXlsx) {
      // Parse Excel workbook via SheetJS
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = evt.target?.result;
          if (!data) { setParseError("Datei konnte nicht gelesen werden."); setParsing(false); return; }
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) { setParseError("Excel-Datei enthält keine Tabellenblätter."); setParsing(false); return; }
          const sheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
          const h = json.length ? Object.keys(json[0]) : [];
          setHeaders(h);
          setRawRows(json);
          setParsing(false);
        } catch (err) {
          setParseError(String(err?.message || err || "Excel-Datei konnte nicht gelesen werden."));
          setParsing(false);
        }
      };
      reader.onerror = () => { setParseError("Datei konnte nicht gelesen werden."); setParsing(false); };
      reader.readAsArrayBuffer(file);
      return;
    }

    // Try reading with UTF-8 first; if garbled German chars detected, retry with Windows-1252
    const tryParse = (encoding) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result;
        if (typeof text !== "string") return;
        // Detect garbled German umlauts (UTF-8 misread of Windows-1252)
        if (encoding === "UTF-8" && /\u00c3\u00a4|\u00c3\u00b6|\u00c3\u00bc|\u00c3\u0084|\u00c3\u0096|\u00c3\u009c|\u00c3\u009f|\u00c3\u00a9/.test(text)) {
          tryParse("windows-1252");
          return;
        }
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          relaxColumnCount: true,
          complete: (res) => {
            const errs = res.errors || [];
            const fatalErrs = errs.filter((e) => e.type !== "FieldMismatch");
            const fieldErrs = errs.filter((e) => e.type === "FieldMismatch");
            if (fatalErrs.length) { setParseError(fatalErrs[0]?.message || "CSV parsing error"); setParsing(false); return; }
            const warns = [];
            if (fieldErrs.length > 0) warns.push(`${fieldErrs.length} Zeile${fieldErrs.length === 1 ? "" : "n"} haben mehr Felder als die Kopfzeile — diese Zeilen werden trotzdem geprüft.`);
            const data = Array.isArray(res.data) ? res.data : [];
            const h = res.meta?.fields || Object.keys(data[0] || {});
            // Two-header-row detection: check if first data row looks like column headers
            if (data.length > 0) {
              const KNOWN_COL_WORDS = new Set(["ean","gtin","gtin14","barcode","price","preis","name","title","titel","description","beschreibung","brand","marke","material","farbe","color","image_url","image","bild","delivery_time","lieferzeit","delivery_includes","lieferumfang","availability","stock_amount","category","category_path"]);
              const firstRowVals = Object.values(data[0]).map((v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, ""));
              const matches = firstRowVals.filter((v) => v && KNOWN_COL_WORDS.has(v)).length;
              if (matches >= 3) warns.push("Zeile 1 scheint eine Datei-Überschrift zu enthalten — die Spaltenbezeichner stehen möglicherweise in Zeile 2. Bitte Zeile 1 entfernen und erneut hochladen.");
            }
            setParseWarnings(warns);
            setHeaders(h);
            setRawRows(data);
            setParsing(false);
          },
          error: (err) => { setParseError(String(err || "CSV parsing error")); setParsing(false); },
        });
      };
      reader.onerror = () => setParseError("Datei konnte nicht gelesen werden.");
      reader.readAsText(file, encoding);
    };
    tryParse("UTF-8");
  }

  const jumpToEanWithColumn = (ean, col) => {
    jumpToIssueTarget({
      ean,
      rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
      column: col || null,
    });
  };

  const resetPreview = () => {
    setVisibleColumns(null);
    setEanSearch("");
    setShowIssueRowsOnly(false);
  };

  // ── Step 7 preview JSX (shared between inline and fullscreen) ──────────────
  const step7Inner = (
    <>
    <div style={{ marginTop: 0, position: "sticky", top: 0, zIndex: 20, background: "#FFFFFF", padding: "8px 0 8px", borderBottom: "1px solid #E5E7EB" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>Suche</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          value={eanSearch}
          onChange={(e) => setEanSearch(e.target.value)}
          placeholder="EANs mit Komma trennen (z.B. 123,456) um passende Zeilen zu filtern"
          style={{
            flex: "1 1 0",
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 999,
            border: "1px solid #E5E7EB",
            fontSize: 12,
            boxSizing: "border-box",
          }}
        />
        {eanSearch && (
          <button
            type="button"
            onClick={() => setEanSearch("")}
            title="Filter löschen"
            style={{ padding: "6px 9px", borderRadius: 999, border: "1px solid #D1D5DB", background: "#FFF", fontSize: 13, cursor: "pointer", color: "#6B7280", lineHeight: 1, flexShrink: 0 }}
          >×</button>
        )}
        <button
          type="button"
          onClick={() => setColumnFilterOpen((v) => !v)}
          aria-label="Spalten wählen"
          title="Spalten ein-/ausblenden"
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: columnFilterOpen ? `1px solid ${BRAND_COLOR}` : "1px solid #D1D5DB",
            background: columnFilterOpen ? BRAND_COLOR : "#FFF",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            color: columnFilterOpen ? "#FFF" : "#374151",
            display: "flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
        >
          Spalten {Array.isArray(visibleColumns) ? `(${visibleColumns.length}/${headers.length})` : `(${headers.length})`}
        </button>
        {Array.isArray(visibleColumns) && visibleColumns.length < headers.length && (
          <button type="button" onClick={resetPreview}
            style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#374151", whiteSpace: "nowrap" }}>
            Ansicht zurücksetzen
          </button>
        )}
        <button
          type="button"
          onClick={toggleIssueRowsOnly}
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #E5E7EB",
            background: showIssueRowsOnly ? "#FEF3C7" : "#FFFFFF",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            color: "#92400E",
            whiteSpace: "nowrap",
          }}
        >
          {showIssueRowsOnly ? "Alle Zeilen zeigen" : "Nur Zeilen mit Auffälligkeiten"}
        </button>
        <button
          type="button"
          onClick={() => setPreviewFullscreen(true)}
          style={{
            padding: "6px 12px",
            borderRadius: 999,
            border: `1px solid ${BRAND_COLOR}`,
            background: "#FFFFFF",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            color: BRAND_COLOR,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Vorschau maximieren
        </button>
      </div>
      {columnFilterOpen && headers.length > 0 ? (
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>Sichtbare Spalten</div>
            <button
              type="button"
              onClick={() => {
                setVisibleColumns((prev) => {
                  const allSelected = !Array.isArray(prev) || prev.length === headers.length;
                  return allSelected ? [] : null;
                });
              }}
              style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", fontSize: 10, fontWeight: 600, cursor: "pointer", color: "#374151" }}
            >
              {(!Array.isArray(visibleColumns) || visibleColumns.length === headers.length) ? "Keine" : "Alle"}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 160, overflow: "auto" }}>
            {headers.map((h) => {
              const isActive = !Array.isArray(visibleColumns) || visibleColumns.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setVisibleColumns((prev) => {
                      const current = Array.isArray(prev) ? new Set(prev) : new Set(headers);
                      if (isActive) { current.delete(h); } else { current.add(h); }
                      const next = Array.from(current);
                      return next.length === headers.length ? null : next;
                    });
                  }}
                  style={{
                    padding: "4px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
                    border: isActive ? `1px solid ${BRAND_COLOR}` : "1px solid #E5E7EB",
                    background: isActive ? "#EEF4FF" : "#F9FAFB",
                    color: isActive ? BRAND_COLOR : "#9CA3AF",
                  }}
                >
                  {String(h)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
    <div ref={previewTableRef} style={{ marginTop: 8 }}>
      <ResizableTable
        columns={previewColumns}
        rows={filteredPreviewRows}
        criticalRowIndexSet={criticalRowIndexSet}
        rowCriticalIssuesByIndex={rowCriticalIssuesByIndex}
        getRowTargetKey={(r) => r.__rowIndex}
        targetRowKey={pendingJumpRowKey}
        highlightedRowKey={highlightedJumpRowKey}
        highlightedColumnKey={highlightedColumnKey}
        onTargetHandled={() => setPendingJumpRowKey(null)}
      />
      <div style={{ marginTop: 8 }}>
        <SmallText>{filteredPreviewRows.length} Zeilen</SmallText>
      </div>
    </div>
    </>
  );

  function FeedPreviewPanel({ headers, children }) {
    if (!headers.length) return null;
    return (
      <div
        style={{
          flex: "1 1 0",
          minWidth: 0,
          maxHeight: "100%",
          overflow: "auto",
          background: "#FFFFFF",
          padding: "10px 12px",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    );
  }

  const NAV_ITEMS = [
    { id: "feed-analyse",         label: "Feed Analyse",       icon: "🔍" },
    { id: "ergebnistabelle",      label: "Ergebnistabelle",    icon: "📊" },
    { id: "checker-mc",           label: "Merchant Center Prototype", icon: "🏪" },
  ];

  const topNav = (
    <div style={{ background: "#1553B6", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
      {/* Main header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 52 }}>
        {/* Logo */}
        <button
          type="button"
          onClick={() => { window.location.hash = "#/checker"; }}
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
          aria-label="Feed Checker Startseite"
        >
          <span style={{ color: "#FFFFFF", fontWeight: 900, fontSize: 20, letterSpacing: "-0.5px", fontFamily: "ui-sans-serif, system-ui", fontStyle: "italic" }}>FEED CHECKER</span>
          <span style={{ color: "#A8C4E0", fontSize: 10, fontWeight: 400, marginLeft: 6 }}>v1.0.1</span>
        </button>

      </div>

      {/* Nav tab row */}
      <div style={{ display: "flex", alignItems: "flex-end", padding: "0 16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        {NAV_ITEMS.map((item) => {
          const active = route === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { window.location.hash = `#/${item.id}`; }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px",
                border: "none",
                borderBottom: active ? "3px solid #FFFFFF" : "3px solid transparent",
                background: "transparent",
                color: active ? "#FFFFFF" : "#A8C4E0",
                fontSize: 13,
                fontWeight: active ? 700 : 400,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "color 0.15s, border-color 0.15s",
                letterSpacing: "0.01em",
              }}
            >
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const page = (
    <div
      style={{
        height: "100%",
        overflow: "hidden",
        fontFamily: "ui-sans-serif, system-ui",
        boxSizing: "border-box",
        background: "#F3F4F6",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* topNav already rendered above, this is the content area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: headers.length ? "none" : 1000,
            padding: headers.length ? "0 12px 12px" : 24,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {/* ── Two-column layout once a file is loaded ── */}
          <div
            style={{
              marginTop: 18,
              display: headers.length ? "flex" : "block",
              gap: headers.length ? 16 : 14,
              alignItems: "flex-start",
              height: headers.length ? "calc(100vh - 24px - 48px)" : "auto", // approx: full height minus padding+header
            }}
          >
            {/* ── LEFT: Summary + Steps 1–5 ── */}
            <div
              style={{
                flex: headers.length ? "1 1 0" : "auto",
                maxWidth: "none",
                maxHeight: headers.length ? "100%" : "none",
                overflowY: headers.length ? "auto" : "visible",
                paddingRight: headers.length ? 4 : 0,
              }}
            >
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>

            {/* UPLOAD */}
            <StepCard title="Datei hochladen" status={headers.length ? "ok" : "idle"} subtitle="">
              <div
                onDragOver={(e) => { e.preventDefault(); setFeedDragging(true); }}
                onDragEnter={(e) => { e.preventDefault(); setFeedDragging(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFeedDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setFeedDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onPickFile(f); }}
                onClick={() => fileInputRef.current?.click()}
                style={{ marginTop: 8, background: feedDragging ? "#EEF4FF" : "#F9FAFB", border: `2px dashed ${feedDragging ? BRAND_COLOR : "#D1D5DB"}`, borderRadius: 8, padding: "18px 16px", textAlign: "center", cursor: "pointer", transition: "background 0.15s, border-color 0.15s" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: feedDragging ? BRAND_COLOR : "#111827", marginBottom: 3 }}>
                  {feedDragging ? "Datei loslassen zum Hochladen" : "Datei hierher ziehen oder klicken"}
                </div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>
                  {fileName ? `Aktuelle Datei: ${fileName}` : "CSV, XLSX oder XLS"}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => onPickFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
              </div>
              {parseError ? <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>Fehler beim Einlesen {parseError}</div> : null}
              {parseWarnings.map((w, i) => (
                <div key={i} style={{ marginTop: 8, padding: "7px 10px", borderRadius: 6, background: "#FEF9C3", border: "1px solid #FDE047", color: "#854D0E", fontSize: 12 }}>⚠️ {w}</div>
              ))}
              {parsing && <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, color: BRAND_COLOR, fontSize: 13, fontWeight: 600 }}><Spinner /> Datei wird analysiert...</div>}
            </StepCard>

            {/* Mode Toggle */}
            {headers.length ? (
              <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #D1D5DB" }}>
                <button
                  onClick={() => { setPageMode("feed-checker"); setGeneratedEmail(null); setEmailContent(""); setEmailSubject(""); setEditingEmail(false); }}
                  style={{
                    flex: 1, padding: "9px 0", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: pageMode === "feed-checker" ? BRAND_COLOR : "#FFF",
                    color: pageMode === "feed-checker" ? "#FFF" : "#374151",
                  }}
                >
                  🔍 Feed Checker
                </button>
                <button
                  onClick={() => { setPageMode("qs-apa"); setGeneratedEmail(null); setEmailContent(""); setEmailSubject(""); setEditingEmail(false); }}
                  style={{
                    flex: 1, padding: "9px 0", border: "none", borderLeft: "1px solid #D1D5DB", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: pageMode === "qs-apa" ? BRAND_COLOR : "#FFF",
                    color: pageMode === "qs-apa" ? "#FFF" : "#374151",
                  }}
                >
                  📊 Content Scoring
                </button>
              </div>
            ) : null}

            {/* QS/APA Mode */}
            {pageMode === "qs-apa" && headers.length ? (
              <QsPage headers={headers} rows={rows} />
            ) : null}

            {/* Feed Checker Mode */}
            {pageMode === "feed-checker" && headers.length ? (
              <>
            {/* Wrong-file rejection banner */}
            {isWrongFile && (
              <div style={{ padding: "16px 18px", borderRadius: 10, border: "1px solid #FECACA", background: "#FEF2F2", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#B91C1C", marginBottom: 4 }}>Diese Datei sieht nicht wie ein gültiger Produkt-Feed aus.</div>
                  <div style={{ fontSize: 12, color: "#7F1D1D", lineHeight: "1.6" }}>
                    Es konnten keine bekannten Spalten erkannt werden. Bitte prüfen Sie, ob Sie die richtige Datei hochgeladen haben.
                    Erwartete Spalten sind z.&nbsp;B. <code>ean</code>, <code>name</code>, <code>price</code>, <code>shipping_mode</code> o.&nbsp;ä.
                  </div>
                </div>
              </div>
            )}
            {/* SUMMARY */}
            <div ref={step6Ref}>
              <StepCard
                title="Zusammenfassung und Entscheidung"
                status="idle"
              >
            
                {headers.length ? (
                  <>
                    <div
                      style={{
                        marginTop: 2,
                        padding: 10,
                        borderRadius: 8,
                        border: `1px solid ${summaryVisual.border}`,
                        background: summaryVisual.bg,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Pill tone={summary.canStart ? "ok" : "warn"}>
                          {summary.canStart ? "Fehlerfrei" : "Fehler vorhanden"}
                        </Pill>
                        <Pill tone="info">Score {summary.score} / 100</Pill>
                        {summary.issues.length ? (
                          <div style={{ fontSize: 12, color: "#6B7280", lineHeight: "18px", whiteSpace: "nowrap" }}>
                            {summary.issues.length} kritische Punkte gefunden.
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#6B7280", lineHeight: "18px", whiteSpace: "nowrap" }}>
                            Keine kritischen Fehler erkannt.
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#B91C1C" }}>Kritische Fehler</div>
                        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2, lineHeight: "16px" }}>
                          Betroffene Zeilen: {summary.criticalRowsCount ?? 0} von {rows.length} ({summary.criticalRowsPct ?? 0}%)
                        </div>
                        <ul style={{ marginTop: 2, paddingLeft: 16, fontSize: 12, color: "#111827", lineHeight: "18px" }}>
                          {summary.issues.length ? (
                            summary.issues.map((x, idx) => {
                              const target = summary.issueTargets?.[idx];
                              return (
                                <li key={idx}>
                                  {target ? (
                                    <button
                                      type="button"
                                      onClick={() => jumpToIssueTarget(target)}
                                      style={{
                                        border: "none",
                                        background: "transparent",
                                        padding: 0,
                                        margin: 0,
                                        color: "#111827",
                                        textDecoration: "underline",
                                        cursor: "pointer",
                                        fontSize: 12,
                                        textAlign: "left",
                                      }}
                                    >
                                      {x}
                                    </button>
                                  ) : (
                                    x
                                  )}
                                </li>
                              );
                            })
                          ) : (
                            <li>Keine kritischen Fehler erkannt.</li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#0369A1" }}>Warnungen</div>
                        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2, lineHeight: "16px" }}>
                          Betroffene Zeilen: {summary.warningRowsCount ?? 0} von {rows.length} ({summary.warningRowsPct ?? 0}%)
                        </div>
                        <ul style={{ marginTop: 2, paddingLeft: 16, fontSize: 12, color: "#111827", lineHeight: "18px" }}>
                          {(summary.tips.length ? summary.tips : ["Keine weiteren Empfehlungen."]).map((x, idx) => {
                            const tipTarget = summary.tipTargets?.[idx];
                            return (
                              <li key={idx}>
                                {tipTarget ? (
                                  <button
                                    type="button"
                                    onClick={() => jumpToIssueTarget(tipTarget)}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      padding: 0,
                                      margin: 0,
                                      color: "#111827",
                                      textDecoration: "underline",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      textAlign: "left",
                                    }}
                                  >
                                    {x}
                                  </button>
                                ) : (
                                  x
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>

                    {!generatedEmail && (
                      <button
                        onClick={() => {
                          const email = buildEmail({ shopName: "", issues: summary.issues, tips: summary.tips, canStart: summary.canStart });
                          setGeneratedEmail(email);
                          setEmailSubject(email.subject);
                          setEmailContent(email.body);
                        }}
                        style={{ marginTop: 12, padding: "10px 16px", borderRadius: 6, border: `1px solid ${BRAND_COLOR}`, background: "#FFF", color: BRAND_COLOR, fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%" }}
                      >
                        E-Mail generieren
                      </button>
                    )}
                    {generatedEmail && (
                      <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>E-Mail</div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => { setEmailSubject(generatedEmail.subject); setEmailContent(generatedEmail.body); }}
                              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", color: "#111827", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Zurücksetzen</button>
                            <button onClick={() => { setGeneratedEmail(null); setEmailContent(""); setEmailSubject(""); }}
                              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", color: "#111827", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Schließen</button>
                          </div>
                        </div>
                        {/* Subject */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280" }}>Betreff</div>
                            <button onClick={() => { navigator.clipboard.writeText(emailSubject).catch(() => {}); }}
                              style={{ padding: "2px 8px", borderRadius: 4, background: "#10B981", color: "#FFF", border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Kopieren</button>
                          </div>
                          <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)}
                            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 12, color: "#111827", boxSizing: "border-box" }} />
                        </div>
                        {/* Body */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#6B7280" }}>Nachricht</div>
                            <button onClick={() => { navigator.clipboard.writeText(emailContent).catch(() => {}); }}
                              style={{ padding: "2px 8px", borderRadius: 4, background: "#10B981", color: "#FFF", border: "none", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Kopieren</button>
                          </div>
                          <textarea value={emailContent} onChange={(e) => setEmailContent(e.target.value)}
                            style={{ width: "100%", minHeight: 220, padding: 10, borderRadius: 6, border: "1px solid #D1D5DB", fontFamily: "ui-sans-serif, system-ui", fontSize: 12, color: "#111827", boxSizing: "border-box", lineHeight: "18px", resize: "vertical" }} />
                        </div>
                      </div>
                    )}

                    {/* CSV Download */}
                    <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Ergebnisse als CSV exportieren</div>
                          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>Alle Zeilen mit Fehlern und Warnungen inkl. EAN, Offer ID, Name und Grund.</div>
                        </div>
                        <button
                          disabled={csvExporting}
                          onClick={async () => {
                            setCsvExporting(true);
                            setCsvProgress(0);
                            // Use setTimeout to let UI update
                            await new Promise((r) => setTimeout(r, 50));

                            const sellerCol = mapping.seller_offer_id;
                            const nameCol = mapping.name;
                            const missingMaterialSet = new Set(optionalFindings.missingEansByField?.material || []);
                            const missingColorSet = new Set(optionalFindings.missingEansByField?.color || []);
                            const missingDeliverySet = new Set(optionalFindings.missingEansByField?.delivery_includes || []);
                            const imageOneSet = new Set(optionalFindings.imageOneEans || []);
                            const imageLowSet = new Set(optionalFindings.imageLowEans || []);
                            const templateSet = new Set((optionalFindings.descriptionIssues?.templateLike || []).map((x) => String(x ?? "").trim()));
                            const invalidMatSet = new Set((optionalFindings.invalidMaterial || []).map((x) => String(x?.ean ?? "").trim()));
                            const invalidColSet = new Set((optionalFindings.invalidColor || []).map((x) => String(x?.ean ?? "").trim()));

                            const csvRows = [];
                            const total = rows.length;
                            const batchSize = 500;
                            for (let start = 0; start < total; start += batchSize) {
                              const end = Math.min(start + batchSize, total);
                              for (let idx = start; idx < end; idx++) {
                                const r = rows[idx];
                                const ean = eanColumn ? String(r[eanColumn] ?? "").trim() : "";
                                const sellerId = sellerCol ? String(r[sellerCol] ?? "").trim() : "";
                                const name = nameCol ? String(r[nameCol] ?? "").trim() : "";
                                const reasons = [];
                                if (rowCriticalIssuesByIndex[idx]) reasons.push(...rowCriticalIssuesByIndex[idx]);
                                if (ean) {
                                  if (missingMaterialSet.has(ean)) reasons.push("Material fehlt");
                                  if (missingColorSet.has(ean)) reasons.push("Farbe fehlt");
                                  if (missingDeliverySet.has(ean)) reasons.push("Lieferumfang fehlt");
                                  if (imageOneSet.has(ean) || imageLowSet.has(ean)) reasons.push("Zu wenig Bilder");
                                  if (templateSet.has(ean)) reasons.push("Beschreibung wirkt wie Platzhalter");
                                  if (invalidMatSet.has(ean)) reasons.push("Material ungültig");
                                  if (invalidColSet.has(ean)) reasons.push("Farbe ungültig");
                                }
                                if (duplicates.sellerDup?.has(idx)) reasons.push("Doppelte Offer ID");
                                const unique = [...new Set(reasons)];
                                if (unique.length) csvRows.push({ ean, sellerId, name, reasons: unique.join("; ") });
                              }
                              setCsvProgress(Math.round((end / total) * 100));
                              await new Promise((r) => setTimeout(r, 0));
                            }

                            const header = "EAN;Offer_ID;Name;Grund";
                            const lines = csvRows.map((r) => `"${r.ean}";"${r.sellerId}";"${r.name.replace(/"/g, '""')}";"${r.reasons}"`);
                            const csv = [header, ...lines].join("\n");
                            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `feed-checker-ergebnisse-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                            setCsvExporting(false);
                          }}
                          style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#16A34A", color: "#FFF", fontSize: 13, fontWeight: 600, cursor: csvExporting ? "not-allowed" : "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}
                        >
                          {csvExporting ? <><Spinner size={14} color="#FFF" /> Exportiere...</> : "CSV herunterladen"}
                        </button>
                      </div>
                      {csvExporting && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ height: 6, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: 3, background: "#16A34A", width: `${csvProgress}%`, transition: "width 0.2s" }} />
                          </div>
                          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>{csvProgress}% analysiert ({rows.length} Zeilen)</div>
                        </div>
                      )}
                    </div>

                  </>
                ) : null}
              </StepCard>
            </div>

            {/* STEP 2 */}
            {(showAllChecks || stage1Status !== "ok") && (
            <StepCard title="Spalten und Pflichtfelder" status={stage1Status} subtitle="Wir prüfen, ob Pflichtinformationen vorhanden sind oder zugeordnet werden können">
              {!headers.length ? (
                <SmallText>Bitte CSV hochladen um die erkannten Spalten zu sehen.</SmallText>
              ) : (
                <>
                  {/* Step 2 status bar */}
                  <div
                    style={{
                      marginTop: 10,
                      padding: 8,
                      borderRadius: 10,
                      border: `1px solid ${allRequiredOk ? "#A7F3D0" : "#FCD34D"}`,
                      background: allRequiredOk ? "#ECFDF3" : "#FFFBEB",
                      fontSize: 12,
                      color: allRequiredOk ? "#166534" : "#92400E",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      {allRequiredOk
                        ? "Alle Pflichtfelder wurden korrekt zugeordnet."
                        : `Es fehlen noch ${requiredPresence.missing.length} von ${requiredFields.length} Pflichtfeldern.`}
                    </span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {/* Compact mapping preview button */}
                      <button
                        type="button"
                        onClick={() => setMappingPreviewOpen((v) => !v)}
                        style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${allRequiredOk ? "rgba(22,101,52,0.25)" : "rgba(146,64,14,0.25)"}`, background: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {(() => {
                          const total = requiredFields.length + optionalFields.length;
                          const found = [...requiredFields, ...optionalFields].filter((f) => mapping[f]).length;
                          return `${found}/${total} Spalten ${mappingPreviewOpen ? "▲" : "▼"}`;
                        })()}
                      </button>
                      {/* Full edit button */}
                      <button
                        type="button"
                        onClick={() => setStep2Expanded((v) => !v)}
                        style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${allRequiredOk ? "rgba(22,101,52,0.25)" : "rgba(146,64,14,0.25)"}`, background: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {step2Expanded ? "Bearbeiten schließen" : "Bearbeiten"}
                      </button>
                    </div>
                  </div>

                  {/* Compact mapping preview – quick read-only overview */}
                  {mappingPreviewOpen && (
                    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FAFAFA" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px" }}>
                        {[...requiredFields, ...optionalFields].map((f) => {
                          const col = mapping[f];
                          const isManual = f in manualMapping;
                          const isContent = !autoMapping[f] && !!contentMapping[f] && !isManual;
                          const missing = !col && requiredFields.includes(f);
                          return (
                            <div key={f} style={{ display: "flex", alignItems: "baseline", gap: 4, fontSize: 11, lineHeight: "20px", overflow: "hidden" }}>
                              <span style={{ color: "#6B7280", flexShrink: 0 }}>{f}</span>
                              <span style={{ color: "#9CA3AF", flexShrink: 0 }}>→</span>
                              <span
                                style={{
                                  fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  color: missing ? "#DC2626" : isManual ? "#7C3AED" : isContent ? "#1D4ED8" : "#166534",
                                }}
                                title={col || "nicht gefunden"}
                              >
                                {col || "–"}
                              </span>
                              {isManual && <span style={{ fontSize: 9, color: "#7C3AED", flexShrink: 0 }}>M</span>}
                              {isContent && <span style={{ fontSize: 9, color: "#1D4ED8", flexShrink: 0 }}>I</span>}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 10, color: "#9CA3AF" }}>
                        Farben: <span style={{ color: "#166534" }}>■</span> Auto &nbsp;
                        <span style={{ color: "#1D4ED8" }}>■</span> Inhalt erkannt &nbsp;
                        <span style={{ color: "#7C3AED" }}>■</span> Manuell &nbsp;
                        <span style={{ color: "#DC2626" }}>■</span> Fehlt
                      </div>
                    </div>
                  )}

                  {(!allRequiredOk || step2Expanded) && (
                    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                      <div>
                        <SmallText>Gefundene Spalten {headers.length}. Pflicht sind nur <code>ean (GTIN14)</code>, <code>seller_offer_id</code> und <code>name</code>. Alle anderen Felder sind optional.</SmallText>
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: "100%" }}>
                          {headers.slice(0, 20).map((h) => (
                            <span key={String(h)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", color: "#111827", wordBreak: "break-all", maxWidth: "100%" }}>{String(h)}</span>
                          ))}
                        </div>
                        {headers.length > 20 ? (
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: "pointer", fontSize: 11, color: "#4B5563" }}>Weitere Spalten anzeigen ({headers.length - 20} weitere)</summary>
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: "100%" }}>
                              {headers.slice(20).map((h) => (
                                <span key={String(h)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", color: "#111827", wordBreak: "break-all", maxWidth: "100%" }}>{String(h)}</span>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>

                      <div style={{ padding: 8, borderRadius: 12, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Pflichtfelder</div>
                        <SmallText>Diese Felder müssen für jeden Artikel erkannt werden. Falsch erkannte Spalten können manuell korrigiert werden.</SmallText>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {requiredFields.map((f) => {
                            const isManual = f in manualMapping;
                            const isContent = !autoMapping[f] && !!contentMapping[f] && !isManual;
                            const col = mapping[f];
                            const missing = !col;
                            const rowBg = missing ? "#FEF3C7" : isManual ? "#F5F3FF" : isContent ? "#EFF6FF" : "#ECFDF3";
                            const rowBorder = missing ? "#FCD34D" : isManual ? "#C4B5FD" : isContent ? "#BFDBFE" : "#A7F3D0";
                            return (
                              <div key={f} style={{ padding: "8px 10px", borderRadius: 10, border: `1px solid ${rowBorder}`, background: rowBg }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{f}</span>
                                    {isManual && <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", padding: "1px 6px", borderRadius: 999 }}>Manuell</span>}
                                    {isContent && <span style={{ fontSize: 10, fontWeight: 700, color: "#1D4ED8", background: "#DBEAFE", padding: "1px 6px", borderRadius: 999 }}>Inhalt erkannt</span>}
                                  </div>
                                  <Pill tone={missing ? "warn" : "ok"}>{missing ? "Fehlt" : "OK"}</Pill>
                                </div>
                                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <select
                                    value={col || ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setManualMapping((prev) => {
                                        const next = { ...prev };
                                        if (val === "") delete next[f];
                                        else next[f] = val;
                                        return next;
                                      });
                                    }}
                                    style={{ flex: 1, minWidth: 120, fontSize: 12, padding: "4px 8px", borderRadius: 6, border: `1px solid ${missing ? "#FCA5A5" : "#D1D5DB"}`, background: "#FFF", color: "#111827", cursor: "pointer" }}
                                  >
                                    <option value="">-- Nicht zugeordnet --</option>
                                    {headers.map((h) => (
                                      <option key={h} value={h}>{h}</option>
                                    ))}
                                  </select>
                                  {isManual && (
                                    <button
                                      type="button"
                                      onClick={() => setManualMapping((prev) => { const next = { ...prev }; delete next[f]; return next; })}
                                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #C4B5FD", background: "#FFF", color: "#7C3AED", cursor: "pointer", whiteSpace: "nowrap" }}
                                    >
                                      Zurücksetzen
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: requiredPresence.missing.length ? "#92400E" : "#166534" }}>
                          {requiredPresence.missing.length
                            ? `Noch ${requiredPresence.missing.length} von ${requiredFields.length} Pflichtfeldern ohne Zuordnung.`
                            : `Alle ${requiredFields.length} Pflichtfelder zugeordnet.`}
                        </div>
                      </div>

                      <div style={{ padding: 8, borderRadius: 12, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Optionale Felder</div>
                        <SmallText>Diese Felder sind nicht zwingend, verbessern aber Qualität und Score. Falsch erkannte Spalten können manuell korrigiert werden.</SmallText>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {optionalFields.map((f) => {
                            const isManual = f in manualMapping;
                            const isContent = !autoMapping[f] && !!contentMapping[f] && !isManual;
                            const col = mapping[f];
                            const missing = !col;
                            const rowBg = missing ? "#F9FAFB" : isManual ? "#F5F3FF" : isContent ? "#EFF6FF" : "#EEF2FF";
                            const rowBorder = missing ? "#E5E7EB" : isManual ? "#C4B5FD" : isContent ? "#BFDBFE" : "#C7D2FE";
                            return (
                              <div key={f} style={{ padding: "8px 10px", borderRadius: 10, border: `1px solid ${rowBorder}`, background: rowBg }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{f}</span>
                                    {isManual && <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED", background: "#EDE9FE", padding: "1px 6px", borderRadius: 999 }}>Manuell</span>}
                                    {isContent && <span style={{ fontSize: 10, fontWeight: 700, color: "#1D4ED8", background: "#DBEAFE", padding: "1px 6px", borderRadius: 999 }}>Inhalt erkannt</span>}
                                  </div>
                                  <Pill tone={missing ? "info" : "ok"}>{missing ? "Optional" : "OK"}</Pill>
                                </div>
                                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <select
                                    value={col || ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setManualMapping((prev) => {
                                        const next = { ...prev };
                                        if (val === "") delete next[f];
                                        else next[f] = val;
                                        return next;
                                      });
                                    }}
                                    style={{ flex: 1, minWidth: 120, fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", color: "#111827", cursor: "pointer" }}
                                  >
                                    <option value="">-- Nicht zugeordnet --</option>
                                    {headers.map((h) => (
                                      <option key={h} value={h}>{h}</option>
                                    ))}
                                  </select>
                                  {isManual && (
                                    <button
                                      type="button"
                                      onClick={() => setManualMapping((prev) => { const next = { ...prev }; delete next[f]; return next; })}
                                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1px solid #C4B5FD", background: "#FFF", color: "#7C3AED", cursor: "pointer", whiteSpace: "nowrap" }}
                                    >
                                      Zurücksetzen
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: "#4B5563" }}>
                          {optionalFields.length
                            ? `${optionalPresence.found.length} von ${optionalFields.length} optionalen Feldern zugeordnet.`
                            : "Keine optionalen Felder konfiguriert."}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </StepCard>
            )}

            {/* STEP 3 */}
            {(showAllChecks || stage2Status !== "ok") && (
            <StepCard title="Duplikate erkennen" status={stage2Status} subtitle="Wir prüfen doppelte EAN, Produkttitel und Offer IDs">
              {!headers.length ? (
                <SmallText>Bitte CSV hochladen, um Duplikate zu prüfen.</SmallText>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                      { label: "EAN", hasDups: duplicateEans.length > 0, found: !!eanColumn },
                      { label: "Titel", hasDups: duplicateTitleRows.length > 0, found: !!titleColumn },
                      { label: "Offer ID", hasDups: duplicateSellerOfferIds.length > 0, found: !!sellerColumn },
                    ].map((t) => {
                      const ok = t.found && !t.hasDups;
                      const bad = t.found && t.hasDups;
                      return (
                        <div
                          key={t.label}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "6px 12px", borderRadius: 999,
                            fontSize: 12, fontWeight: 600,
                            border: `1px solid ${bad ? "#FCA5A5" : ok ? "#A7F3D0" : "#E5E7EB"}`,
                            background: bad ? "#FEF2F2" : ok ? "#ECFDF5" : "#F9FAFB",
                            color: bad ? "#B91C1C" : ok ? "#047857" : "#6B7280",
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{bad ? "✕" : ok ? "✓" : "–"}</span>
                          {t.label}
                        </div>
                      );
                    })}
                  </div>

                  {duplicateEans.length > 0 || duplicateTitleRows.length > 0 || duplicateSellerOfferIds.length > 0 ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      {duplicateEans.length > 0 && (
                        <CollapsibleList title="Doppelte EAN" items={duplicateEans} tone="warn" />
                      )}
                      {duplicateTitleRows.length > 0 && (
                        <CollapsibleList
                          title="Doppelte Titel"
                          items={groupByValueWithEans(duplicateTitleRows.map((x) => ({ value: x.title, ean: x.ean })))
                            .filter((g) => !eanSearchTerms.length || g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t))))
                            .map((g) => `${g.value} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                          tone="warn"
                        />
                      )}
                      {duplicateSellerOfferIds.length > 0 && (
                        <CollapsibleList title="Doppelte Seller_Offer_ID" items={duplicateSellerOfferIds} tone="warn" />
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </StepCard>
            )}

            {/* STEP 4 */}
            {hasOptionalShippingFindings && (
            <StepCard title="Spalten und Inhalt prüfen" status={stage3Status}>
              {!headers.length ? (
                <SmallText>Bitte CSV hochladen, um optionale Felder und Versand zu prüfen.</SmallText>
              ) : (
                <>
                  {optionalFindings.missingEANs.length > 0 ? (
                    <div style={{ marginTop: 14 }}>
                      <CollapsibleList
                        title={`Zeilen ohne EAN (${optionalFindings.missingEANs.length})`}
                        items={optionalFindings.missingEANs.slice(0, 50).map((label) => String(label))}
                        tone="bad"
                        hint="EAN nachliefern"
                        onItemClick={(label) => {
                          const m = String(label).match(/Zeile (\d+)\s*$/);
                          if (m) jumpToIssueTarget({ rowIndex: parseInt(m[1], 10) - 1, column: eanColumn });
                        }}
                      />
                    </div>
                  ) : null}

                  {(optionalFindings.missingEansByField.material.length > 0 || (optionalFindings.invalidMaterial?.length || 0) > 0) && (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {optionalFindings.missingEansByField.material.length > 0 && (
                        <CollapsibleList title={`Material fehlt (${optionalFindings.missingEansByField.material.length})`}
                          items={optionalFindings.missingEansByField.material.slice(0, 50).map((ean) => String(ean))} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.material)} />
                      )}
                      {optionalFindings.invalidMaterial?.length > 0 && (
                        <CollapsibleList title="Material außerhalb erlaubter Werte"
                          items={groupByValueWithEans(optionalFindings.invalidMaterial).slice(0, 50)} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.material)} />
                      )}
                    </div>
                  )}

                  {(optionalFindings.missingEansByField.color.length > 0 || (optionalFindings.invalidColor?.length || 0) > 0) && (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {optionalFindings.missingEansByField.color.length > 0 && (
                        <CollapsibleList title={`Farbe fehlt (${optionalFindings.missingEansByField.color.length})`}
                          items={optionalFindings.missingEansByField.color.slice(0, 50).map((ean) => String(ean))} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.color)} />
                      )}
                      {optionalFindings.invalidColor?.length > 0 && (
                        <CollapsibleList title="Farbe außerhalb erlaubter Werte"
                          items={groupByValueWithEans(optionalFindings.invalidColor).slice(0, 50)} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.color)} />
                      )}
                    </div>
                  )}

                  {(optionalFindings.missingEansByField.delivery_includes.length > 0 || (optionalFindings.invalidDeliveryIncludes?.length || 0) > 0) && (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {optionalFindings.missingEansByField.delivery_includes.length > 0 && (
                        <CollapsibleList title={`Lieferumfang fehlt (${optionalFindings.missingEansByField.delivery_includes.length})`}
                          items={optionalFindings.missingEansByField.delivery_includes.slice(0, 50).map((ean) => String(ean))} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.delivery_includes)} />
                      )}
                      {optionalFindings.invalidDeliveryIncludes?.length > 0 && (
                        <CollapsibleList title="Lieferumfang-Format ungültig"
                          items={groupByValueWithEans(optionalFindings.invalidDeliveryIncludes).slice(0, 50)} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.delivery_includes)} />
                      )}
                    </div>
                  )}

                  {mapping.delivery_time && ((optionalFindings.missingEansByField.delivery_time?.length > 0) || (optionalFindings.invalidDeliveryTime?.length > 0)) ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {optionalFindings.missingEansByField.delivery_time?.length > 0 && (
                        <CollapsibleList title={`Lieferzeit fehlt (${optionalFindings.missingEansByField.delivery_time.length})`}
                          items={optionalFindings.missingEansByField.delivery_time.slice(0, 50).map((ean) => String(ean))} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.delivery_time)} />
                      )}
                      {optionalFindings.invalidDeliveryTime?.length > 0 && (
                        <CollapsibleList title="Lieferzeit-Format ungültig"
                          items={groupByValueWithEans(optionalFindings.invalidDeliveryTime).slice(0, 50).map((g) => `${g.value || "(leer)"} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                          tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.delivery_time)} />
                      )}
                    </div>
                  ) : null}

                  {optionalFindings.templateValueHits?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <CollapsibleList title="Felder mit Beispielwerten"
                        items={groupByValueWithEans(optionalFindings.templateValueHits).slice(0, 50).map((g) => `${g.value} (Spalte ${g.column || "?"}): ${g.eans.slice(0, 5).join(", ")}`)}
                        tone="warn" />
                    </div>
                  )}

                  {mapping.washable_cover && optionalFindings.invalidWashableCover.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <CollapsibleList title="Waschbarer Bezug ungültig"
                        items={groupByValueWithEans(optionalFindings.invalidWashableCover).slice(0, 50).map((g) => `${g.value} – ${g.eans.length} EANs`)}
                        tone="warn" onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.washable_cover)} />
                    </div>
                  )}

                  {mapping.mounting_side && !/(montage|instruction|anleitung)/i.test(String(mapping.mounting_side)) && optionalFindings.invalidMountingSide.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <CollapsibleList title="Montageseite ungültig"
                        items={groupByValueWithEans(optionalFindings.invalidMountingSide).slice(0, 50).map((g) => `${g.value} – ${g.eans.length} EANs`)}
                        tone="warn" onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.mounting_side)} />
                    </div>
                  )}

                  {mapping.shipping_mode && (optionalFindings.missingShipping.length > 0 || optionalFindings.invalidShipping.length > 0) ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                      {optionalFindings.missingShipping.length > 0 && (
                        <CollapsibleList title={`Versandart fehlt (${optionalFindings.missingShipping.length})`}
                          items={optionalFindings.missingShipping.slice(0, 50).map((x) => String(x))} tone="warn"
                          onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.shipping_mode)} />
                      )}
                      {optionalFindings.invalidShipping.length > 0 && (
                        <CollapsibleList title="Versandart ungültig"
                          items={groupByValueWithEans(optionalFindings.invalidShipping).slice(0, 50).map((g) => `${g.value} – ${g.eans.length} EANs`)}
                          tone="warn" onItemClick={(ean) => jumpToEanWithColumn(ean, mapping.shipping_mode)} />
                      )}
                    </div>
                  ) : null}

                  {optionalFindings.scientificEans.length > 0 ? (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #FDE68A", background: "#FFFBEB" }}>
                      <div style={{ fontWeight: 700, color: "#92400E", fontSize: 13 }}>Hinweis EAN Format</div>
                      <div style={{ marginTop: 6, color: "#92400E", fontSize: 13 }}>Einige EAN Werte sehen nach wissenschaftlicher Schreibweise aus.</div>
                      <div style={{ marginTop: 10 }}>
                        <CollapsibleList
                          title="Betroffene EAN"
                          items={optionalFindings.scientificEans.filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))}
                          tone="warn"
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </StepCard>
            )}

            {/* STEP 5 */}
            <StepCard
              title="Bilder"
              status={!headers.length ? "idle" : !imageColumns.length ? "warn" : brokenImageIds.length > 0 ? "bad" : "ok"}

            >
          {!headers.length ? (
            <SmallText>Bitte CSV hochladen, um die Bildprüfung zu sehen.</SmallText>
          ) : (
                <>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill tone={imageColumns.length ? "ok" : "warn"}>{imageColumns.length ? `Bildspalten ${imageColumns.length}` : "Keine Bildspalten erkannt"}</Pill>
                  </div>

                  {/* Image count summary */}
                  {(() => {
                    const keys = Object.keys(imageBuckets || {}).map((k) => Number(k)).filter((k) => Number.isFinite(k) && k >= 0).sort((a, b) => a - b);
                    if (!keys.length) return <SmallText>Keine Bildinformationen ermittelt.</SmallText>;
                    return (
                      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {keys.map((n) => {
                          const list = imageBuckets[n] || [];
                          if (!list.length) return null;
                          const tone = n === 0 ? "#DC2626" : n === 1 ? "#D97706" : "#16A34A";
                          const bg = n === 0 ? "#FEF2F2" : n === 1 ? "#FFFBEB" : "#F0FDF4";
                          const label = n === 0 ? "0 Bilder" : n === 1 ? "1 Bild" : `${n} Bilder`;
                          return (
                            <div key={n} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: bg, border: `1px solid ${tone}33`, fontSize: 11, fontWeight: 600, color: tone }}>
                              {label}: {list.length}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Product image preview — one row per product */}
                  {(() => {
                    const filtered = imageSamples.filter((s) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(s.id).includes(t)));
                    const shown = filtered.slice(0, imageSampleLimitStep5);
                    if (!shown.length) return <div style={{ marginTop: 12 }}><SmallText>Keine Produkte mit Bildlinks gefunden.</SmallText></div>;
                    return (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                        {shown.map((sample) => (
                          <div key={sample.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFF" }}>
                            <div style={{ width: 140, flexShrink: 0 }}>
                              {sample.title && <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample.title.slice(0, 40)}</div>}
                              <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>{sample.id}</div>
                              <div style={{ fontSize: 10, color: "#9CA3AF" }}>{sample.count} Bilder</div>
                            </div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                              {sample.urls.slice(0, 5).map((u) => (
                                <a key={u} href={u} target="_blank" rel="noreferrer" title={u} style={{ display: "block" }}>
                                  <img src={u} alt="" loading="lazy"
                                    style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB", background: "#F9FAFB", display: "block" }}
                                    onError={(e) => { e.currentTarget.style.display = "none"; setBrokenImageIds((prev) => { const set = new Set(prev); set.add(sample.id); return Array.from(set); }); }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                        {filtered.length > imageSampleLimitStep5 && (
                          <button onClick={() => setImageSampleLimitStep5((n) => Math.min(filtered.length, n + 5))}
                            style={{ padding: "8px 14px", marginBottom: 40, borderRadius: 8, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 12, fontWeight: 600, width: "fit-content" }}>
                            Mehr Produkte anzeigen
                          </button>
                        )}
                        {brokenImageIds.length > 0 && (
                          <div style={{ fontSize: 11, color: "#92400E" }}>
                            {brokenImageIds.length} Produkte mit fehlerhaften Bild-Links: {brokenImageIds.slice(0, 5).join(", ")}{brokenImageIds.length > 5 ? " ..." : ""}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Bilder nach EAN — search tool */}
                  {eanColumn ? (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>Bilder nach EAN suchen</div>
                        {eanImageViewerOpen ? (
                          <button type="button" onClick={() => setEanImageViewerOpen(false)}
                            style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Schließen</button>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                        <input value={eanImageViewerInput} onChange={(e) => setEanImageViewerInput(e.target.value)} placeholder="EAN eingeben"
                          onKeyDown={(e) => { if (e.key === "Enter") openEanImageViewer(eanImageViewerInput); }}
                          style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", fontSize: 12, color: "#111827", boxSizing: "border-box" }} />
                        <button type="button" disabled={!eanImageViewerInput.trim()} onClick={() => openEanImageViewer(eanImageViewerInput)}
                          style={{ padding: "7px 14px", borderRadius: 6, border: "none", background: BRAND_COLOR, color: "#FFF", fontSize: 12, fontWeight: 600, cursor: eanImageViewerInput.trim() ? "pointer" : "not-allowed" }}>Suchen</button>
                      </div>
                      {eanImageViewerOpen ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: "#6B7280" }}>EAN: {eanImageViewerEan || "-"}</div>
                          {eanImageViewerUrls.length ? (
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {eanImageViewerUrls.slice(0, eanImageViewerLimit).map((u) => (
                                <a key={u} href={u} target="_blank" rel="noreferrer" title={u}>
                                  <img src={u} alt="" loading="lazy"
                                    style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB", background: "#FFF", display: "block" }}
                                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                </a>
                              ))}
                              {eanImageViewerUrls.length > eanImageViewerLimit && (
                                <button type="button" onClick={() => setEanImageViewerLimit((n) => Math.min(eanImageViewerUrls.length, n + 12))}
                                  style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #D1D5DB", background: "#FFF", cursor: "pointer", fontSize: 10, fontWeight: 600, alignSelf: "center" }}>
                                  +{eanImageViewerUrls.length - eanImageViewerLimit} mehr
                                </button>
                              )}
                            </div>
                          ) : (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#6B7280" }}>Keine Bilder gefunden.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </StepCard>

              </>
            ) : null}

            {/* TOGGLE VISIBLE CHECKS */}
            {pageMode === "feed-checker" && headers.length ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setShowAllChecks((v) => !v)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid #E5E7EB",
                    background: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    color: "#111827",
                  }}
                >
                  {showAllChecks ? "Nur Probleme zeigen" : "Alle Bereiche zeigen"}
                </button>
                <SmallText>
                  {showAllChecks
                    ? "Alle Bereiche werden angezeigt."
                    : "Nur Bereiche mit Auffälligkeiten werden angezeigt."}
                </SmallText>
              </div>
            ) : null}

          </div>
        </div>

            {/* ── RIGHT: Shared file preview ── */}
            <FeedPreviewPanel headers={headers}>{step7Inner}</FeedPreviewPanel>
          </div>
        </div>
      </div>

      {/* Fullscreen preview modal */}
      {previewFullscreen && headers.length ? (
        <div
          onClick={() => setPreviewFullscreen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", zIndex: 50, display: "flex", justifyContent: "center", alignItems: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 1400, maxHeight: "90vh", background: "#FFFFFF", borderRadius: 10, padding: 16, boxShadow: "0 25px 50px -12px rgba(15,23,42,0.45)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Vorschau Vollbild</div>
              <button type="button" onClick={() => setPreviewFullscreen(false)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", fontSize: 11, cursor: "pointer", color: "#111827" }}>Schließen</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResizableTable
                columns={previewColumns}
                rows={rows
                  .filter((r) => {
                    if (!eanSearchTerms.length) return true;
                    if (eanColumn) {
                      const val = String(r[eanColumn] ?? "").trim();
                      return eanSearchTerms.some((t) => val.includes(t));
                    }
                    const termsLower = eanSearchTerms.map((t) => t.toLowerCase());
                    return Object.values(r).some((v) => {
                      const cell = String(v ?? "").toLowerCase();
                      return termsLower.some((t) => cell.includes(t));
                    });
                  })}
              rowCriticalIssuesByIndex={rowCriticalIssuesByIndex}
                criticalRowIndexSet={criticalRowIndexSet}
              getRowTargetKey={(r) => r.__rowIndex}
              targetRowKey={pendingJumpRowKey}
              highlightedRowKey={highlightedJumpRowKey}
              highlightedColumnKey={highlightedColumnKey}
              onTargetHandled={() => setPendingJumpRowKey(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const isFeedAnalyse = !["ergebnistabelle", "rules", "checker-mc"].includes(route);

  return (
    <div style={{ background: "#F3F4F6", height: "100vh", overflow: "hidden", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      {topNav}

      {/* Every page is always mounted — display:none hides it. State is never lost on tab switch. */}

      <div style={{ flex: 1, minHeight: 0, display: isFeedAnalyse ? "block" : "none" }}>
        {page}
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: route === "ergebnistabelle" ? "block" : "none" }}>
        <ResultsTable />
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: route === "rules" ? "block" : "none" }}>
        <RulesPage rules={rules} setRules={setRules} onSave={saveRules} saving={rulesSaving} saveError={rulesSaveError} savedAt={rulesSavedAt} adminToken={adminToken} updateAdminToken={updateAdminToken} />
      </div>


      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "#F2F4F7", display: route === "checker-mc" ? "block" : "none" }}>
        {mcUnlocked ? (
          <CheckerMCPage />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100%", padding: 32 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "40px 48px", boxShadow: "0 2px 16px rgba(0,0,0,0.10)", maxWidth: 360, width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6, color: "#1a1a2e" }}>Passwortgeschützter Bereich</div>
              <div style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>Bitte geben Sie das Passwort ein, um fortzufahren.</div>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (mcPasswordInput === "check24") {
                  sessionStorage.setItem("mc_auth", "1");
                  setMcUnlocked(true);
                  setMcPasswordError(false);
                  setMcPasswordInput("");
                } else {
                  setMcPasswordError(true);
                  setMcPasswordInput("");
                }
              }}>
                <input
                  type="password"
                  value={mcPasswordInput}
                  onChange={(e) => { setMcPasswordInput(e.target.value); setMcPasswordError(false); }}
                  placeholder="Passwort"
                  autoFocus
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: mcPasswordError ? "1.5px solid #e53935" : "1.5px solid #ddd", fontSize: 15, marginBottom: 8, boxSizing: "border-box", outline: "none" }}
                />
                {mcPasswordError && <div style={{ color: "#e53935", fontSize: 13, marginBottom: 8 }}>Falsches Passwort. Bitte erneut versuchen.</div>}
                <button type="submit" style={{ width: "100%", padding: "10px 0", borderRadius: 8, background: BRAND_COLOR, color: "#fff", border: "none", fontWeight: 600, fontSize: 15, cursor: "pointer", marginTop: 4 }}>Entsperren</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
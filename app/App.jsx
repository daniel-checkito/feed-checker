import React, { useEffect, useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import ShopPerformance from "./shop-performance";
import Onboarding from "./onboarding";
import { getSupabaseClient, isSupabaseConfigured } from "./lib/supabaseClient";
   

const BRAND_COLOR = "rgb(4,16,103)";

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

function normalizePreviewText(value) {
  const s = String(value ?? "");
  if (!s) return s;
  return s
    // Replace Unicode replacement chars (�) by a neutral quote
    .replace(/\uFFFD/g, '"')
    // Normalize common smart quotes to straight equivalents
    .replace(/[„“”]/g, '"')
    .replace(/[‚‘’]/g, "'")
    // Optionally collapse weird double quotes patterns like ""Text""
    .replace(/"{2,}([^"]*?)"{2,}/g, '"$1"');
}

function buildEmail({ shopName, issues, tips, canStart }) {
  const subject = "CHECK24 Produktdatenfeed Prüfung – Ergebnisse und nächste Schritte";
  const greeting = shopName ? `Hallo ${shopName},` : "Hallo,";

  const intro =
    "wir haben Ihren Produktdatenfeed automatisiert geprüft. Unten finden Sie die wichtigsten Punkte, die für eine erfolgreiche automatische Produktanlage angepasst werden sollten.";

  const issueLines = issues.length ? issues.map((x) => `⚠️ ${x}`).join("\n") : "⚠️ Keine kritischen Fehler erkannt.";

  const tipLines = tips.length ? tips.map((x) => `💡 ${x}`).join("\n") : "💡 Keine weiteren Verbesserungsvorschläge.";

  const decision = canStart
    ? "Wir können mit dem Feed starten."
    : "Bitte passen Sie die Punkte oben an. Erst danach können wir mit dem Feed starten.";

  const closing = "Viele Grüße\nCHECK24 Shopping\n\nHinweis Dies ist eine automatisch erstellte Nachricht.";

  return [`Betreff: ${subject}`, "", greeting, "", intro, "", issueLines, "", tipLines, "", decision, "", closing].join("\n");
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
  const border =
    status === "ok" ? "#BBF7D0" : status === "warn" ? "#FDE68A" : status === "bad" ? "#FCA5A5" : "#E5E7EB";
  const bg =
    status === "ok" ? "#F0FDF4" : status === "warn" ? "#FFFBEB" : status === "bad" ? "#FEF2F2" : "#FFFFFF";
  const icon =
    status === "ok" ? "✅" : status === "warn" ? "⚠️" : status === "bad" ? "⛔" : "⏳";

  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: 16,
        padding: 14,
        background: bg,
        boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
        boxSizing: "border-box",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 18, flexShrink: 0 }}>{icon}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{title}</div>
            {subtitle ? (
              <div style={{ marginTop: 4, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>{subtitle}</div>
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
    <div style={{ overflowX: "auto", width: "100%", border: "1px solid #E5E7EB", borderRadius: 12, boxSizing: "border-box" }}>
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
  highlightedCells,
  getRowTargetKey,
  targetRowKey,
  highlightedRowKey,
  onTargetHandled,
}) {
  const computeInitialWidth = (col) => {
    const label = String(col.label || col.key || "");
    if (String(col.key).toLowerCase() === "name") {
      const approxName = label.length * 8 + 60;
      return Math.max(140, approxName);
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
  const dragRef = useRef(null);
  const rowRefs = useRef(new Map());

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
    const node = rowRefs.current.get(String(targetRowKey));
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof onTargetHandled === "function") onTargetHandled();
  }, [targetRowKey, rows, getRowTargetKey, onTargetHandled]);

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

  return (
    <div
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
              return (
                <th
                  key={c.key}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    textAlign: "left",
                    padding: "6px 8px",
                    border: "1px solid #E5E7EB",
                    color: "#111827",
                    whiteSpace: "normal",
                    background: "#F9FAFB",
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
          {rows.map((r, i) => {
            const zebra = i % 2 === 0 ? "#FFFFFF" : "#F9FAFB";
            const rowTargetKey = getRowTargetKey ? getRowTargetKey(r, i) : null;
            const isJumpHighlighted =
              highlightedRowKey != null &&
              rowTargetKey != null &&
              String(rowTargetKey) === String(highlightedRowKey);
            return (
              <tr
                key={i}
                ref={(el) => {
                  if (!rowTargetKey) return;
                  const key = String(rowTargetKey);
                  if (el) rowRefs.current.set(key, el);
                  else rowRefs.current.delete(key);
                }}
                style={{ background: isJumpHighlighted ? "#FEF3C7" : zebra }}
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
                  background: isJumpHighlighted ? "#FEF3C7" : zebra,
                }}
              >
                <div style={{ height: rowHeight, maxHeight: rowHeight, display: "flex", alignItems: "center", overflow: "hidden" }}>
                  {i + 1}
                </div>
              </td>
              {columns.map((c) => {
                const w = widths[c.key] ?? 90;
                const longText = isLongTextColumn(c.key);
                const cellId = `${i}:${c.key}`;
                const rawValue = String(r?.[c.key] ?? "");
                const displayValue = normalizePreviewText(rawValue);
                const isHighlighted =
                  highlightedCells && highlightedCells.has(cellId);
                const tooltip = isHighlighted
                  ? "In diesem Feld liegt ein Problem vor (z.B. fehlender Pflichtwert oder Dublette)."
                  : "";
                return (
                  <td
                    key={c.key}
                    title={tooltip}
                    style={{
                      padding: "0 8px",
                      border: "1px solid #E5E7EB",
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
                      background: isHighlighted ? "#FEE2E2" : (isJumpHighlighted ? "#FEF3C7" : zebra),
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
                      <div style={{ height: rowHeight, maxHeight: rowHeight, display: "flex", alignItems: "center", overflow: "hidden" }}>
                        {displayValue}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
            );
          })}
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
              borderRadius: 16,
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
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{descriptionModal.title}</div>
              <button
                onClick={() => setDescriptionModal(null)}
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
                border: "1px solid #E5E7EB",
                fontSize: 12,
                lineHeight: "18px",
                color: "#111827",
                overflow: "auto",
              }}
            >
              {descriptionModal.text}
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
      const u = String(r?.[c] ?? "").trim();
      if (u) urls.push(u);
      if (urls.length >= limit * 10) break;
    }
    if (urls.length >= limit * 10) break;
  }
  return uniqueNonEmpty(urls).slice(0, limit);
}

function CollapsibleList({ title, items, tone, hint, onAddValue, onItemClick }) {
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
    <details style={{ border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, background: "white", boxSizing: "border-box", width: "100%" }}>
      <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pill tone={tone}>{count}</Pill>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{title}</span>
        {hint ? (
          <span style={{ fontSize: 12, color: "#6B7280" }}>{hint}</span>
        ) : (
          <span style={{ fontSize: 12, color: "#6B7280" }}></span>
        )}
      </summary>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: hasLong ? "column" : "row",
          flexWrap: hasLong ? "nowrap" : "wrap",
          gap: hasLong ? 0 : 8,
        }}
      >
        {parsed.map((item, idx) => {
          if (item.isLong || item.isValueWithEans) {
            const canAdd = !!onAddValue && item.isValueWithEans && item.valuePart;
            const canJump = !!onItemClick && !!item.firstEan;
            const handleRowClick = () => {
              if (canJump) onItemClick(item.firstEan);
            };
            return (
              <div
                key={`${item.text}-${idx}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "6px 4px",
                  borderBottom: "1px solid #F3F4F6",
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "#111827",
                  wordBreak: "break-word",
                  cursor: canJump ? "pointer" : "default",
                }}
                onClick={handleRowClick}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {item.isValueWithEans && item.valuePart && item.restPart ? (
                    <>
                      <div style={{ fontWeight: 600 }}>{item.valuePart}</div>
                      <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{item.restPart}</div>
                    </>
                  ) : (
                    item.text
                  )}
                </div>
                {canAdd ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddValue(item.valuePart);
                    }}
                    style={{
                      marginLeft: 8,
                      padding: "4px 6px",
                      borderRadius: 999,
                      border: "1px solid #D1D5DB",
                      background: "#FFFFFF",
                      cursor: "pointer",
                      fontSize: 12,
                      lineHeight: "12px",
                      color: "#111827",
                      flexShrink: 0,
                    }}
                    title="Diesen Wert als erlaubt speichern"
                  >
                    +
                  </button>
                ) : null}
              </div>
            );
          }

          const canJumpPill = !!onItemClick && !!item.firstEan;
          return (
            <span
              key={`${item.text}-${idx}`}
              onClick={() => {
                if (canJumpPill) onItemClick(item.firstEan);
              }}
              style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #E5E7EB",
                background: "#F9FAFB",
                color: "#111827",
                wordBreak: "break-all",
                cursor: canJumpPill ? "pointer" : "default",
              }}
              title={canJumpPill ? "Zum Datensatz springen" : ""}
            >
              {item.text}
            </span>
          );
        })}
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
        style={{ flex: "1 1 200px", minWidth: 0, padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
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
            Global gespeichert. Aenderungen gelten sofort fuer alle.
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
              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte shipping_mode Werte</div>
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

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte Material Werte</div>
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

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Erlaubte Farbwerte</div>
                <SmallText>Kommagetrennt. Beispiel weiss, schwarz, blau</SmallText>
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

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang Pattern</div>
                <SmallText>RegExp als String. Default ist Anzahl x Produkt.</SmallText>
                <input
                  value={draft.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern}
                  onChange={(e) => setField("delivery_includes_pattern", e.target.value)}
                  style={{ marginTop: 10, width: "100%", padding: 10, borderRadius: 12, border: "1px solid #E5E7EB", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferumfang Allowlist</div>
                <SmallText>Einzelne Lieferumfang-Werte, die trotz Pattern-Abweichung als gültig gelten.</SmallText>
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

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid #E5E7EB", background: "white" }}>
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

  const colByName = (candidates) => {
    const set = new Set(headers.map((h) => String(h).toLowerCase().trim()));
    for (const cand of candidates) {
      const key = String(cand).toLowerCase().trim();
      if (set.has(key)) return headers.find((h) => String(h).toLowerCase().trim() === key);
    }
    return "";
  };

  const titleCol = colByName(["name", "product_name", "titel", "title"]);
  const descCol = colByName(["description", "beschreibung", "desc"]);
  const dimCol = colByName(["abmessungen", "size", "dimensions"]);
  const deliveryCol = colByName(["lieferumfang", "delivery_includes"]);
  const brandCol = colByName(["herstellerfeed", "manufacturer", "brand", "marke"]);
  const eanCol = colByName(["ean", "gtin", "gtin14", "ean13", "barcode"]);
  const materialCol = colByName(["material", "materials"]);
  const colorCol = colByName(["color", "farbe"]);
  const shopCol = colByName(["shopbezogene texte", "shop_text", "marketing_text", "promo_text"]);

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
    bildmatch: 0,
    freisteller: 0,
    millieu: 0,
    anzahlbilder: 0,
  });

  const [autoEnabled, setAutoEnabled] = useState(true);

  const [imageSampleLimit, setImageSampleLimit] = useState(5);
  const [freistellerChecks, setFreistellerChecks] = useState({});
  const [freistellerLoading, setFreistellerLoading] = useState(false);

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
        const u = safeStr(r?.[c] ?? "").trim();
        if (u) urls.push(u);
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

    async function detectFreistellerForSamples(samples) {
      setFreistellerLoading(true);
      const result = {};

      async function checkImage(url) {
        return new Promise((resolve) => {
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              try {
                const canvas = document.createElement("canvas");
                const w = img.width;
                const h = img.height;
                if (!w || !h) {
                  resolve(false);
                  return;
                }
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                  resolve(false);
                  return;
                }
                ctx.drawImage(img, 0, 0);
                const border = 5;
                const imgData = ctx.getImageData(0, 0, w, h).data;
                let whiteLike = 0;
                let total = 0;
                const isBorderPixel = (x, y) => x < border || y < border || x >= w - border || y >= h - border;
                for (let y = 0; y < h; y += 4) {
                  for (let x = 0; x < w; x += 4) {
                    if (!isBorderPixel(x, y)) continue;
                    const idx = (y * w + x) * 4;
                    const r = imgData[idx];
                    const g = imgData[idx + 1];
                    const b = imgData[idx + 2];
                    total += 1;
                    const brightness = (r + g + b) / 3;
                    const maxChannel = Math.max(r, g, b);
                    const minChannel = Math.min(r, g, b);
                    const chroma = maxChannel - minChannel;
                    if (brightness >= 235 && chroma <= 20) {
                      whiteLike += 1;
                    }
                  }
                }
                const ratio = total ? whiteLike / total : 0;
                resolve(ratio >= 0.5);
              } catch (e) {
                resolve(false);
              }
            };
            img.onerror = () => resolve(false);
            img.src = url;
          } catch (e) {
            resolve(false);
          }
        });
      }

      for (const sample of samples) {
        if (cancelled) break;
        const urls = Array.isArray(sample.urls) ? sample.urls.slice(0, 5) : [];
        let hasFreisteller = false;
        let checkedCount = 0;
        for (const url of urls) {
          if (cancelled) break;
          const ok = await checkImage(url);
          checkedCount += 1;
          if (ok) {
            hasFreisteller = true;
            break;
          }
        }
        result[sample.id] = { hasFreisteller, checkedCount };
      }

      if (!cancelled) {
        setFreistellerChecks(result);
        setFreistellerLoading(false);
      }
    }

    if (typeof window === "undefined") {
      return;
    }
    detectFreistellerForSamples(qsImageSamples.slice(0, 10));
    return () => {
      cancelled = true;
    };
  }, [qsImageSamples]);

  const autoSuggested = useMemo(() => {
    if (!headers.length || !rows.length) return null;

    const n = rows.length || 1;

    const herstRate = filledRate(brandCol);
    const herstellerfeed = herstRate >= 0.8 ? 20 : 0;

    let titel = 0;
    if (titleCol) {
      const vals = rows.map((r) => safeStr(r[titleCol]).trim().toLowerCase());
      const filled = vals.filter((v) => v).length;
      const fillRate = filled / n;
      const uniq = new Set(vals.filter(Boolean));
      const dupRate = filled ? 1 - uniq.size / filled : 0;
      const avg = avgLen(titleCol);
      if (fillRate >= 0.9 && avg >= 40 && dupRate <= 0.08) titel = 20;
      else if (fillRate >= 0.8 && avg >= 25) titel = 10;
      else titel = 0;
    }

    let beschreibung = 0;
    if (descCol) {
      const fillRate = filledRate(descCol);
      const avg = avgLen(descCol);
      if (fillRate >= 0.85 && avg >= 80) beschreibung = 10;
      else if (fillRate >= 0.75 && avg >= 40) beschreibung = 5;
      else beschreibung = 0;
    }

    const dimCandidates = [dimCol, titleCol, descCol].filter(Boolean);
    let abmessungen = 0;
    if (dimCandidates.length) {
      const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|x|×)/i;
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
      if (rate >= 0.6) abmessungen = 10;
      else if (rate >= 0.3) abmessungen = 5;
      else abmessungen = 0;
    }

    let lieferumfang = 0;
    if (deliveryCol) {
      const DELIVERY_RE = /^\s*(\d+)\s*[xX]\s+.+/;
      let nonEmpty = 0;
      let formatOk = 0;
      for (const r of rows) {
        const v = safeStr(r[deliveryCol]).trim();
        if (!v) continue;
        nonEmpty += 1;
        if (DELIVERY_RE.test(v)) formatOk += 1;
      }
      const filled = nonEmpty / n;
      const fmt = nonEmpty ? formatOk / nonEmpty : 0;
      if (filled >= 0.7 && fmt >= 0.7) lieferumfang = 20;
      else if (filled >= 0.4 && fmt >= 0.35) lieferumfang = 10;
      else lieferumfang = 0;
    }

    let material = 0;
    if (materialCol) {
      const rate = filledRate(materialCol);
      if (rate >= 0.9) {
        material = 10;
      } else if (rate > 0) {
        material = 5;
      } else {
        material = 0;
      }
    }

    let farbe = 0;
    if (colorCol) {
      let nonEmpty = 0;
      let valid = 0;
      for (const r of rows) {
        const raw = safeStr(r[colorCol]).trim();
        if (!raw) continue;
        nonEmpty += 1;
        const val = raw.toLowerCase();
        const isBlacklist =
          val === "-" ||
          val === "na" ||
          val === "n/a" ||
          val === "none" ||
          val === "kein" ||
          val === "keine" ||
          val === "k.a." ||
          val === "ka";
        const isTooLong = raw.length > 50;
        if (!isBlacklist && !isTooLong) {
          valid += 1;
        }
      }
      const filledRateColor = rows.length ? nonEmpty / rows.length : 0;
      const validRate = nonEmpty ? valid / nonEmpty : 0;
      if (filledRateColor >= 0.9 && validRate >= 0.9) {
        farbe = 10;
      } else if (filledRateColor >= 0.6 && validRate >= 0.6) {
        farbe = 5;
      } else {
        farbe = 0;
      }
    }

    let anzahlbilder = 0;
    if (headers.length && rows.length) {
      const norms = headers.map((h) => ({ raw: h, norm: normalizeKey(h) }));
      const imgCols = norms
        .filter((h) => h.norm.startsWith("image_url") || h.norm.startsWith("image") || h.norm.startsWith("img_url"))
        .map((h) => h.raw);
      if (imgCols.length) {
        let totalImgs = 0;
        let rn = 0;
        for (const r of rows) {
          let c = 0;
          for (const col of imgCols) {
            const v = safeStr(r[col]).trim();
            if (!v) continue;
            c += 1;
          }
          totalImgs += c;
          rn += 1;
        }
        const avg = rn ? totalImgs / rn : 0;
        if (avg >= 5) anzahlbilder = 10;
        else if (avg >= 2) anzahlbilder = 5;
        else anzahlbilder = 0;
      }
    }

    let shoptexte = 10;
    if (shopCol) {
      const fill = filledRate(shopCol);
      if (fill > 0) {
        shoptexte = 0;
      }
    }

    let freisteller = 0;
    if (qsImageSamples.length && freistellerChecks && Object.keys(freistellerChecks).length) {
      const samples = qsImageSamples.slice(0, 10);
      let checkedProducts = 0;
      let withFreisteller = 0;
      samples.forEach((s) => {
        const r = freistellerChecks[s.id];
        if (!r || !r.checkedCount) return;
        checkedProducts += 1;
        if (r.hasFreisteller) withFreisteller += 1;
      });
      if (checkedProducts > 0) {
        const share = withFreisteller / checkedProducts;
        if (share >= 0.7) freisteller = 10;
        else if (share >= 0.3) freisteller = 5;
        else freisteller = 0;
      }
    }

    return {
      herstellerfeed,
      titel,
      beschreibung,
      abmessungen,
      lieferumfang,
      material,
      farbe,
      shoptexte,
      bildmatch: 0,
      freisteller,
      millieu: 0,
      anzahlbilder,
    };
  }, [headers, rows, titleCol, descCol, dimCol, deliveryCol, brandCol, qsImageSamples, freistellerChecks]);

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

  const attributeRaw =
    scores.herstellerfeed +
    scores.titel +
    scores.beschreibung +
    scores.abmessungen +
    scores.lieferumfang +
    scores.material +
    scores.farbe +
    scores.shoptexte;

  const imageRaw =
    scores.bildmatch +
    scores.freisteller +
    scores.millieu +
    scores.anzahlbilder;

  const attributeScore = scores.titel === 0 ? 0 : Math.round((attributeRaw / 95) * 90);
  const imageScore = scores.bildmatch === 0 ? 0 : Math.ceil((imageRaw / 50) * 90);
  const total180 = attributeScore + imageScore;
  const totalPercent = (total180 / 180) * 100;

  const apaEligible =
    attributeScore >= 70 &&
    imageScore >= 60 &&
    scores.herstellerfeed === 20 &&
    scores.titel >= 10 &&
    scores.beschreibung >= 5 &&
    scores.abmessungen >= 5 &&
    scores.lieferumfang >= 10 &&
    scores.material >= 5 &&
    scores.farbe >= 5 &&
    scores.shoptexte >= 5 &&
    scores.bildmatch === 20 &&
    scores.freisteller >= 5 &&
    scores.millieu >= 5 &&
    scores.anzahlbilder >= 5;

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
      const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|x|×)/i;
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
      const DELIVERY_RE = /^\s*(\d+)\s*[xX]\s+.+/;
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
      reasons.shoptexte = "Keine oder praktisch keine separaten shopbezogenen Texte im Feed – 10 Punkte.";
    } else if (scores.shoptexte === 5) {
      reasons.shoptexte = "Nur vereinzelt shopbezogene Texte vorhanden – 5 Punkte (manuell vergeben).";
    } else {
      reasons.shoptexte = "Shopbezogene Texte im Feed gefunden (z.B. Marketing-/Shop-Inhalte) – 0 Punkte.";
    }

    if (scores.bildmatch === 20) {
      reasons.bildmatch = "Erstes Bild passt konsistent zu den Produkten, keine Auffaelligkeiten – 20 Punkte.";
    } else {
      reasons.bildmatch = "Erstes Bild wirkt haeufig unpassend oder uneinheitlich – 0 Punkte.";
    }

    if (qsImageSamples.length && Object.keys(freistellerChecks || {}).length) {
      const samples = qsImageSamples.slice(0, 10);
      let checkedProducts = 0;
      let withFreisteller = 0;
      samples.forEach((s) => {
        const r = freistellerChecks[s.id];
        if (!r || !r.checkedCount) return;
        checkedProducts += 1;
        if (r.hasFreisteller) withFreisteller += 1;
      });
      if (checkedProducts > 0) {
        const share = withFreisteller / checkedProducts;
        if (scores.freisteller === 10) {
          reasons.freisteller = `${withFreisteller} von ${checkedProducts} getesteten Produkten mit mindestens einem Freisteller – 10 Punkte.`;
        } else if (scores.freisteller === 5) {
          reasons.freisteller = `${withFreisteller} von ${checkedProducts} getesteten Produkten mit Freisteller – 5 Punkte.`;
        } else {
          reasons.freisteller = `${withFreisteller} von ${checkedProducts} getesteten Produkten mit Freisteller – 0 Punkte.`;
        }
      } else {
        reasons.freisteller = "Automatische Freisteller-Pruefung konnte keine auswertbaren Bilder finden – 0 Punkte.";
      }
    } else {
      if (scores.freisteller === 10) {
        reasons.freisteller = "Viele Produkte mit gutem Freistellerbild – 10 Punkte.";
      } else if (scores.freisteller === 5) {
        reasons.freisteller = "Nur ein Teil der Produkte mit Freistellerbild – 5 Punkte.";
      } else {
        reasons.freisteller = "Kaum Freistellerbilder im Feed – 0 Punkte.";
      }
    }

    if (scores.millieu === 10) {
      reasons.millieu = "Viele Produkte mit ansprechenden Milieubildern – 10 Punkte.";
    } else if (scores.millieu === 5) {
      reasons.millieu = "Nur einige Produkte mit Milieubildern – 5 Punkte.";
    } else {
      reasons.millieu = "Fast keine Milieubilder im Feed – 0 Punkte.";
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
        columnLabel: shopCol || "",
        editable: true,
        options: [0, 5, 10],
        value: scores.shoptexte,
        onChange: (v) => setScores((s) => ({ ...s, shoptexte: v })),
        description: scoreReasons.shoptexte,
      },
    ];

    const criteria = {
      herstellerfeed: [],
      titel: ["20 P: Titel fast immer vorhanden, lang genug und ohne viele Dubletten.", "10 P: Titel oft vorhanden, aber teils kurz oder doppelt.", "0 P: Titel fehlen häufig oder sind sehr kurz."],
      beschreibung: ["10 P: Beschreibungen in den meisten Zeilen, mit vernünftiger Länge.", "5 P: Beschreibungen teils vorhanden, eher kurz.", "0 P: Beschreibungen fehlen oft oder sind extrem kurz."],
      abmessungen: ["10 P: Verständliche Maße in vielen Produkten (z. B. 90x200 cm).", "5 P: Maße nur teilweise oder unklar vorhanden.", "0 P: Kaum verwertbare Maße."],
      lieferumfang: ["20 P: Lieferumfang fast immer im Format '1x Produkt' gepflegt.", "10 P: Lieferumfang teils gepflegt und oft im korrekten Format.", "0 P: Lieferumfang selten gepflegt oder unklar."],
      material: ["10 P: Material für die meisten Produkte sinnvoll gepflegt.", "5 P: Material nur teilweise gepflegt oder uneinheitlich.", "0 P: Material kaum oder gar nicht gepflegt."],
      farbe: ["10 P: Farben meist vorhanden und sauber benannt.", "5 P: Farben nur teilweise vorhanden oder uneinheitlich.", "0 P: Farbinfos fehlen weitgehend."],
      shoptexte: ["10 P: Keine bzw. kaum separate shopbezogene Texte im Feed.", "5 P: Nur vereinzelt shopbezogene Texte vorhanden.", "0 P: Viele shopbezogene/marketinglastige Texte im Feed."],
    };

    return base.map((item) => ({
      ...item,
      criteria: criteria[item.id] || [],
    }));
  }, [scores, brandCol, titleCol, descCol, dimCol, deliveryCol, materialCol, colorCol, shopCol, scoreReasons]);

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
        label: "Millieu",
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

    const crit = {
      bildmatch: [
        "20 P: Erstes Bild passt konsistent zum Produkt, keine erkennbaren Dubletten.",
        "0 P: Erstes Bild häufig unpassend oder Dubletten auffällig.",
      ],
      freisteller: [
        "10 P: Viele Produkte mit gutem Freistellerbild.",
        "5 P: Nur ein Teil der Produkte mit Freistellerbild.",
        "0 P: Kaum Freistellerbilder im Feed.",
      ],
      millieu: [
        "10 P: Viele Produkte mit ansprechenden Milieubildern.",
        "5 P: Nur einige Produkte mit Milieubildern.",
        "0 P: Fast keine Milieubilder im Feed.",
      ],
      anzahlbilder: [
        "10 P: Durchschnittlich viele Bilder pro Produkt (z. B. ≥ 5).",
        "5 P: Mittelmäßige Bildanzahl pro Produkt.",
        "0 P: Sehr wenige Bilder pro Produkt.",
      ],
    };

    return base.map((item) => ({
      ...item,
      criteria: crit[item.id] || [],
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
    const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|x|×)/i;
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

  const shopExamples = useMemo(() => {
    if (!shopCol) return [];
    return sampleUniqueValues(rows, shopCol, 20);
  }, [rows, shopCol]);

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
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>QS/APA Dashboard</div>
        <SmallText>Bitte zuerst im Tab &quot;Checker&quot; eine CSV Datei hochladen. Danach nutzt QS/APA die gleichen Daten.</SmallText>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>QS/APA Dashboard</div>
            {total > 0 ? <Pill tone="info">{total} Zeilen</Pill> : null}
          </div>
          {total > 0 ? (
            <div style={{ marginTop: 4, color: "#6B7280", fontSize: 13, lineHeight: "18px" }}>
              
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }} />
      </div>

      {total > 0 ? (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          <div style={{ padding: 12, borderRadius: 16, border: "1px solid #A7F3D0", background: "#ECFDF3" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#047857" }}>Attribute Score</div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{attributeScore}</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>/ 90</div>
            </div>
            <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <SmallText>Bewertung der Inhalts-Attribute.</SmallText>
              <button
                onClick={() => {
                  const txt = `Attribute Score ${attributeScore} von 90`;
                  if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
                }}
                style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                Kopieren
              </button>
            </div>
          </div>

          <div style={{ padding: 12, borderRadius: 16, border: "1px solid #BFDBFE", background: "#EFF6FF" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#1D4ED8" }}>Bild Score</div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{imageScore}</div>
              <div style={{ fontSize: 12, color: "#6B7280" }}>/ 90</div>
            </div>
            <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <SmallText>Bewertung von 1. Bild, Freisteller, Millieu & Anzahl.</SmallText>
              <button
                onClick={() => {
                  const txt = `Bild Score ${imageScore} von 90`;
                  if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
                }}
                style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                Kopieren
              </button>
            </div>
          </div>

          <div style={{ padding: 12, borderRadius: 16, border: apaEligible ? "1px solid #A7F3D0" : "1px solid #FCA5A5", background: apaEligible ? "#ECFDF3" : "#FEF2F2" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: apaEligible ? "#047857" : "#B91C1C" }}>APA Eignung</div>
            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{apaEligible ? "Geeignet" : "Noch nicht geeignet"}</div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>
              {apaEligible
                ? "✅ Alle benoetigten QS/APA Kriterien erfuellt – Feed kann fuer APA freigeschaltet werden."
                : "❌ Aktuell nicht fuer APA geeignet – bitte Attribute/Bilder anhand der QS/APA Kriterien verbessern."}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 10, borderRadius: 16, border: "1px solid #A7F3D0", background: "#F0FDF4" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#166534" }}>Attribute Qualität</div>
        <SmallText>
          Bewertung von Herstellerfeed, Titeln, Beschreibungen, Abmessungen, Lieferumfang und Textattributen. Herstellerfeed wird
          ausschliesslich manuell per Ja/Nein bewertet.
        </SmallText>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 8 }}>
          {attributeItems.map((item) => {
            const toneColor = item.status === "ok" ? "#16A34A" : item.status === "bad" ? "#DC2626" : "#F59E0B";
            const icon = "●";
            const hasColumn = !!item.columnLabel;
            const columnText = hasColumn ? `Spalte: ${item.columnLabel}` : "Spalte nicht erkannt";

            return (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", padding: 7, borderRadius: 12, border: "1px solid #E5E7EB", borderLeft: `4px solid ${toneColor}`, background: "#FFFFFF", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: toneColor }}>{icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{item.label}</div>
                      {item.id !== "herstellerfeed" ? (
                        <div style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{columnText}</div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          Manuelle Bewertung: Ja = 20 P, Nein = 0 P
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    {item.id === "herstellerfeed" ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => item.onChange(20)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: item.value === 20 ? "1px solid #16A34A" : "1px solid #D1D5DB",
                            background: item.value === 20 ? "#DCFCE7" : "#FFFFFF",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Ja
                        </button>
                        <button
                          type="button"
                          onClick={() => item.onChange(0)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: item.value === 0 ? "1px solid #DC2626" : "1px solid #D1D5DB",
                            background: item.value === 0 ? "#FEE2E2" : "#FFFFFF",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Nein
                        </button>
                      </div>
                    ) : item.editable ? (
                      <select value={item.value} onChange={(e) => item.onChange(Number(e.target.value))} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", fontSize: 12, background: "#FFFFFF", cursor: "pointer" }}>
                        {item.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt} P
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ padding: "3px 8px", borderRadius: 999, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600 }}>{item.value} P</span>
                    )}
                  </div>
                </div>
                {item.description ? <div style={{ fontSize: 11, color: "#4B5563", marginTop: 2 }}>{item.description}</div> : null}
                {item.id !== "herstellerfeed" && item.criteria && item.criteria.length ? (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", fontSize: 11, color: "#4B5563" }}>Kriterien fuer Punkte anzeigen</summary>
                    <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 11, color: "#374151", lineHeight: "16px" }}>
                      {item.criteria.map((line, idx) => (<li key={idx}>{line}</li>))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 10, borderRadius: 16, border: "1px solid #BFDBFE", background: "#EFF6FF" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#1D4ED8" }}>Bildqualität</div>
        <SmallText>
          Bewertung von erstem Bild, Freistellern, Milieu und Anzahl Bilder. „1. Bild &amp; keine Dopplungen“, „Freisteller“ und
          „Millieu“ muessen manuell ueber das Dropdown bewertet werden. Darunter siehst du Beispielprodukte.
        </SmallText>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 8 }}>
          {imageItems.map((item) => {
            const toneColor = item.status === "ok" ? "#16A34A" : item.status === "bad" ? "#DC2626" : "#F59E0B";
            const icon = "●";
            return (
              <div key={item.id} style={{ display: "flex", flexDirection: "column", padding: 7, borderRadius: 12, border: "1px solid #E5E7EB", borderLeft: `4px solid ${toneColor}`, background: "#FFFFFF", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: toneColor }}>{icon}</span>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{item.label}</div>
                    </div>
                  </div>
                  <div>
                    {item.editable ? (
                      <select value={item.value} onChange={(e) => item.onChange(Number(e.target.value))} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", fontSize: 12, background: "#FFFFFF", cursor: "pointer" }}>
                        {item.options.map((opt) => (<option key={opt} value={opt}>{opt} P</option>))}
                      </select>
                    ) : (
                      <span style={{ padding: "3px 8px", borderRadius: 999, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11, fontWeight: 600 }}>{item.value} P</span>
                    )}
                  </div>
                </div>
                {item.description ? <div style={{ fontSize: 11, color: "#4B5563", marginTop: 2 }}>{item.description}</div> : null}
                {item.criteria && item.criteria.length ? (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", fontSize: 11, color: "#4B5563" }}>Kriterien fuer Punkte anzeigen</summary>
                    <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 11, color: "#374151", lineHeight: "16px" }}>
                      {item.criteria.map((line, idx) => (<li key={idx}>{line}</li>))}
                    </ul>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>

        {qsImageSamples.length ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Bild Vorschau (Liste)</div>
            <SmallText>Jede Zeile ist ein Produkt. Links siehst du ID und Anzahl Bilder, rechts einige Vorschaubilder zum manuellen Check.</SmallText>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {qsImageSamples.slice(0, imageSampleLimit).map((sample) => (
                <div key={sample.id} style={{ padding: 6, borderRadius: 10, border: "1px solid #E5E7EB", background: "#FFFFFF", display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{sample.id}</div>
                    <div style={{ marginTop: 2, fontSize: 11, color: "#6B7280" }}>{sample.count} Bilder</div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {sample.urls.slice(0, 5).map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" title={u} style={{ display: "block", width: 54, height: 54, flexShrink: 0 }}>
                        <div style={{ width: 54, height: 54, position: "relative" }}>
                          <img
                            src={u}
                            alt="Bild"
                            loading="lazy"
                            style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFFFFF", display: "block" }}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget.nextElementSibling;
                              if (fallback && fallback instanceof HTMLElement) fallback.style.display = "flex";
                            }}
                          />
                          <div
                            style={{
                              display: "none",
                              width: 54,
                              height: 54,
                              borderRadius: 8,
                              border: "1px solid #E5E7EB",
                              background: "#F3F4F6",
                              color: "#6B7280",
                              fontSize: 10,
                              fontWeight: 600,
                              alignItems: "center",
                              justifyContent: "center",
                              textAlign: "center",
                              padding: "0 4px",
                              boxSizing: "border-box",
                              cursor: "copy",
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (navigator?.clipboard?.writeText) {
                                navigator.clipboard.writeText(u).catch(() => {});
                              }
                            }}
                            title="Fehler - klicken um Link zu kopieren"
                          >
                            Fehler - Link kopieren
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {imageSampleLimit < qsImageSamples.length ? (
              <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-start" }}>
                <button onClick={() => setImageSampleLimit((n) => Math.min(qsImageSamples.length, n + 5))} style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                  Mehr Produkte anzeigen
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
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
    const hash = window.location.hash;
    if (hash === "#/rules") return "rules";
    if (hash === "#/qs") return "qs";
    if (hash === "#/feedback") return "feedback";
    if (hash === "#/login") return "login";
    if (hash === "#/shop-performance") return "shop-performance";
    if (hash === "#/onboarding") return "onboarding";
    return "checker";
  });
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSellerKey, setFeedbackSellerKey] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState("score");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackError, setFeedbackError] = useState("");

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
      else if (hash === "#/qs") setRoute("qs");
      else if (hash === "#/feedback") setRoute("feedback");
      else if (hash === "#/login") setRoute("login");
      else if (hash === "#/shop-performance") setRoute("shop-performance");
      else if (hash === "#/onboarding") setRoute("onboarding");
      else setRoute("checker");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!supabase) return undefined;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        setAuthError(String(error.message || error));
        return;
      }
      setAuthUser(data?.session?.user || null);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [supabase]);

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

  async function runAuthAction(action) {
    if (!supabase) {
      setAuthError("Supabase ist nicht konfiguriert. Bitte .env.local prüfen.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");
    try {
      if (action === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        setAuthMessage("Erfolgreich eingeloggt.");
      } else if (action === "signup") {
        const { error } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}/#/login`
                : undefined,
          },
        });
        if (error) throw error;
        setAuthMessage(
          "Registrierung gestartet. Bitte bestätige die E-Mail und logge dich danach ein."
        );
      } else if (action === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim(), {
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/#/login`
              : undefined,
        });
        if (error) throw error;
        setAuthMessage("Passwort-Reset E-Mail wurde versendet.");
      }
    } catch (e) {
      setAuthError(String(e?.message || e || "Authentifizierung fehlgeschlagen"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAuthMessage("Du wurdest ausgeloggt.");
    } catch (e) {
      setAuthError(String(e?.message || e || "Logout fehlgeschlagen"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadHistory() {
    if (!supabase || !authUser) {
      setHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const { data, error } = await supabase
        .from("history_entries")
        .select("id,file_name,uploaded_at,row_count,header_count,score,issues_count")
        .order("uploaded_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      setHistoryItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setHistoryError(String(e?.message || e || "History konnte nicht geladen werden"));
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveHistoryEntry(meta) {
    if (!supabase || !authUser) return;
    try {
      const { error } = await supabase.from("history_entries").insert({
        user_id: authUser.id,
        file_name: meta.fileName || "Unbekannt",
        uploaded_at: new Date().toISOString(),
        row_count: meta.rowCount ?? null,
        header_count: meta.headerCount ?? null,
        score: meta.score ?? null,
        issues_count: meta.issuesCount ?? null,
      });
      if (error) throw error;
      loadHistory();
    } catch (_e) {
      // Fail silently so upload flow is not blocked.
    }
  }

  async function loadFeedbackTickets() {
    if (!supabase) {
      setFeedbackTickets([]);
      return;
    }
    setFeedbackTicketsLoading(true);
    try {
      const { data, error } = await supabase
        .from("feedback_tickets")
        .select("id,created_at,message,status,file_name,reporter_email,seller_key,category")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setFeedbackTickets(Array.isArray(data) ? data : []);
    } catch (_e) {
      setFeedbackTickets([]);
    } finally {
      setFeedbackTicketsLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, supabase]);

  useEffect(() => {
    if (route !== "feedback") return;
    loadFeedbackTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, supabase, authUser?.id]);

  async function submitQuickFeedback() {
    setFeedbackError("");
    setFeedbackMessage("");
    const message = String(feedbackText || "").trim();
    if (!message) {
      setFeedbackError("Bitte kurz beschreiben, was nicht stimmt.");
      return;
    }

    if (!authUser) {
      setFeedbackError("Bitte zuerst einloggen, damit wir das Ticket korrekt zuordnen können.");
      return;
    }
    try {
      const payload = {
        message,
        sellerKey: String(feedbackSellerKey || "").trim(),
        category: String(feedbackCategory || "score"),
        route,
        fileName: fileName || null,
        createdAt: new Date().toISOString(),
      };
      if (supabase) {
        setFeedbackSubmitting(true);
        const primaryInsert = await supabase.from("feedback_tickets").insert({
          message,
          route: payload.route,
          file_name: payload.fileName,
          reporter_user_id: authUser?.id || null,
          reporter_email: authUser?.email || null,
          seller_key: payload.sellerKey || null,
          category: payload.category || "score",
          status: "Open",
        });
        if (primaryInsert.error) {
          const fallbackInsert = await supabase.from("feedback_tickets").insert({
            message: `${message}${payload.sellerKey ? ` | seller_key: ${payload.sellerKey}` : ""}${payload.category ? ` | category: ${payload.category}` : ""}`,
            route: payload.route,
            file_name: payload.fileName,
            reporter_user_id: authUser?.id || null,
            reporter_email: authUser?.email || null,
            status: "Open",
          });
          if (fallbackInsert.error) throw fallbackInsert.error;
        }
      }
      const key = "feed_quick_feedback_reports";
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([payload, ...existing].slice(0, 100)));
      setFeedbackText("");
      setFeedbackSellerKey("");
      setFeedbackCategory("score");
      setFeedbackMessage("Danke! Dein Feedback wurde gespeichert.");
      if (route === "feedback") loadFeedbackTickets();
    } catch (e) {
      setFeedbackError(String(e?.message || e || "Feedback konnte nicht gespeichert werden."));
    } finally {
      setFeedbackSubmitting(false);
    }
  }

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

  function addAllowedRuleValue(kind, value) {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    if (typeof window !== "undefined") {
      const msg =
        kind === "material"
          ? `Diesen Material-Wert als erlaubt speichern?\n\n${raw}`
          : kind === "color"
          ? `Diesen Farb-Wert als erlaubt speichern?\n\n${raw}`
          : kind === "shipping_mode"
          ? `Diesen shipping_mode-Wert als erlaubt speichern?\n\n${raw}`
          : `Diesen Lieferumfang-Wert als erlaubt speichern?\n\n${raw}`;
      if (!window.confirm(msg)) return;
    }
    setRules((prev) => {
      const next = { ...prev };
      if (kind === "material") {
        const prevArr = Array.isArray(next.allowed_material) ? next.allowed_material : [];
        const lower = raw.toLowerCase();
        const exists = prevArr.some((x) => String(x).toLowerCase().trim() === lower);
        if (!exists) next.allowed_material = [...prevArr, raw];
      } else if (kind === "color") {
        const prevArr = Array.isArray(next.allowed_color) ? next.allowed_color : [];
        const lower = raw.toLowerCase();
        const exists = prevArr.some((x) => String(x).toLowerCase().trim() === lower);
        if (!exists) next.allowed_color = [...prevArr, raw];
      } else if (kind === "shipping_mode") {
        const prevArr = Array.isArray(next.allowed_shipping_mode) ? next.allowed_shipping_mode : [];
        const exists = prevArr.some((x) => String(x).trim() === raw);
        if (!exists) next.allowed_shipping_mode = [...prevArr, raw];
      } else if (kind === "delivery_includes") {
        const prevArr = Array.isArray(next.delivery_includes_allowlist) ? next.delivery_includes_allowlist : [];
        const exists = prevArr.some((x) => String(x).trim() === raw);
        if (!exists) next.delivery_includes_allowlist = [...prevArr, raw];
      }
      saveRules(next);
      return next;
    });
  }

  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [parseError, setParseError] = useState("");
  const fileInputRef = useRef(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackTickets, setFeedbackTickets] = useState([]);
  const [feedbackTicketsLoading, setFeedbackTicketsLoading] = useState(false);

  const [shopName, setShopName] = useState("");
  const [previewCount, setPreviewCount] = useState(40);
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
  const [activeStep, setActiveStep] = useState(1);
  const [showAllChecks, setShowAllChecks] = useState(false);

  const [imageMin, setImageMin] = useState(DEFAULT_RULES.image_min_per_product);
  const [imageSampleLimitStep5, setImageSampleLimitStep5] = useState(5);
  const [brokenImageIds, setBrokenImageIds] = useState([]);

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
    "category_path",
    "description",
    "stock_amount",
    "shipping_mode",
    "delivery_time",
    "price",
    "brand",
    "material",
    "color",
    "delivery_includes",
    "washable_cover",
    "mounting_side",
  ]);

  const [requiredFields] = useState([
    "ean",
    "seller_offer_id",
    "name",
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
      washable_cover: ["washable_cover", "waschbarer bezug", "waschbarer_bezug"],
      mounting_side: ["mounting_side", "montageseite", "einbau", "links_rechts"],
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
      m[key] = bestHeaderMatch(headers, candidates[key]);
    }
    return m;
  }, [headers]);

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

  const rowsWithIssues = useMemo(() => {
    const set = new Set();
    highlightedCells.forEach((id) => {
      const rowIndex = Number(String(id).split(":")[0]);
      if (!Number.isNaN(rowIndex) && rows[rowIndex]) {
        set.add(rows[rowIndex]);
      }
    });
    return set;
  }, [highlightedCells, rows]);

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
          usedOrBware: [],
        },
        invalidWashableCover: [],
        invalidMountingSide: [],
        invalidDeliveryTime: [],
        templateValueHits: [],
        lightingEnergyMissing: [],
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

    const missingEansByField = {
      material: [],
      color: [],
      delivery_includes: [],
      delivery_time: [],
      price: [],
      hs_code: [],
      manufacturer_name: [],
      manufacturer_country: [],
    };
    const fieldsForMissing = [
      ...optionalFields,
      "material",
      "color",
      "delivery_includes",
      "price",
      "hs_code",
      "manufacturer_name",
      "manufacturer_country",
    ];
    for (const f of fieldsForMissing) {
      const col = mapping[f];
      if (!col) continue;
      if (!missingEansByField[f]) missingEansByField[f] = [];
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

    const invalidDeliveryIncludes = [];
    if (mapping.delivery_includes) {
      const col = mapping.delivery_includes;
      let re = null;
      try {
        const pattern = String(rules?.delivery_includes_pattern ?? DEFAULT_RULES.delivery_includes_pattern);
        re = new RegExp(pattern, "i");
      } catch (e) {
        re = null;
      }
      const allowList = (rules?.delivery_includes_allowlist || DEFAULT_RULES.delivery_includes_allowlist || []).map((x) =>
        String(x).trim()
      );
      rows.forEach((r, idx) => {
        const vRaw = String(r[col] ?? "").trim();
        if (!vRaw) return;
        if (allowList.includes(vRaw)) return;
        const ok = re ? re.test(vRaw) : /(^|\s)(\d+)\s*[xX×]\s*\S+/i.test(vRaw);
        if (!ok) invalidDeliveryIncludes.push({ ean: eans[idx], value: vRaw });
      });
    }

    const invalidWashableCover = [];
    if (mapping.washable_cover) {
      const col = mapping.washable_cover;
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim().toLowerCase();
        if (!raw) return;
        if (raw !== "ja" && raw !== "nein") {
          invalidWashableCover.push({ ean: eans[idx], value: raw });
        }
      });
    }

    const invalidMountingSide = [];
    if (mapping.mounting_side) {
      const col = mapping.mounting_side;
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim().toLowerCase();
        if (!raw) return;
        if (raw !== "links" && raw !== "rechts" && raw !== "beidseitig") {
          invalidMountingSide.push({ ean: eans[idx], value: raw });
        }
      });
    }

    const invalidDeliveryTime = [];
    if (mapping.delivery_time) {
      const col = mapping.delivery_time;
      const reWithUnit = /^\s*\d+(?:\s*-\s*\d+)?\s*(werktage|arbeitstage|wochen)\s*$/i;
      const reSimpleNumber = /^\s*\d+(?:\s*-\s*\d+)?\s*$/;
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim();
        if (!raw) {
          invalidDeliveryTime.push({ ean: eans[idx], value: raw });
          return;
        }
        if (!reWithUnit.test(raw) && !reSimpleNumber.test(raw)) {
          invalidDeliveryTime.push({ ean: eans[idx], value: raw });
        }
      });
    }

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

    const invalidMaterial = [];
    const invalidColor = [];

    if (mapping.material && (rules?.allowed_material || DEFAULT_RULES.allowed_material).length) {
      const col = mapping.material;
      const allowedBase = (rules?.allowed_material || DEFAULT_RULES.allowed_material).map((x) =>
        String(x).toLowerCase().trim()
      );
      const materialBlacklist = ["keine angabe"];
      const allowed = allowedBase.filter((token) => token && !materialBlacklist.includes(token));
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim();
        if (!raw) return;
        const v = raw.toLowerCase();
        const containsAllowedToken = allowed.some((token) => token && v.includes(token));
        if (!containsAllowedToken || materialBlacklist.some((bad) => v.includes(bad))) {
          invalidMaterial.push({ ean: eans[idx], value: raw });
        }
      });
    }

    if (mapping.color && (rules?.allowed_color || DEFAULT_RULES.allowed_color).length) {
      const col = mapping.color;
      const allowed = (rules?.allowed_color || DEFAULT_RULES.allowed_color).map((x) =>
        String(x).toLowerCase().trim()
      );
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim();
        if (!raw) return;
        const v = raw.toLowerCase();
        const containsAllowedToken = allowed.some((token) => token && v.includes(token));
        if (!containsAllowedToken) {
          invalidColor.push({ ean: eans[idx], value: raw });
        }
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

    const descriptionIssues = {
      tooShort: [],
      advertising: [],
      externalLinks: [],
      variants: [],
      contactHint: [],
      templateLike: [],
      usedOrBware: [],
    };
    if (mapping.description) {
      const minDesc = Number(rules?.description_min_length ?? DEFAULT_RULES.description_min_length);
      rows.forEach((r, idx) => {
        const desc = String(r[mapping.description] ?? "").trim();
        if (desc.length < minDesc) descriptionIssues.tooShort.push(eans[idx]);
        if (/www\.|http|https/i.test(desc)) descriptionIssues.externalLinks.push(eans[idx]);
        if (/jetzt kaufen|rabatt|angebot/i.test(desc)) descriptionIssues.advertising.push(eans[idx]);
        if (/auswahl|in verschiedenen|ihrer wahl/i.test(desc)) descriptionIssues.variants.push(eans[idx]);
        if (/kontaktieren sie uns|hotline|kundenservice/i.test(desc)) descriptionIssues.contactHint.push(eans[idx]);

        const eanId = eans[idx];
        const titleVal = mapping.name ? String(r[mapping.name] ?? "").trim() : "";
        const descLower = desc.toLowerCase();
        const titleLower = titleVal.toLowerCase();

        if (
          /b-ware\b|b ware\b|bware\b|gebraucht\b|refurbished\b|generalüberholt\b|generalueberholt\b|rückläufer\b|ruecklaeufer\b|vorführgerät\b|vorfuehrgeraet\b|used\b/i.test(descLower) ||
          /b-ware\b|b ware\b|bware\b|gebraucht\b|refurbished\b|generalüberholt\b|generalueberholt\b|rückläufer\b|ruecklaeufer\b|vorführgerät\b|vorfuehrgeraet\b|used\b/i.test(titleLower)
        ) {
          descriptionIssues.usedOrBware.push(eanId);
          return;
        }

        if (desc && titleVal && descLower === titleLower) {
          descriptionIssues.templateLike.push(eanId);
          return;
        }

        const wordCount = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
        if (wordCount > 0 && wordCount <= 3) {
          descriptionIssues.templateLike.push(eanId);
          return;
        }

        if (/beispieltext|musterbeschreibung|lorem ipsum/i.test(descLower)) {
          descriptionIssues.templateLike.push(eanId);
        }
      });
    }

    const templateValueHits = [];
    const templateColumns = Object.keys(EXAMPLE_TEMPLATE_VALUES);
    templateColumns.forEach((field) => {
      const examples = (EXAMPLE_TEMPLATE_VALUES[field] || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      if (!examples.length) return;
      const col = mapping[field];
      if (!col) return;
      rows.forEach((r, idx) => {
        const raw = String(r[col] ?? "").trim();
        if (!raw) return;
        const v = raw.toLowerCase();
        if (examples.includes(v)) {
          templateValueHits.push({ ean: eans[idx], column: field, value: raw });
        }
      });
    });

    // Additional lighting / energy-efficiency requirements for products that look like lamps
    const lightingEnergyMissing = [];
    if (mapping.name) {
      const titleCol = mapping.name;
      const energyCol = mapping.energy_efficiency_label;
      const lightingInclCol = mapping.lighting_included;
      const eprelCol = mapping.eprel_registration_number;
      const hasAnyEnergyCols = energyCol || lightingInclCol || eprelCol;

      if (hasAnyEnergyCols) {
        const lampTokens = ["lampe", "leuchte", "leuchten", "licht", "beleuchtung", "led"];
        rows.forEach((r, idx) => {
          const titleRaw = String(r[titleCol] ?? "").toLowerCase();
          if (!titleRaw) return;
          const looksLikeLamp = lampTokens.some((tok) => titleRaw.includes(tok));
          if (!looksLikeLamp) return;

          let missingAny = false;
          if (energyCol && isBlank(r[energyCol])) missingAny = true;
          if (lightingInclCol && isBlank(r[lightingInclCol])) missingAny = true;
          if (eprelCol && isBlank(r[eprelCol])) missingAny = true;

          if (missingAny) {
            lightingEnergyMissing.push(eans[idx]);
          }
        });
      }
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
      invalidMaterial,
      invalidColor,
      invalidDeliveryIncludes,
      titleIssues,
      descriptionIssues,
      invalidWashableCover,
      invalidMountingSide,
      invalidDeliveryTime,
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
    const templateValuesBad = optionalFindings.templateValueHits?.length > 0;
    return anyMissing || imagesBad || shipBad || materialBad || colorBad || deliveryTimeBad || templateValuesBad
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
        const u = String(r?.[c] ?? "").trim();
        if (u) urls.push(u);
      }
      if (!urls.length) continue;
      const id = eanColumn
        ? String(r?.[eanColumn] ?? "").trim() || `ROW_${i + 1}`
        : `ROW_${i + 1}`;
      out.push({ id, urls });
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
      tips.push("Bitte prüfen Sie die Spaltennamen oder liefern Sie die fehlenden Pflichtfelder nach.");
    }

    if (eanColumn) {
      const missingEAN = rows.filter((r) => isBlank(r[eanColumn])).length;
      if (missingEAN > 0) {
        rows.forEach((r, idx) => {
          if (isBlank(r[eanColumn])) criticalRowIdx.add(idx);
        });
        addIssue(
          `EAN fehlt in ${missingEAN} Artikeln.`,
          findTargetByRowIndex(rows.findIndex((r) => isBlank(r[eanColumn])))
        );
      }
    } else {
      addIssue("EAN-Spalte fehlt. Ohne EAN ist eine Verarbeitung nicht möglich.");
      tips.push("Bitte liefern Sie eine EAN- oder GTIN-Spalte. Falls die Werte in Excel im E-Format stehen, bitte als Text formatieren.");
    }

    if (eanColumn) {
      if (duplicates.eanDup.size > 0) {
        duplicates.eanDup.forEach((idx) => criticalRowIdx.add(idx));
        const firstDupIndex = Array.from(duplicates.eanDup)[0];
        addIssue(`Doppelte EAN erkannt in ${duplicates.eanDup.size} Zeilen.`, findTargetByRowIndex(firstDupIndex));
      }

      if (optionalFindings.scientificEans.length > 0) {
        addRowsByEans(optionalFindings.scientificEans, criticalRowIdx);
        addIssue(
          `EAN Darstellungsproblem erkannt in ${optionalFindings.scientificEans.length} Artikeln. Werte wirken wie wissenschaftliche Schreibweise.`,
          findTargetsByEans(optionalFindings.scientificEans)
        );
        tips.push("Bitte EAN Spalte als Text formatieren, damit die komplette GTIN erhalten bleibt.");
      }
    }

    if (titleColumn && duplicates.titleDup.size > 0) {
      duplicates.titleDup.forEach((idx) => criticalRowIdx.add(idx));
      const firstTitleDupIndex = Array.from(duplicates.titleDup)[0];
      addIssue(`Doppelte Produkttitel erkannt in ${duplicates.titleDup.size} Zeilen.`, findTargetByRowIndex(firstTitleDupIndex));
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

    if (optionalMissingCount > 0) {
      addRowsByEans(
        [
          ...optionalFindings.missingEansByField.material,
          ...optionalFindings.missingEansByField.color,
          ...optionalFindings.missingEansByField.delivery_includes,
        ],
        warningRowIdx
      );
      tips.push("Optionalfelder wie Material, Farbe und Lieferumfang wenn möglich vollständig pflegen.");
    }

    if (missingPriceCount > 0) {
      addRowsByEans(optionalFindings.missingEansByField.price, criticalRowIdx);
      addIssue(`Preis fehlt bei ${missingPriceCount} Artikeln.`);
    }
    if (missingHsCodeCount > 0) {
      addRowsByEans(optionalFindings.missingEansByField.hs_code, warningRowIdx);
      tips.push(`HS‑Code fehlt bei ${missingHsCodeCount} Artikeln.`);
    }
    if (missingManufacturerNameCount > 0 || missingManufacturerCountryCount > 0) {
      addRowsByEans(optionalFindings.missingEansByField.manufacturer_name, warningRowIdx);
      addRowsByEans(optionalFindings.missingEansByField.manufacturer_country, warningRowIdx);
      tips.push(
        `Herstellerangaben fehlen bei ${
          missingManufacturerNameCount + missingManufacturerCountryCount
        } Artikeln (Name/Land).`
      );
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
      if (optionalFindings.imageOneEans.length > 0) {
        addRowsByEans(optionalFindings.imageOneEans, warningRowIdx);
        tips.push(`Nur ein Bild bei ${optionalFindings.imageOneEans.length} Artikeln. Empfohlen sind mindestens ${imageMin}.`);
      }
      if (optionalFindings.imageLowEans.length > 0) {
        addRowsByEans(optionalFindings.imageLowEans, warningRowIdx);
        tips.push(`Bitte pro Produkt mindestens ${imageMin} Bildlinks liefern.`);
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
      tips.push("Lieferumfang bitte im Format Anzahl x Produkt angeben, z. B. 1x Tisch, 4x Stuhl.");
      score -= 5;
    }

    if (mapping.delivery_time && optionalFindings.invalidDeliveryTime.length > 0) {
      addRowsByEanObjects(optionalFindings.invalidDeliveryTime, criticalRowIdx);
      addRowsByEanObjects(optionalFindings.invalidDeliveryTime, warningRowIdx);
      addIssue(
        `Lieferzeit ungültig in ${groupByValueWithEans(optionalFindings.invalidDeliveryTime).length} verschiedenen Werten.`,
        findTargetsByEans(optionalFindings.invalidDeliveryTime.map((x) => x?.ean))
      );
      tips.push('Lieferzeit bitte im Format z. B. "3-5 Werktage", "2 Wochen" oder "10 Arbeitstage" angeben.');
      score -= 5;
    }

    if (mapping.description) {
      if (optionalFindings.descriptionIssues.tooShort.length > 0) {
        addRowsByEans(optionalFindings.descriptionIssues.tooShort, criticalRowIdx);
        addRowsByEans(optionalFindings.descriptionIssues.tooShort, warningRowIdx);
        addIssue(
          `Beschreibungen zu kurz bei ${optionalFindings.descriptionIssues.tooShort.length} Artikeln (Mindestlänge laut Regeln-Tab).`,
          findTargetsByEans(optionalFindings.descriptionIssues.tooShort.map((x) => x?.ean))
        );
        tips.push("Produktbeschreibungen etwas ausfuehrlicher gestalten (Vorteile, Materialien, wichtige Eigenschaften).");
        score -= 3;
      }
      if (optionalFindings.descriptionIssues.templateLike.length > 0) {
        addRowsByEans(optionalFindings.descriptionIssues.templateLike, warningRowIdx);
        tips.push("Viele Beschreibungen wirken wie Platzhalter oder sehr kurz – bitte inhaltlich anpassen und auf das konkrete Produkt zuschneiden.");
        score -= 3;
      }
      if (optionalFindings.descriptionIssues.usedOrBware.length > 0) {
        addRowsByEans(optionalFindings.descriptionIssues.usedOrBware, criticalRowIdx);
        addRowsByEans(optionalFindings.descriptionIssues.usedOrBware, warningRowIdx);
        addIssue(
          `Hinweise auf B-Ware / gebrauchte Ware in ${optionalFindings.descriptionIssues.usedOrBware.length} Artikeln.`,
          findTargetsByEans(optionalFindings.descriptionIssues.usedOrBware.map((x) => x?.ean))
        );
        tips.push("Wir können keine gebrauchten oder als B-Ware gekennzeichneten Produkte akzeptieren.");
        score -= 15;
      }
    }

    if (mapping.shipping_mode) {
      if (optionalFindings.missingShipping.length > 0) {
        addRowsByEans(optionalFindings.missingShipping, criticalRowIdx);
        addIssue(
          `shipping_mode fehlt in ${optionalFindings.missingShipping.length} Artikeln.`,
          findTargetsByEans(optionalFindings.missingShipping)
        );
      }
      if (optionalFindings.invalidShipping.length > 0) {
        addRowsByEanObjects(optionalFindings.invalidShipping, criticalRowIdx);
        addIssue(
          `shipping_mode ungueltig in ${optionalFindings.invalidShipping.length} Artikeln. Erlaubt sind Paket oder Spedition.`,
          findTargetsByEans(optionalFindings.invalidShipping.map((x) => x?.ean))
        );
      }
    }
    if (mapping.description && optionalFindings.descriptionIssues.externalLinks.length > 0) {
      addRowsByEans(optionalFindings.descriptionIssues.externalLinks, criticalRowIdx);
      addRowsByEans(optionalFindings.descriptionIssues.externalLinks, warningRowIdx);
      addIssue(
        `Externe Links in Beschreibungen bei ${optionalFindings.descriptionIssues.externalLinks.length} Artikeln.`,
        findTargetsByEans(optionalFindings.descriptionIssues.externalLinks.map((x) => x?.ean))
      );
      tips.push("Bitte in der Beschreibung keine externen Links oder Werbung auf andere Seiten einfuegen.");
      score -= 3;
    }

    if (!mapping.size) {
      tips.push(
        "Bitte Maße (z. B. Höhe/Breite/Tiefe) je Produkt klar angeben – idealerweise in separaten Spalten oder im Titel/Beschreibung."
      );
    }

    score = Math.max(0, score);

    let shippingAllMissing = false;
    if (mapping.shipping_mode) {
      const col = mapping.shipping_mode;
      shippingAllMissing = rows.length > 0 && rows.every((r) => isBlank(r[col]));
      if (shippingAllMissing) {
        addIssue("shipping_mode ist fuer keinen Artikel befuellt.");
        addAllRows(criticalRowIdx);
        score -= 10;
      }
    }

    let deliveryAllMissing = false;
    if (mapping.delivery_includes) {
      const col = mapping.delivery_includes;
      deliveryAllMissing = rows.length > 0 && rows.every((r) => isBlank(r[col]));
      if (deliveryAllMissing) {
        addIssue("Lieferumfang ist fuer keinen Artikel befuellt.");
        addAllRows(criticalRowIdx);
        score -= 10;
      }
    }

    const canStart =
      score >= 50 &&
      requiredPresence.missing.length === 0 &&
      !!eanColumn &&
      rows.every((r) => !isBlank(r[eanColumn])) &&
      duplicates.titleDup.size === 0 &&
      (mapping.shipping_mode ? rows.every((r) => !isBlank(r[mapping.shipping_mode])) : true) &&
      !shippingAllMissing &&
      !deliveryAllMissing &&
      (optionalFindings.lightingEnergyMissing?.length || 0) === 0 &&
      brokenImageIds.length === 0;

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
      criticalRowsCount: criticalRowIdx.size,
      criticalRowsPct,
      warningRowsCount: warningRowIdx.size,
      warningRowsPct,
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

  const [step2Expanded, setStep2Expanded] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const step6Ref = useRef(null);
  const previewTableRef = useRef(null);
  const previewAutoLoadLockRef = useRef(false);
  const [pendingJumpRowKey, setPendingJumpRowKey] = useState(null);
  const [highlightedJumpRowKey, setHighlightedJumpRowKey] = useState(null);

  const filteredPreviewRows = useMemo(() => {
    return rows
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
      })
      .filter((r) => (showIssueRowsOnly ? rowsWithIssues.has(r) : true));
  }, [rows, eanSearchTerms, eanColumn, showIssueRowsOnly, rowsWithIssues]);

  useEffect(() => {
    if (!headers.length) return;
    if (!allRequiredOk) setStep2Expanded(true);
  }, [allRequiredOk, headers.length]);

  useEffect(() => {
    if (highlightedJumpRowKey == null) return;
    const t = window.setTimeout(() => setHighlightedJumpRowKey(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlightedJumpRowKey]);

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
    const targetMaxRowIndex = rowIndicesArr.length ? Math.max(...rowIndicesArr) : null;
    if (targetMaxRowIndex != null && targetMaxRowIndex >= 0) {
      setPreviewCount((current) => Math.max(current, targetMaxRowIndex + 1));
    }
    if (targetFirstRowIndex != null && targetFirstRowIndex >= 0) {
      const rowKey = String(targetFirstRowIndex);
      setPendingJumpRowKey(rowKey);
      setHighlightedJumpRowKey(rowKey);
    }

    previewTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  function onPickFile(file) {
    setPreviewCount(20);
    setParseError("");
    setFileName(file?.name || "");
    setEanSearch("");
    setRawRows([]);
    setHeaders([]);
    setBrokenImageIds([]);

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
        saveHistoryEntry({
          fileName: file?.name || "",
          rowCount: data.length,
          headerCount: h.length,
        });
      },
      error: (err) => setParseError(String(err || "CSV parsing error")),
    });
  }

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
        <button
          type="button"
          onClick={() => setColumnFilterOpen((v) => !v)}
          aria-label="Spalten wählen"
          title="Spalten wählen"
          style={{
            padding: "6px 8px",
            borderRadius: 999,
            border: "1px solid #E5E7EB",
            background: "#FFFFFF",
            fontSize: 14,
            cursor: "pointer",
            color: "#111827",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 32,
          }}
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => setShowIssueRowsOnly((v) => !v)}
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
        <div style={{ marginTop: 8, padding: 8, borderRadius: 8, border: "1px solid #E5E7EB", background: "#FFFFFF", maxHeight: 180, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <SmallText>Spalten anzeigen/verstecken</SmallText>
            <button
              type="button"
              onClick={() => {
                setVisibleColumns((prev) => {
                  const allKeys = headers;
                  const allSelected = !Array.isArray(prev) || prev.length === allKeys.length;
                  return allSelected ? [] : null;
                });
              }}
              style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", color: "#111827" }}
            >
              {(!Array.isArray(visibleColumns) || visibleColumns.length === headers.length) ? "Alle abwählen" : "Alle auswählen"}
            </button>
          </div>
          <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {headers.map((h) => {
              const isActive = !Array.isArray(visibleColumns) || visibleColumns.includes(h);
              return (
                <label key={h} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#111827" }}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => {
                      setVisibleColumns((prev) => {
                        const current = Array.isArray(prev) ? new Set(prev) : new Set(headers);
                        if (e.target.checked) { current.add(h); } else { current.delete(h); }
                        const next = Array.from(current);
                        return next.length === headers.length ? null : next;
                      });
                    }}
                  />
                  <span>{String(h)}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
    <div ref={previewTableRef} style={{ marginTop: 8 }}>
      <ResizableTable
        columns={previewColumns}
        rows={filteredPreviewRows.slice(0, previewCount)}
        highlightedCells={highlightedCells}
        getRowTargetKey={(r) => r.__rowIndex}
        targetRowKey={pendingJumpRowKey}
        highlightedRowKey={highlightedJumpRowKey}
        onTargetHandled={() => setPendingJumpRowKey(null)}
      />
      <div style={{ marginTop: 8 }}>
        <SmallText>Zeige {Math.min(previewCount, filteredPreviewRows.length)} von {filteredPreviewRows.length} Zeilen.</SmallText>
      </div>
    </div>
    </>
  );

  function FeedPreviewPanel({ headers, children }) {
    if (!headers.length) return null;
    return (
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          if (!nearBottom) return;
          if (previewCount >= filteredPreviewRows.length) return;
          if (previewAutoLoadLockRef.current) return;
          previewAutoLoadLockRef.current = true;
          setPreviewCount((c) => Math.min(filteredPreviewRows.length, c + 20));
          window.setTimeout(() => {
            previewAutoLoadLockRef.current = false;
          }, 150);
        }}
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

  const topNav = (
    <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", position: "sticky", top: 0, zIndex: 50 }}>
      <div
        style={{
          width: "100%",
          maxWidth: "none",
          margin: 0,
          padding: "12px 12px",
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
            type="button"
            onClick={() => { window.location.hash = "#/checker"; }}
            style={{ border: "none", background: "transparent", padding: 0, margin: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
            aria-label="Feed Checker Startseite"
            title="Feed Checker"
          >
            <img
              src="/feedchecker-logo.png"
              alt="Feed Checker"
              style={{ height: 44, width: "auto", maxWidth: 340, display: "block" }}
            />
          </button>
          {["checker", "qs", "feedback"].map((r) => {
            const labels = { checker: "Checker", qs: "QS/APA", feedback: "Feedback" };
            return (
              <button
                key={r}
                onClick={() => { window.location.hash = r === "checker" ? "#/checker" : `#/${r}`; }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: `1px solid ${BRAND_COLOR}`,
                  background: route === r ? BRAND_COLOR : "#FFFFFF",
                  color: route === r ? "#FFFFFF" : BRAND_COLOR,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                {labels[r]}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {authUser?.email ? (
            <div style={{ fontSize: 12, color: "#374151", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {authUser.email}
            </div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => { window.location.hash = "#/login"; }}
        style={{
          position: "absolute",
          right: 16,
          top: 8,
          padding: "10px 18px",
          borderRadius: 999,
          border: `1px solid ${BRAND_COLOR}`,
          background: route === "login" ? "#1E3A8A" : BRAND_COLOR,
          color: "#FFFFFF",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          zIndex: 1,
        }}
      >
        <span aria-hidden="true">🔐</span>
        <span>{authUser ? "Konto" : "Login"}</span>
      </button>
    </div>
  );

  const stickyFeedbackCta =
    route !== "login" ? (
      <>
        {feedbackOpen ? (
          <div
            style={{
              position: "fixed",
              right: 20,
              bottom: 76,
              zIndex: 61,
              width: "min(360px, calc(100vw - 24px))",
              padding: 12,
              borderRadius: 14,
              border: "1px solid #E5E7EB",
              background: "#FFFFFF",
              boxShadow: "0 18px 30px rgba(15, 23, 42, 0.24)",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Schnelles Feedback</div>
              <button
                type="button"
                onClick={() => setFeedbackOpen(false)}
                style={{
                  border: "1px solid #E5E7EB",
                  background: "#F9FAFB",
                  borderRadius: 999,
                  padding: "4px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Schließen
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#6B7280" }}>
              Melde kurz einen Fehler oder eine falsche Bewertung.
            </div>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Was ist falsch? (z. B. Score wirkt zu niedrig für EAN ...)"
              rows={4}
              style={{
                width: "100%",
                boxSizing: "border-box",
                borderRadius: 10,
                border: "1px solid #D1D5DB",
                padding: 10,
                fontSize: 12,
                resize: "vertical",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                value={feedbackSellerKey}
                onChange={(e) => setFeedbackSellerKey(e.target.value)}
                placeholder="seller_key (optional)"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 10,
                  border: "1px solid #D1D5DB",
                  padding: 10,
                  fontSize: 12,
                }}
              />
              <select
                value={feedbackCategory}
                onChange={(e) => setFeedbackCategory(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 10,
                  border: "1px solid #D1D5DB",
                  padding: 10,
                  fontSize: 12,
                  background: "#FFFFFF",
                }}
              >
                <option value="score">Kategorie: Score</option>
                <option value="validation">Kategorie: Validierung</option>
                <option value="ui">Kategorie: UI</option>
                <option value="other">Kategorie: Sonstiges</option>
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={submitQuickFeedback}
                disabled={feedbackSubmitting}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: `1px solid ${BRAND_COLOR}`,
                  background: BRAND_COLOR,
                  color: "#FFFFFF",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: feedbackSubmitting ? "not-allowed" : "pointer",
                }}
              >
                {feedbackSubmitting ? "Sende..." : "Feedback senden"}
              </button>
              {fileName ? (
                <div style={{ fontSize: 11, color: "#6B7280" }}>Datei: {fileName}</div>
              ) : null}
            </div>
            {feedbackError ? (
              <div style={{ fontSize: 12, color: "#B91C1C" }}>{feedbackError}</div>
            ) : null}
            {feedbackMessage ? (
              <div style={{ fontSize: 12, color: "#166534" }}>{feedbackMessage}</div>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setFeedbackOpen((v) => !v)}
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 60,
            padding: "12px 16px",
            borderRadius: 999,
            border: `1px solid ${BRAND_COLOR}`,
            background: BRAND_COLOR,
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: 800,
            boxShadow: "0 10px 20px rgba(15, 23, 42, 0.2)",
            cursor: "pointer",
          }}
          aria-label="Feedback öffnen"
          title="Feedback senden"
        >
          {feedbackOpen ? "Feedback schließen" : "Feedback"}
        </button>
      </>
    ) : null;

  const historyCardBody = !isSupabaseConfigured ? (
    <div style={{ fontSize: 13, color: "#92400E" }}>
      Supabase ist noch nicht konfiguriert.
    </div>
  ) : !authUser ? (
    <div style={{ fontSize: 13, color: "#6B7280" }}>
      Bitte einloggen, um deine zuletzt geprueften Dateien zu sehen.
    </div>
  ) : historyLoading ? (
    <div style={{ fontSize: 13, color: "#6B7280" }}>History wird geladen...</div>
  ) : historyError ? (
    <div style={{ fontSize: 13, color: "#B91C1C" }}>{historyError}</div>
  ) : historyItems.length === 0 ? (
    <div style={{ fontSize: 13, color: "#6B7280" }}>
      Noch keine geprueften Dateien vorhanden.
    </div>
  ) : (
    <div style={{ display: "grid", gap: 8 }}>
      {historyItems.map((item) => (
        <div
          key={item.id}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            background: "#F9FAFB",
            fontSize: 12,
            color: "#111827",
            display: "grid",
            gap: 2,
          }}
        >
          <div style={{ fontWeight: 700 }}>{item.file_name || "Unbekannte Datei"}</div>
          <div style={{ color: "#6B7280" }}>
            {item.uploaded_at ? new Date(item.uploaded_at).toLocaleString() : "-"}
          </div>
          <div style={{ color: "#6B7280" }}>
            Zeilen: {item.row_count ?? "-"} | Spalten: {item.header_count ?? "-"}
          </div>
        </div>
      ))}
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
              marginTop: 0,
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ padding: "8px 12px", borderRadius: 999, border: `1px solid ${BRAND_COLOR}`, background: "#FFFFFF", fontSize: 12, fontWeight: 700, color: BRAND_COLOR, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Datei auswählen
                </button>
                <button
                  type="button"
                  onClick={() => window.open("http://media-partner.moebel.check24.de/feedvorlagen/Feedleitfaden_Anhang_2026/CHECK24_Feedvorlage_V2025.xlsx", "_blank", "noopener,noreferrer")}
                  style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid #CBD5E1", background: "#F9FAFB", fontSize: 11, fontWeight: 600, color: "#111827", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  Feedvorlage (Excel) herunterladen
                </button>
                <div style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                  {fileName ? `Aktuelle Datei: ${fileName}` : "Unterstuetzt CSV Dateien mit Kopfzeile"}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={(e) => onPickFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
              </div>
              {parseError ? <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>Fehler beim Einlesen {parseError}</div> : null}
            </StepCard>

            {/* CHECKER EMPTY-STATE HISTORY */}
            {!headers.length ? (
              <StepCard
                title="History"
                status="idle"
                subtitle="Zuletzt geprüfte Dateien"
              >
                {historyCardBody}
              </StepCard>
            ) : null}

            {headers.length ? (
              <>
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
                        borderRadius: 14,
                        border: `1px solid ${summaryVisual.border}`,
                        background: summaryVisual.bg,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Pill tone={summary.canStart ? "ok" : "warn"}>
                          {summary.canStart ? "✅ Feed ist startklar" : "🚧 Noch nicht startklar"}
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
                          {(summary.tips.length ? summary.tips : ["Keine weiteren Empfehlungen."]).map((x, idx) => (
                            <li key={idx}>{x}</li>
                          ))}
                        </ul>
                      </div>
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
                    <span>
                      {optionalFields.length
                        ? `${optionalPresence.found.length}/${optionalFields.length} optionale Felder erkannt`
                        : "Keine optionalen Felder konfiguriert"}
                    </span>
                    {allRequiredOk ? (
                      <button
                        type="button"
                        onClick={() => setStep2Expanded((v) => !v)}
                        style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(22,101,52,0.25)", background: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        {step2Expanded ? "Details ausblenden" : "Details anzeigen"}
                      </button>
                    ) : null}
                  </div>

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
                        <SmallText>Diese Felder muessen fuer jeden Artikel erkannt werden.</SmallText>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {requiredFields.map((f) => {
                            const col = mapping[f];
                            const missing = !col;
                            return (
                              <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, padding: 6, borderRadius: 10, border: "1px solid #E5E7EB", background: missing ? "#FEF3C7" : "#ECFDF3", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{f}</div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <div style={{ fontSize: 12, color: missing ? "#92400E" : "#166534" }}>{col ? `Spalte ${col}` : "Nicht gefunden"}</div>
                                  <Pill tone={missing ? "warn" : "ok"}>{missing ? "Fehlt" : "OK"}</Pill>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: requiredPresence.missing.length ? "#92400E" : "#166534" }}>
                          {requiredPresence.missing.length
                            ? `Noch ${requiredPresence.missing.length} von ${requiredFields.length} Pflichtfeldern ohne Zuordnung.`
                            : `Alle ${requiredFields.length} Pflichtfelder wurden automatisch zugeordnet.`}
                        </div>
                      </div>

                      <div style={{ padding: 8, borderRadius: 12, border: "1px solid #E5E7EB", background: "#FFFFFF" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Optionale Felder</div>
                        <SmallText>Diese Felder sind nicht zwingend, verbessern aber Qualitaet und Score.</SmallText>
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          {optionalFields.map((f) => {
                            const col = mapping[f];
                            const missing = !col;
                            return (
                              <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, padding: 6, borderRadius: 10, border: "1px solid #E5E7EB", background: missing ? "#F9FAFB" : "#EEF2FF", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{f}</div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <div style={{ fontSize: 12, color: missing ? "#6B7280" : BRAND_COLOR }}>{col ? `Spalte ${col}` : "Nicht gefunden"}</div>
                                  <Pill tone={missing ? "info" : "ok"}>{missing ? "Optional" : "OK"}</Pill>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: "#4B5563" }}>
                          {optionalFields.length
                            ? `${optionalPresence.found.length} von ${optionalFields.length} optionalen Feldern wurden automatisch zugeordnet.`
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
            <StepCard title="Duplikate" status={stage2Status} subtitle="Wir prüfen doppelte EAN und doppelte Produkttitel">
              {!headers.length ? (
                <SmallText>Bitte CSV hochladen, um Duplikate zu prüfen.</SmallText>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Pill tone={eanColumn ? "ok" : "warn"}>{eanColumn ? `EAN Spalte ${eanColumn}` : "EAN Spalte nicht gefunden"}</Pill>
                    <Pill tone={titleColumn ? "ok" : "warn"}>{titleColumn ? `Titel Spalte ${titleColumn}` : "Titel Spalte nicht gefunden"}</Pill>
                  </div>

                  {duplicateEans.length > 0 || duplicateTitleRows.length > 0 || duplicateSellerOfferIds.length > 0 ? (
                    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                      {duplicateEans.length > 0 ? (
                        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Doppelte EAN Werte</div>
                          <SmallText>Liste der EAN Werte die mehr als einmal vorkommen</SmallText>
                          <div style={{ marginTop: 10 }}>
                            <CollapsibleList title="Doppelte EAN" items={duplicateEans} tone="warn" />
                          </div>
                        </div>
                      ) : null}

                      {duplicateTitleRows.length > 0 ? (
                        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Doppelte Titel</div>
                          <div style={{ marginTop: 10 }}>
                            <CollapsibleList
                              title="Doppelte Titel"
                              items={groupByValueWithEans(duplicateTitleRows.map((x) => ({ value: x.title, ean: x.ean })))
                                .filter((g) =>
                                  !eanSearchTerms.length
                                    ? true
                                    : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                                )
                                .map((g) => `${g.value} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                              tone="warn"
                              hint="Jede Zeile zeigt einen Titel und alle EANs, die diesen Titel mehrfach verwenden"
                            />
                          </div>
                        </div>
                      ) : null}

                      {duplicateSellerOfferIds.length > 0 ? (
                        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Doppelte Seller_Offer_ID Werte</div>
                          <SmallText>Liste der Seller_Offer_ID Werte die mehr als einmal vorkommen</SmallText>
                          <div style={{ marginTop: 10 }}>
                            <CollapsibleList title="Doppelte Seller_Offer_ID" items={duplicateSellerOfferIds} tone="warn" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </StepCard>
            )}

            {/* STEP 4 */}
            {hasOptionalShippingFindings && (
            <StepCard title="Optionale Felder und Versand" status={stage3Status}>
              {!headers.length ? (
                <SmallText>Bitte CSV hochladen, um optionale Felder und Versand zu prüfen.</SmallText>
              ) : (
                <>
                  {optionalFindings.missingEANs.length > 0 ? (
                    <div style={{ marginTop: 14 }}>
                      <CollapsibleList
                        title="Zeilen ohne EAN"
                        items={optionalFindings.missingEANs
                          .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                          .map((ean) => ({ value: ean, eans: [ean] }))}
                        tone="bad"
                        hint="➜ bitte EAN nachliefern"
                        onItemClick={(ean) =>
                          jumpToIssueTarget({
                            ean,
                            rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                          })
                        }
                      />
                    </div>
                  ) : null}

                  {(optionalFindings.missingEansByField.material.length > 0 || (optionalFindings.invalidMaterial?.length || 0) > 0) && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        {optionalFindings.missingEansByField.material.length > 0 ? (
                          <CollapsibleList
                            title="Material fehlt"
                            items={optionalFindings.missingEansByField.material
                              .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                              .map((ean) => ({ value: "leer", eans: [ean] }))}
                            tone="warn"
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                        {optionalFindings.invalidMaterial?.length ? (
                          <CollapsibleList
                            title="Material ausserhalb erlaubter Werte"
                            items={groupByValueWithEans(optionalFindings.invalidMaterial).filter((g) =>
                              !eanSearchTerms.length
                                ? true
                                : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                            )}
                            tone="warn"
                            hint="Werte, die nicht in der Material-Liste im Regeln-Tab stehen, gruppiert nach Wert"
                            onAddValue={(value) => addAllowedRuleValue("material", value)}
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                        {optionalFindings.invalidMaterial?.length ? (
                          <div>
                            <SmallText>Einzelne Material-Werte als erlaubt markieren:</SmallText>
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {uniqueNonEmpty(optionalFindings.invalidMaterial.map((x) => x.value)).map((val) => (
                                <button key={val} onClick={() => addAllowedRuleValue("material", val)} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", fontSize: 11, cursor: "pointer", color: "#111827" }}>{val} als erlaubt speichern</button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {(optionalFindings.missingEansByField.color.length > 0 || (optionalFindings.invalidColor?.length || 0) > 0) && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        {optionalFindings.missingEansByField.color.length > 0 ? (
                          <CollapsibleList
                            title="Farbe fehlt"
                            items={optionalFindings.missingEansByField.color
                              .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                              .map((ean) => ({ value: ean, eans: [ean] }))}
                            tone="warn"
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                        {optionalFindings.invalidColor?.length ? (
                          <>
                            <CollapsibleList
                              title="Farbe ausserhalb erlaubter Werte"
                              items={groupByValueWithEans(optionalFindings.invalidColor).filter((g) =>
                                !eanSearchTerms.length
                                  ? true
                                  : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                              )}
                              tone="warn"
                              hint="Werte, die nicht in der Farb-Liste im Regeln-Tab stehen, gruppiert nach Wert"
                              onAddValue={(value) => addAllowedRuleValue("color", value)}
                              onItemClick={(ean) =>
                                jumpToIssueTarget({
                                  ean,
                                  rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                                })
                              }
                            />
                            <div>
                              <SmallText>Einzelne Farb-Werte als erlaubt markieren:</SmallText>
                              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {uniqueNonEmpty(optionalFindings.invalidColor.map((x) => x.value)).map((val) => (
                                  <button key={val} onClick={() => addAllowedRuleValue("color", val)} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", fontSize: 11, cursor: "pointer", color: "#111827" }}>{val} als erlaubt speichern</button>
                                ))}
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {(optionalFindings.missingEansByField.delivery_includes.length > 0 || (optionalFindings.invalidDeliveryIncludes?.length || 0) > 0) && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        {optionalFindings.missingEansByField.delivery_includes.length > 0 ? (
                          <CollapsibleList
                            title="Lieferumfang fehlt"
                            items={optionalFindings.missingEansByField.delivery_includes
                              .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                              .map((ean) => ({ value: ean, eans: [ean] }))}
                            tone="warn"
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                        {optionalFindings.invalidDeliveryIncludes?.length ? (
                          <CollapsibleList
                            title="Lieferumfang ausserhalb Pattern"
                            items={groupByValueWithEans(optionalFindings.invalidDeliveryIncludes).filter((g) =>
                              !eanSearchTerms.length
                                ? true
                                : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                            )}
                            tone="warn"
                            hint="Werte, die nicht zum aktuellen Lieferumfang-Pattern passen, gruppiert nach Wert"
                            onAddValue={(value) => addAllowedRuleValue("delivery_includes", value)}
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  )}

                  {mapping.delivery_time && ((optionalFindings.missingEansByField.delivery_time && optionalFindings.missingEansByField.delivery_time.length > 0) || (optionalFindings.invalidDeliveryTime?.length > 0)) ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Lieferzeit (delivery_time)</div>
                      <SmallText>Erwartetes Format z B &quot;3-5 Werktage&quot; oder &quot;2 Wochen&quot; ohne zusaetzlichen Fliesstext.</SmallText>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {optionalFindings.missingEansByField.delivery_time && optionalFindings.missingEansByField.delivery_time.length > 0 ? (
                          <CollapsibleList
                            title="Lieferzeit fehlt"
                            items={optionalFindings.missingEansByField.delivery_time
                              .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                              .map((ean) => ({ value: ean, eans: [ean] }))}
                            tone="warn"
                            onItemClick={(ean) =>
                              jumpToIssueTarget({
                                ean,
                                rowIndex: rows.findIndex((r) => String(r?.[eanColumn] ?? "").trim() === String(ean)),
                              })
                            }
                          />
                        ) : null}
                        {optionalFindings.invalidDeliveryTime?.length ? (
                          <CollapsibleList
                            title="Lieferzeit ausserhalb erlaubter Formate"
                            items={groupByValueWithEans(optionalFindings.invalidDeliveryTime)
                              .filter((g) =>
                                !eanSearchTerms.length
                                  ? true
                                  : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                              )
                              .map((g) => `${g.value || "(leer)"} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                            tone="warn"
                            hint='Erwartet werden Angaben wie "3-5 Werktage", "2 Wochen" oder "10 Arbeitstage" ohne Mischformen.'
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {optionalFindings.templateValueHits && optionalFindings.templateValueHits.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Beispielwerte aus Muster-Feed</div>
                      <SmallText>In diesen Feldern scheinen noch Beispiel-/Demo-Werte aus dem Muster-Feed zu stehen. Bitte fuer echte Produkte entfernen oder korrekt ausfuellen.</SmallText>
                      <div style={{ marginTop: 8 }}>
                        <CollapsibleList
                          title="Felder mit Beispielwerten"
                          items={groupByValueWithEans(optionalFindings.templateValueHits)
                            .filter((g) =>
                              !eanSearchTerms.length
                                ? true
                                : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                            )
                            .map((g) => `${g.value} (${g.eans.length} EANs, Spalte ${g.column || "unbekannt"}): ${g.eans.join(", ")}`)}
                          tone="warn"
                          hint="Werte, die wie Beispielangaben aus einem Muster-Feed aussehen (z.B. Demo-URLs, Platzhalter)."
                        />
                      </div>
                    </div>
                  ) : null}

                  {mapping.washable_cover && optionalFindings.invalidWashableCover.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Waschbarer Bezug (washable_cover)</div>
                      <SmallText>Erlaubt sind nur die Werte &quot;ja&quot; oder &quot;nein&quot;.</SmallText>
                      <div style={{ marginTop: 8 }}>
                        <CollapsibleList
                          title="Ungültige washable_cover Werte"
                          items={groupByValueWithEans(optionalFindings.invalidWashableCover)
                            .filter((g) =>
                              !eanSearchTerms.length
                                ? true
                                : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                            )
                            .map((g) => `${g.value} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                          tone="warn"
                          hint='Waschbarer Bezug sollte nur "ja" oder "nein" enthalten'
                        />
                      </div>
                    </div>
                  ) : null}

                  {mapping.mounting_side && optionalFindings.invalidMountingSide.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Montageseite (mounting_side)</div>
                      <SmallText>Erlaubt sind nur die Werte &quot;links&quot;, &quot;rechts&quot; oder &quot;beidseitig&quot; – Kombinationen wie &quot;links, rechts, beidseitig&quot; sind nicht erlaubt.</SmallText>
                      <div style={{ marginTop: 8 }}>
                      <CollapsibleList
                        title="Ungültige mounting_side Werte"
                        items={groupByValueWithEans(optionalFindings.invalidMountingSide)
                          .filter((g) =>
                            !eanSearchTerms.length
                              ? true
                              : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                          )
                          .map((g) => `${g.value} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                        tone="warn"
                        hint='Montageseite sollte nur "links", "rechts" oder "beidseitig" enthalten'
                      />
                      </div>
                    </div>
                  ) : null}

                  {mapping.shipping_mode && (optionalFindings.missingShipping.length > 0 || optionalFindings.invalidShipping.length > 0) ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>shipping_mode</div>
                      <SmallText>Erlaubt sind Paket oder Spedition. Weitere erlaubte Werte koennen im Regeln Tab gepflegt werden.</SmallText>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {optionalFindings.missingShipping.length > 0 ? (
                          <CollapsibleList
                            title="shipping_mode fehlt"
                            items={optionalFindings.missingShipping
                              .filter((x) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(x).includes(t)))
                              .map((x) => `${x}: None`)}
                            tone="warn"
                            hint="Felder ohne Versandart"
                          />
                        ) : null}
                        {optionalFindings.invalidShipping.length > 0 ? (
                          <CollapsibleList
                            title="shipping_mode ausserhalb erlaubter Werte"
                            items={groupByValueWithEans(optionalFindings.invalidShipping)
                              .filter((g) =>
                                !eanSearchTerms.length
                                  ? true
                                  : g.eans.some((ean) => eanSearchTerms.some((t) => String(ean).includes(t)))
                              )
                              .map((g) => `${g.value} – ${g.eans.length} EANs: ${g.eans.join(", ")}`)}
                            tone="warn"
                            hint="Werte, die nicht in der shipping_mode-Liste im Regeln-Tab stehen, gruppiert nach Wert"
                            onAddValue={(value) => addAllowedRuleValue("shipping_mode", value)}
                          />
                        ) : null}
                        {optionalFindings.invalidShipping.length ? (
                          <div>
                            <SmallText>Einzelne Versandarten als erlaubt markieren:</SmallText>
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {uniqueNonEmpty(optionalFindings.invalidShipping.map((x) => x.value)).map((val) => (
                                <button key={val} onClick={() => addAllowedRuleValue("shipping_mode", val)} style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", fontSize: 11, cursor: "pointer", color: "#111827" }}>{val} als erlaubt speichern</button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
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
              

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    <div style={{ padding: 12, borderRadius: 14, border: "1px solid #E5E7EB", background: "#F9FAFB", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Anzahl Bilder pro Produkt</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {(() => {
                          const items = [];
                          const keys = Object.keys(imageBuckets || {}).map((k) => Number(k)).filter((k) => Number.isFinite(k) && k >= 0);
                          if (!keys.length) {
                            items.push(<SmallText key="no-images">Es konnten keine Bildinformationen ermittelt werden.</SmallText>);
                            return items;
                          }
                          const maxN = Math.max(...keys);
                          for (let n = 0; n <= maxN; n += 1) {
                            const list = imageBuckets[n] || [];
                            if (!list.length) continue;
                            const tone = n === 0 ? "bad" : n === 1 ? "warn" : "ok";
                            const title = n === 0 ? `0 Bilder (${list.length})` : n === 1 ? `1 Bild (${list.length})` : `${n} Bilder (${list.length})`;
                            const hint = n === 0 ? "EANs ohne jegliche Bilder" : n === 1 ? "EANs mit genau einem Bild" : `EANs mit genau ${n} Bildern`;
                            items.push(<CollapsibleList key={`img-${n}`} title={title} items={list} tone={tone} hint={hint} />);
                          }
                          return items;
                        })()}
                      </div>
                    </div>
                  </div>

                  {imageSamples.length ? (
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                      {imageSamples
                        .filter((s) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(s.id).includes(t)))
                        .slice(0, imageSampleLimitStep5)
                        .map((sample) => (
                        <div key={sample.id} style={{ padding: 10, borderRadius: 14, border: "1px solid #E5E7EB", background: "#FFFFFF", display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
                          <div style={{ minWidth: 0, maxWidth: 220 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sample.id}</div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {sample.urls.slice(0, 6).map((u) => (
                              <a
                                key={u}
                                href={u}
                                target="_blank"
                                rel="noreferrer"
                                title={u}
                                style={{ display: "block", width: 64, height: 64, flexShrink: 0 }}
                              >
                                <div style={{ width: 64, height: 64, position: "relative" }}>
                                  <img
                                    src={u}
                                    alt="Bild"
                                    loading="lazy"
                                    style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 12, border: "1px solid #E5E7EB", background: "#F9FAFB", display: "block" }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                      const fallback = e.currentTarget.nextElementSibling;
                                      if (fallback && fallback instanceof HTMLElement) fallback.style.display = "flex";
                                      setBrokenImageIds((prev) => { const set = new Set(prev); set.add(sample.id); return Array.from(set); });
                                    }}
                                  />
                                  <div
                                    style={{
                                      display: "none",
                                      width: 64,
                                      height: 64,
                                      borderRadius: 12,
                                      border: "1px solid #E5E7EB",
                                      background: "#F3F4F6",
                                      color: "#6B7280",
                                      fontSize: 10,
                                      fontWeight: 600,
                                      alignItems: "center",
                                      justifyContent: "center",
                                      textAlign: "center",
                                      padding: "0 6px",
                                      boxSizing: "border-box",
                                      cursor: "copy",
                                    }}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (navigator?.clipboard?.writeText) {
                                        navigator.clipboard.writeText(u).catch(() => {});
                                      }
                                    }}
                                    title="Fehler - klicken um Link zu kopieren"
                                  >
                                    Fehler - Link kopieren
                                  </div>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                      {imageSampleLimitStep5 <
                      imageSamples.filter((s) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(s.id).includes(t))).length ? (
                        <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-start" }}>
                          <button
                            onClick={() =>
                              setImageSampleLimitStep5((n) =>
                                Math.min(
                                  imageSamples.filter((s) => !eanSearchTerms.length || eanSearchTerms.some((t) => String(s.id).includes(t))).length,
                                  n + 5
                                )
                              )
                            }
                            style={{ padding: "6px 10px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#FFFFFF", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                          >
                            Mehr Produkte anzeigen
                          </button>
                        </div>
                      ) : null}
                      {brokenImageIds.length ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: "#92400E" }}>
                          Warnung: Bei {brokenImageIds.length} Produkten konnten Vorschaubilder nicht geladen werden.
                          Bitte prüfen, ob die Bild-Links für diese EANs funktionieren: {brokenImageIds.slice(0, 10).join(", ")}{brokenImageIds.length > 10 ? " …" : ""}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12 }}>
                      <SmallText>Es konnten keine Beispielprodukte mit Bildlinks ermittelt werden. Besonders kritisch sind EANs ohne Bilder oder nur einem Bild.</SmallText>
                    </div>
                  )}
                </>
              )}
            </StepCard>

              </>
            ) : null}

            {/* TOGGLE VISIBLE CHECKS */}
            {headers.length ? (
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
            style={{ width: "100%", maxWidth: 1400, maxHeight: "90vh", background: "#FFFFFF", borderRadius: 16, padding: 16, boxShadow: "0 25px 50px -12px rgba(15,23,42,0.45)", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Vorschau Vollbild</div>
              <button type="button" onClick={() => setPreviewFullscreen(false)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#F9FAFB", fontSize: 11, cursor: "pointer", color: "#111827" }}>Schliessen</button>
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
                  })
                .slice(0, Math.max(previewCount, 200))}
              highlightedCells={highlightedCells}
              getRowTargetKey={(r) => r.__rowIndex}
              targetRowKey={pendingJumpRowKey}
              highlightedRowKey={highlightedJumpRowKey}
              onTargetHandled={() => setPendingJumpRowKey(null)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (route === "rules") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <RulesPage rules={rules} setRules={setRules} onSave={saveRules} saving={rulesSaving} saveError={rulesSaveError} savedAt={rulesSavedAt} adminToken={adminToken} updateAdminToken={updateAdminToken} />
        {stickyFeedbackCta}
      </div>
    );
  }

  if (route === "feedback") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <div style={{ width: "100%", maxWidth: 1000, margin: "0 auto", padding: 24, boxSizing: "border-box" }}>
          <StepCard
            title="Feedback Tool"
            status="ok"
            subtitle="Ticket senden, wenn ein Feed falsch bewertet wurde"
          >
            <div style={{ display: "grid", gap: 10 }}>
              <SmallText>
                Du kannst Feedback direkt über den Sticky-Button senden. Hier siehst du eingegangene Tickets aus Supabase.
              </SmallText>
              {!isSupabaseConfigured ? (
                <div style={{ padding: 10, borderRadius: 12, border: "1px solid #FCD34D", background: "#FFFBEB", color: "#92400E", fontSize: 13 }}>
                  Supabase ist nicht konfiguriert.
                </div>
              ) : feedbackTicketsLoading ? (
                <div style={{ fontSize: 13, color: "#6B7280" }}>Tickets werden geladen...</div>
              ) : feedbackTickets.length === 0 ? (
                <div style={{ fontSize: 13, color: "#6B7280" }}>Noch keine Tickets vorhanden.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {feedbackTickets
                    .filter((ticket) => String(ticket.status || "Open").toLowerCase() !== "resolved")
                    .map((ticket) => (
                    <div
                      key={ticket.id}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #E5E7EB",
                        background: "#FFFFFF",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{ticket.message || "-"}</div>
                        <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #CBD5E1", background: "#F8FAFC", color: "#334155" }}>
                          {ticket.status || "Open"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : "-"}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        Datei: {ticket.file_name || "-"} | User: {ticket.reporter_email || "-"}
                      </div>
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        seller_key: {ticket.seller_key || "-"} | Kategorie: {ticket.category || "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: 10, borderRadius: 12, border: "1px dashed #D1D5DB", background: "#F9FAFB" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Hinweis</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#4B5563" }}>
                  Falls Supabase temporär nicht erreichbar ist, wird Feedback lokal im Browser gespeichert und später nicht automatisch synchronisiert.
                </div>
              </div>
            </div>
          </StepCard>
        </div>
        {stickyFeedbackCta}
      </div>
    );
  }

  if (route === "login") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <div style={{ width: "100%", maxWidth: 1000, margin: "0 auto", padding: 24, boxSizing: "border-box" }}>
          <StepCard
            title="Login"
            status={authUser ? "ok" : "idle"}
            subtitle=""
          >
            {!isSupabaseConfigured ? (
              <div style={{ padding: 10, borderRadius: 12, border: "1px solid #FCD34D", background: "#FFFBEB", color: "#92400E", fontSize: 13 }}>
                Supabase ist noch nicht vollständig konfiguriert. Bitte <code>NEXT_PUBLIC_SUPABASE_URL</code> und{" "}
                <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> in <code>.env.local</code> setzen und den Dev-Server neu starten.
              </div>
            ) : null}

            {authUser ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ padding: 10, borderRadius: 12, border: "1px solid #A7F3D0", background: "#ECFDF3", color: "#166534", fontSize: 13 }}>
                  Eingeloggt als <strong>{authUser.email || "Unbekannter Benutzer"}</strong>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={logout}
                    disabled={authLoading}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid #CBD5E1",
                      background: "#FFFFFF",
                      color: "#111827",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: authLoading ? "not-allowed" : "pointer",
                    }}
                  >
                    {authLoading ? "Bitte warten..." : "Logout"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { id: "login", label: "Login" },
                    { id: "signup", label: "Sign up" },
                    { id: "reset", label: "Passwort vergessen" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setAuthMode(m.id);
                        setAuthError("");
                        setAuthMessage("");
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: `1px solid ${BRAND_COLOR}`,
                        background: authMode === m.id ? BRAND_COLOR : "#FFFFFF",
                        color: authMode === m.id ? "#FFFFFF" : BRAND_COLOR,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>E-Mail</span>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="name@firma.de"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #D1D5DB",
                      background: "#FFFFFF",
                      fontSize: 13,
                      color: "#111827",
                      maxWidth: 420,
                    }}
                  />
                </label>

                {authMode !== "reset" ? (
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>Passwort</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="Mindestens 8 Zeichen"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #D1D5DB",
                        background: "#FFFFFF",
                        fontSize: 13,
                        color: "#111827",
                        maxWidth: 420,
                      }}
                    />
                  </label>
                ) : null}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={authLoading || !authEmail.trim() || (authMode !== "reset" && !authPassword)}
                    onClick={() => runAuthAction(authMode)}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: `1px solid ${BRAND_COLOR}`,
                      background: BRAND_COLOR,
                      color: "#FFFFFF",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: authLoading ? "not-allowed" : "pointer",
                    }}
                  >
                    {authLoading
                      ? "Bitte warten..."
                      : authMode === "signup"
                      ? "Konto erstellen"
                      : authMode === "reset"
                      ? "Reset E-Mail senden"
                      : "Einloggen"}
                  </button>
                </div>
              </div>
            )}

            {authError ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B91C1C", fontSize: 13 }}>
                {authError}
              </div>
            ) : null}
            {authMessage ? (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #A7F3D0", background: "#ECFDF3", color: "#166534", fontSize: 13 }}>
                {authMessage}
              </div>
            ) : null}
          </StepCard>
        </div>
      </div>
    );
  }

  if (route === "qs") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <div
          style={{
            height: "100vh",
            overflow: "hidden",
            fontFamily: "ui-sans-serif, system-ui",
            boxSizing: "border-box",
            background: "#F3F4F6",
            display: "flex",
            flexDirection: "column",
          }}
        >
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
                padding: 24,
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  marginTop: 18,
                  display: headers.length ? "flex" : "block",
                  gap: headers.length ? 16 : 14,
                  alignItems: "flex-start",
                  height: headers.length ? "calc(100vh - 24px - 48px)" : "auto",
                }}
              >
                {/* LEFT: QS/APA dashboard + upload */}
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
                    <StepCard
                      title="Datei hochladen"
                      status={headers.length ? "ok" : "idle"}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: 10,
                          marginTop: 2,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            border: `1px solid ${BRAND_COLOR}`,
                            background: "#FFFFFF",
                            fontSize: 12,
                            fontWeight: 700,
                            color: BRAND_COLOR,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          Datei auswählen
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              "http://media-partner.moebel.check24.de/feedvorlagen/Feedleitfaden_Anhang_2026/CHECK24_Feedvorlage_V2025.xlsx",
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                          style={{
                            padding: "8px 12px",
                            borderRadius: 999,
                            border: "1px solid #CBD5E1",
                            background: "#F9FAFB",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#111827",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          Feedvorlage (Excel) herunterladen
                        </button>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#6B7280",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {fileName
                            ? `Aktuelle Datei: ${fileName}`
                            : "Unterstuetzt CSV Dateien mit Kopfzeile"}
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                          style={{ display: "none" }}
                        />
                      </div>
                      {parseError ? (
                        <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 13 }}>
                          Fehler beim Einlesen {parseError}
                        </div>
                      ) : null}
                    </StepCard>

                    {headers.length ? <QsPage headers={headers} rows={rows} /> : null}

                    {!headers.length ? (
                      <StepCard
                        title="History"
                        status="idle"
                        subtitle="Zuletzt geprüfte Dateien"
                      >
                        {historyCardBody}
                      </StepCard>
                    ) : null}
                  </div>
                </div>

                {/* RIGHT: shared file preview */}
                {headers.length ? (
                  <FeedPreviewPanel headers={headers}>{step7Inner}</FeedPreviewPanel>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {stickyFeedbackCta}
      </div>
    );
  }

  if (route === "shop-performance") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <ShopPerformance />
        {stickyFeedbackCta}
      </div>
    );
  }

  if (route === "onboarding") {
    return (
      <div style={{ background: "#F3F4F6", minHeight: "100vh", overflowX: "hidden" }}>
        {topNav}
        <Onboarding />
        {stickyFeedbackCta}
      </div>
    );
  }

  return (
    <div style={{ background: "#F3F4F6", height: "100vh", overflow: "hidden", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      {topNav}
      <div style={{ flex: 1, minHeight: 0 }}>
        {page}
      </div>
      {stickyFeedbackCta}
    </div>
  );
}
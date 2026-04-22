"use client";

import React, { useState, useEffect } from "react";

const STORAGE_KEY = "feed_results_v1";
const BRAND_COLOR = "#1553B6";

const QS_COLS = [
  { key: "coreId",         label: "Core ID" },
  { key: "sellerKey",      label: "Seller Key" },
  { key: "herstellerfeed", label: "Hersteller-Feed" },
  { key: "titel",          label: "Titel" },
  { key: "beschreibung",   label: "Beschreibung" },
  { key: "abmessungen",    label: "Abmessungen" },
  { key: "lieferumfang",   label: "Lieferumfang" },
  { key: "material",       label: "Material" },
  { key: "farbe",          label: "Farbe" },
  { key: "shoptexte",      label: "shopbezogene Texte" },
  { key: "bildmatch",      label: "1. Bild & keine Dopplung" },
  { key: "freisteller",    label: "Freisteller" },
  { key: "millieu",        label: "Milieu" },
  { key: "anzahlbilder",   label: "Anzahl Bilder" },
  { key: "attributeScore", label: "Attribute Quality Score" },
  { key: "imageScore",     label: "Image Quality Score" },
  { key: "datum",          label: "Datum" },
  { key: "name",           label: "Name" },
  { key: "kommentar",      label: "Kommentar" },
];

const APA_COLS = [
  { key: "coreId",           label: "Core ID" },
  { key: "sellerKey",        label: "Seller Key" },
  { key: "coreStatus",       label: "Core Status" },
  { key: "apaFreigabe",      label: "APA-Freigabe" },
  { key: "attributeScore",   label: "Attribute Score" },
  { key: "imageScore",       label: "Quality Score" },
  { key: "gtin",             label: "Jedes Angebot hat eine GTIN/EAN" },
  { key: "titel_apa",        label: "Aussagekräftige Titel" },
  { key: "beschreibung_apa", label: "Beschreibung mind. 1 Satz" },
  { key: "shoptext_apa",     label: "keine shopbezogenen Texte" },
  { key: "crossSelling",     label: "kein Cross-Selling in Beschreibung" },
  { key: "beschreibungHtml", label: "Beschreibung in HTML" },
  { key: "masse",            label: "Maße in Titel oder Beschreibung / als Attribut" },
  { key: "material_apa",     label: "Material in Beschreibung / als Attribut" },
  { key: "farbe_apa",        label: "Farbe in Beschreibung / als Attribut" },
  { key: "lieferumfang_apa", label: "Lieferumfang in Beschreibung / als Attribut" },
  { key: "bildMatch",        label: "1. Bild und Offer passen zusammen" },
  { key: "mangelBilder",     label: "Kein Mangel an Produktbildern" },
  { key: "duplikate",        label: "Doppelte Offer Prüfung" },
  { key: "stammArtikel",     label: "keine Stamm-/Parentartikel" },
  { key: "encoding",         label: "Encoding falsch/Feed zerschossen" },
  { key: "bware",            label: "B-Ware" },
  { key: "todo",             label: "TO DO" },
  { key: "mailPartner",      label: "Mail an Partner" },
  { key: "datum",            label: "Datum" },
  { key: "name",             label: "Name" },
  { key: "kommentar",        label: "Kommentar" },
];

export function loadResults() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch { return []; }
}

export function saveResultToStorage(result) {
  const results = loadResults();
  results.push(result);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  window.dispatchEvent(new CustomEvent("feedResultSaved"));
}

function buildTSV(results, cols) {
  const header = cols.map((c) => c.label).join("\t");
  const rows = results.map((r) =>
    cols.map((c) => {
      const v = r[c.key];
      return v === null || v === undefined ? "" : String(v);
    }).join("\t")
  );
  return [header, ...rows].join("\n");
}

function CellValue({ value }) {
  const val = value === null || value === undefined ? "" : String(value);
  const isOk = val === "ok";
  const isProblem = val === "Problem";
  return (
    <td style={{
      padding: "7px 10px",
      borderBottom: "1px solid #E5E7EB",
      borderRight: "1px solid #F3F4F6",
      color: isOk ? "#166534" : isProblem ? "#991B1B" : "#111827",
      background: isOk ? "#F0FDF4" : isProblem ? "#FEF2F2" : "transparent",
      fontWeight: (isOk || isProblem) ? 600 : 400,
      whiteSpace: "nowrap",
      maxWidth: 200,
      overflow: "hidden",
      textOverflow: "ellipsis",
      fontSize: 12,
    }}>
      {val}
    </td>
  );
}

export default function ResultsTable() {
  const [results, setResults] = useState(() => loadResults());
  const [activeTab, setActiveTab] = useState("qs");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onSave = () => setResults(loadResults());
    window.addEventListener("feedResultSaved", onSave);
    return () => window.removeEventListener("feedResultSaved", onSave);
  }, []);

  function deleteResult(id) {
    const updated = results.filter((r) => r.id !== id);
    setResults(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  function clearAll() {
    if (!window.confirm("Alle Ergebnisse löschen?")) return;
    setResults([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  }

  function copyAsTable() {
    const cols = activeTab === "qs" ? QS_COLS : APA_COLS;
    const tsv = buildTSV(results, cols);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(tsv).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }

  const cols = activeTab === "qs" ? QS_COLS : APA_COLS;

  return (
    <div style={{ width: "100%", maxWidth: 1600, margin: "0 auto", padding: "20px 16px", boxSizing: "border-box", fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>Ergebnistabelle</div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
            {results.length} {results.length === 1 ? "Eintrag" : "Einträge"} gespeichert
            {results.length > 0 && (
              <span style={{ marginLeft: 8, color: "#9CA3AF" }}>
                · Zum Einfügen in Excel: Kopieren → Excel öffnen → Einfügen (Strg+V)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={copyAsTable}
            disabled={results.length === 0}
            style={{
              padding: "9px 18px", borderRadius: 6, border: "none",
              background: results.length === 0 ? "#D1D5DB" : BRAND_COLOR,
              color: "#FFF", fontSize: 13, fontWeight: 700,
              cursor: results.length === 0 ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied ? "✓ Kopiert!" : `📋 ${activeTab === "qs" ? "QS" : "APA"}-Tabelle kopieren (Excel)`}
          </button>
          {results.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                padding: "9px 14px", borderRadius: 6,
                border: "1px solid #FCA5A5", background: "#FEF2F2",
                color: "#B91C1C", fontSize: 13, fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              Alle löschen
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #D1D5DB", width: "fit-content", marginBottom: 16 }}>
        <button
          onClick={() => { setActiveTab("qs"); setCopied(false); }}
          style={{
            padding: "8px 28px", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: activeTab === "qs" ? BRAND_COLOR : "#FFF",
            color: activeTab === "qs" ? "#FFF" : "#374151",
          }}
        >QS</button>
        <button
          onClick={() => { setActiveTab("apa"); setCopied(false); }}
          style={{
            padding: "8px 28px", border: "none", borderLeft: "1px solid #D1D5DB", fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: activeTab === "apa" ? BRAND_COLOR : "#FFF",
            color: activeTab === "apa" ? "#FFF" : "#374151",
          }}
        >APA</button>
      </div>

      {results.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", borderRadius: 12, border: "2px dashed #D1D5DB", background: "#F9FAFB" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Noch keine Ergebnisse gespeichert</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", lineHeight: "1.6" }}>
            Laden Sie einen Feed hoch, öffnen Sie "Content Scoring"<br />
            und klicken Sie auf "Zu Tabelle hinzufügen".
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", background: "#FFF" }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} style={{
                    padding: "9px 10px",
                    background: "#F3F4F6",
                    borderBottom: "2px solid #D1D5DB",
                    borderRight: "1px solid #E5E7EB",
                    textAlign: "left",
                    fontWeight: 700,
                    color: "#374151",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                  }}>
                    {c.label}
                  </th>
                ))}
                <th style={{
                  padding: "9px 10px",
                  background: "#F3F4F6",
                  borderBottom: "2px solid #D1D5DB",
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  width: 70,
                }} />
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? "#FFF" : "#F9FAFB" }}>
                  {cols.map((c) => <CellValue key={c.key} value={r[c.key]} />)}
                  <td style={{ padding: "7px 10px", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => deleteResult(r.id)}
                      style={{
                        padding: "3px 8px", borderRadius: 4,
                        border: "1px solid #FCA5A5", background: "#FEF2F2",
                        color: "#B91C1C", fontSize: 11, fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

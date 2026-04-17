"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import Tooltip from "./Tooltip";

const MC_BLUE = "#1553B6";
const BRAND_COLOR = "#1553B6";

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

const MC_PFLICHT_COLS = [
  "name", "description", "brand", "category_path", "seller_offer_id", "ean",
  "price", "availability", "stock_amount", "delivery_time", "delivery_includes", "shipping_mode",
  "image_url",
  "color", "material", "size", "size_height", "size_depth", "size_diameter",
  "manufacturer_name", "manufacturer_street", "manufacturer_postcode",
  "manufacturer_city", "manufacturer_country", "manufacturer_email",
];

const MC_OPTIONAL_COLS = [
  "deeplink", "model",
  "size_lying_surface", "size_seat_height", "ausrichtung", "style", "temper", "weight", "weight_capacity",
  "youtube_link", "bild_3d_glb", "bild_3d_usdz", "assembly_instructions",
  "illuminant_included", "incl_mattress", "incl_slatted_frame", "led_verbaut", "lighting_included", "set_includes", "socket",
  "care_instructions", "filling", "removable_cover", "suitable_for_allergic",
  "energy_efficiency_category", "product_data_sheet",
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

export default function FeedCheckerTool() {
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

  const mcAutoMapping = useMemo(() => {
    if (!headers.length) return {};
    const m = {};
    for (const key of MC_PFLICHT_COLS) {
      if (key === "image_url") continue;
      m[key] = bestHeaderMatch(headers, MC_PFLICHT_ALIASES[key] || [key]) || null;
    }
    for (const key of MC_OPTIONAL_COLS) {
      m[key] = bestHeaderMatch(headers, MC_OPTIONAL_ALIASES[key] || [key]) || null;
    }
    return m;
  }, [headers]);

  const mcContentMapping = useMemo(() => {
    if (!headers.length || !rows.length) return {};
    const allFields = [...MC_PFLICHT_COLS.filter((f) => f !== "image_url"), ...MC_OPTIONAL_COLS];
    const unmapped = allFields.filter((f) => !mcAutoMapping[f]);
    if (!unmapped.length) return {};
    return detectFieldByContent(unmapped, headers, rows);
  }, [headers, rows, mcAutoMapping]);

  const mcMapping = useMemo(
    () => ({ ...mcAutoMapping, ...mcContentMapping, ...manualMapping }),
    [mcAutoMapping, mcContentMapping, manualMapping]
  );

  const mcImageColumns = useMemo(
    () => headers.filter((h) => { const n = h.toLowerCase(); return n.includes("image") || n.includes("bild") || n.includes("img"); }),
    [headers]
  );

  const issues = useMemo(() => {
    if (!rows.length || !headers.length) return null;

    const missingPflichtCols = MC_PFLICHT_COLS.filter((c) => {
      if (c === "image_url") return mcImageColumns.length === 0;
      return !mcMapping[c];
    });
    const missingOptionalCols = MC_OPTIONAL_COLS.filter((c) => !mcMapping[c]);

    const pflichtErrors = [];
    const optionalHints = [];
    const duplicateEans = {}, duplicateNameEans = {};
    let pflichtOkCount = 0, totalOptionalFieldsPresent = 0;
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
        if (key === "price") { const n = parseFloat(val.replace(",", ".")); if (isNaN(n) || n <= 0) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; } }
        if (key === "stock_amount" && !/^\d+$/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; }
        if (key === "shipping_mode" && val.toLowerCase() !== "paket" && val.toLowerCase() !== "spedition") { pflichtErrors.push({ row: rn, ean, field: key, type: "invalid", value: val }); pflichtOk = false; }
      }
      if (mcImageColumns.length > 0) {
        const imgCount = mcImageColumns.reduce((c, col) => c + (String(row[col] ?? "").trim() ? 1 : 0), 0);
        if (imgCount === 0) { pflichtErrors.push({ row: rn, ean, field: "image_url", type: "missing" }); pflichtOk = false; }
      }

      for (const key of MC_OPTIONAL_COLS) {
        const col = mcMapping[key];
        if (!col) continue;
        if (!String(row[col] ?? "").trim()) { optionalHints.push({ row: rn, ean, field: key }); }
        else { optionalFieldsPresent++; }
      }
      const extraImageCols = mcImageColumns.slice(1, 10);
      optionalFieldsPresent += extraImageCols.filter((col) => String(row[col] ?? "").trim()).length;

      if (ean) { if (!duplicateEans[ean]) duplicateEans[ean] = []; duplicateEans[ean].push(rn); }
      if (name && ean) { const k = `${name}|||${ean}`; if (!duplicateNameEans[k]) duplicateNameEans[k] = []; duplicateNameEans[k].push(rn); }

      if (pflichtOk) { pflichtOkCount++; } else { pflichtErrorRowNums.add(rn); }
      totalOptionalFieldsPresent += optionalFieldsPresent;
    });

    const dupEanCount = Object.values(duplicateEans).filter((r) => r.length > 1).reduce((s, r) => s + r.length, 0);
    const eanDupRows = new Set(Object.values(duplicateEans).filter((r) => r.length > 1).flat());
    const livefaehigCount = rows.filter((_, i) => !pflichtErrorRowNums.has(i + 1) && !eanDupRows.has(i + 1)).length;
    const dupNameEanCount = Object.values(duplicateNameEans).filter((r) => r.length > 1).reduce((s, r) => s + r.length, 0);

    const pflichtScore = rows.length ? Math.round((pflichtOkCount / rows.length) * 70) : 0;
    const optionalFillRatio = rows.length && optionalFieldCount > 0 ? (totalOptionalFieldsPresent / (rows.length * optionalFieldCount)) : 0;
    const optionalScore = Math.round(optionalFillRatio * 30);
    const totalScore = Math.max(0, Math.min(100, pflichtScore + optionalScore));

    return {
      totalRows: rows.length,
      missingPflichtCols, missingOptionalCols,
      pflichtErrors, optionalHints,
      pflichtOkCount, livefaehigCount, blockiertCount: rows.length - livefaehigCount,
      totalOptionalFieldsPresent, optionalFieldCount,
      dupEanCount, dupNameEanCount,
      pflichtScore, optionalScore, optionalFillRatio, totalScore,
    };
  }, [rows, headers, mcMapping, mcImageColumns]);

  const mcIsWrongFile = rows.length > 0 && Object.values(mcMapping).filter(Boolean).length === 0 && mcImageColumns.length === 0;

  if (issues) {
    const errorRate = issues.totalRows > 0 ? (issues.blockiertCount / issues.totalRows) * 100 : 0;
    const stufe1Passed = errorRate <= 5;
    const score = issues.totalScore;
    const campaignEligible = stufe1Passed && score >= 70;
    const fillPct = Math.round(issues.optionalFillRatio * 100);

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

    var rowsByGroup = { desc: new Set(), size: new Set(), mfr: new Set(), img: new Set(), price: new Set(), ids: new Set() };
    issues.pflichtErrors.forEach((e) => {
      if (e.field === "description") rowsByGroup.desc.add(e.row);
      else if (["size", "size_height", "size_depth", "size_diameter"].includes(e.field)) rowsByGroup.size.add(e.row);
      else if (e.field.startsWith("manufacturer_")) rowsByGroup.mfr.add(e.row);
      else if (e.field === "image_url") rowsByGroup.img.add(e.row);
      else if (["price", "availability", "stock_amount", "delivery_time", "delivery_includes", "shipping_mode"].includes(e.field)) rowsByGroup.price.add(e.row);
      else if (["name", "brand", "category_path", "seller_offer_id", "ean"].includes(e.field)) rowsByGroup.ids.add(e.row);
    });
    var topGroups = [
      { key: "desc", label: "Beschreibung", hint: "Fehlt oder leer", count: rowsByGroup.desc.size },
      { key: "size", label: "Maße / Höhe / Tiefe", hint: "Unvollständig", count: rowsByGroup.size.size },
      { key: "mfr", label: "Herstellerangaben", hint: "Name, Adresse oder E-Mail fehlt", count: rowsByGroup.mfr.size },
      { key: "img", label: "Hauptbild", hint: "Fehlt oder nicht erreichbar", count: rowsByGroup.img.size },
      { key: "price", label: "Preis & Verfügbarkeit", hint: "Unvollständig", count: rowsByGroup.price.size },
      { key: "ids", label: "Identifikation", hint: "Name, Marke oder EAN fehlen", count: rowsByGroup.ids.size },
    ].filter((g) => g.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  }

  return (
    <div style={{ maxWidth: 1500, margin: "0 auto", padding: "20px" }}>
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

        {/* CSV DOWNLOAD */}
        {issues && !mcIsWrongFile && (
          <div style={{ padding: "14px 16px", borderRadius: 10, border: `2px solid ${MC_BLUE}`, background: "#EEF4FF", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px rgba(21, 83, 182, 0.12)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Fehlerbericht herunterladen</div>
            </div>
            <button
              type="button"
              onClick={() => {
                const pflichtByRow = {}, optionalByRow = {};
                issues.pflichtErrors.forEach((e) => { if (!pflichtByRow[e.row]) pflichtByRow[e.row] = []; pflichtByRow[e.row].push(e.field + (e.type === "invalid" ? ` ungültig` : " fehlt")); });
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
        )}
      </div>

      {/* ── RIGHT: Analysis Results ── */}
      {issues && !mcIsWrongFile && (
        <div style={{ flex: "0 1 50%", minWidth: 0, display: "grid", gap: 12, alignContent: "start" }}>
          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
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

            <div style={{ padding: "14px 18px 8px", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MC_BLUE, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap" }}>STUFE 1 — TECHNISCHE PRÜFUNG</span>
                <span style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
              </div>
              {stufe1Passed
                ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#DCFCE7", color: "#16A34A", whiteSpace: "nowrap" }}>✓ Bestanden</span>
                : <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#FEE2E2", color: "#DC2626", whiteSpace: "nowrap" }}>✗ Nicht bestanden</span>}
            </div>

            <div style={{ padding: "0 18px 14px" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111827" }}>Datenvalidierung</div>
            </div>

            <div style={{ margin: "0 18px 14px", borderRadius: 8, borderLeft: `4px solid ${stufe1Passed ? "#16A34A" : "#DC2626"}`, background: stufe1Passed ? "#F0FDF4" : "#FEF2F2", padding: "10px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Pflichtattribute (25 Attribute)</div>

              {!stufe1Passed && topGroups && topGroups.length > 0 && (
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "0 18px 10px" }}>
              {[
                { val: issues.pflichtOkCount, label: "Vollständig", color: "#16A34A", tip: "Artikel mit vollständigen Pflichtattributen." },
                { val: issues.blockiertCount, label: "Unvollständig", color: "#DC2626", tip: "Artikel mit fehlenden Pflichtattributen." },
                { val: issues.totalRows, label: "Gesamt", color: "#111827", tip: "Gesamtzahl der Artikel." },
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

          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", position: "relative" }}>
            <div style={{ opacity: stufe1Passed ? 1 : 0.55 }}>
              <div style={{ padding: "14px 18px 8px", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: MC_BLUE, letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ whiteSpace: "nowrap" }}>STUFE 2 — FEED-QUALITÄTSSCORE</span>
                  <span style={{ flex: 1, height: 1, background: "#E5E7EB" }} />
                </div>
                {score >= 70
                  ? <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#DCFCE7", color: "#16A34A", whiteSpace: "nowrap" }}>✓ Zielwert erreicht</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: "#FEE2E2", color: "#DC2626", whiteSpace: "nowrap" }}>✗ Zielwert nicht erreicht</span>}
              </div>

              <div style={{ padding: "0 18px 10px", display: "flex", justifyContent: "flex-start", alignItems: "flex-end" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: campaignEligible ? "#16A34A" : "#DC2626", lineHeight: 1 }}>
                  {score}<span style={{ fontWeight: 600, color: "#9CA3AF" }}>/100</span>
                </div>
              </div>

              <div style={{ padding: "0 18px 4px" }}>
                <div style={{ position: "relative", paddingTop: 34 }}>
                  <div style={{ position: "absolute", top: 0, left: "70%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: campaignEligible ? "#166534" : "#4B5563", whiteSpace: "nowrap", padding: "1px 5px", borderRadius: 3, background: campaignEligible ? "#DCFCE7" : "#F3F4F6", border: `1px solid ${campaignEligible ? "#86EFAC" : "#E5E7EB"}` }}>Zielwert erreicht</div>
                    <div style={{ width: 1, height: 14, background: campaignEligible ? "#16A34A" : "#9CA3AF" }} />
                  </div>
                  <div style={{ height: 12, borderRadius: 6, background: "#E5E7EB", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${score}%`, background: campaignEligible ? "#16A34A" : score >= 50 ? "#D97706" : "#DC2626", transition: "width 0.4s" }} />
                  </div>
                  <div style={{ position: "absolute", top: 34, left: "70%", transform: "translateX(-50%)", width: 2, height: 12, background: campaignEligible ? "#16A34A" : "#6B7280", pointerEvents: "none" }} />
                  <div style={{ display: "flex", fontSize: 9, color: "#9CA3AF", marginTop: 3, position: "relative" }}>
                    <span>0</span>
                    <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)" }}>50</span>
                    <span style={{ position: "absolute", left: "70%", transform: "translateX(-50%)", color: campaignEligible ? "#16A34A" : "#4B5563", fontWeight: 700 }}>70</span>
                    <span style={{ marginLeft: "auto" }}>100</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

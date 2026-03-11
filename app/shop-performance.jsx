"use client";
import { useState, useEffect, useRef } from "react";

const B = {
  navy:"rgb(4,16,103)", navyHex:"040A5F", navyDk:"#020c5e", navyLt:"#e8eaf6",
  green:"#1e8c45", greenLt:"#e8f5e9", red:"#c62828", redLt:"#ffebee",
  amber:"#e65100", amberLt:"#fff3e0",
  grey0:"#f8f9fb", grey1:"#f1f3f8", grey2:"#e2e6f0", grey3:"#b0b8cc", grey4:"#6b7694", grey5:"#1a2240",
  white:"#ffffff", shadow:"0 2px 16px rgba(4,16,103,0.08)", shadowMd:"0 4px 24px rgba(4,16,103,0.13)",
};

// Clipboard helpers
function copyText(text) {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(()=>true).catch(()=>fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}
async function readClipboard() {
  if (navigator?.clipboard?.readText) {
    try { return await navigator.clipboard.readText(); } catch(e) {}
  }
  return null;
}

const QUERIES = [
  { key:"sales", icon:"📈", label:"Monatsumsatz", group:"performance",
    hint:"Umsatz, Bestellungen & Ø Warenkorbwert pro Monat", color:"#040A5F",
    sql:(k)=>`SELECT
    DATE_FORMAT(co.order_created_at, '%Y-%m-01') AS monat,
    COUNT(DISTINCT co.order_id) AS anzahl_bestellungen,
    SUM((co.total_price + co.shipping_costs) / 100) AS umsatz_eur,
    ROUND(
        SUM((co.total_price + co.shipping_costs) / 100)
        / NULLIF(COUNT(DISTINCT co.order_id), 0),
        2
    ) AS avg_order_value_eur
FROM bi.customer_order_position_anonymized co
WHERE co.status_order_shop IN ('sent', 'in_progress')
  AND co.seller_key = '${k}'
  AND co.order_created_at >= '2024-01-01'
  AND co.order_created_at <  '2026-01-01'
GROUP BY DATE_FORMAT(co.order_created_at, '%Y-%m-01')
ORDER BY monat;` },
  { key:"parity_daily", icon:"📅", label:"Preisparität (täglich)", group:"performance",
    hint:"Tagesgenaue Parität — letzte 90 Tage", color:"#0288d1",
    sql:(k)=>`SELECT
    day,
    number_offers,
    percentage_marketplace_expensive_meta,
    percentage_marketplace_expensive_amazon,
    percentage_marketplace_expensive_otto
FROM bi.price_parity_statistics_shop_daily pss
WHERE pss.seller_key = '${k}'
ORDER BY pss.day DESC
LIMIT 90;` },
  { key:"products", icon:"🏆", label:"Top Produkte", group:"performance",
    hint:"Top 15 Produkte nach Umsatz", color:"#7b1fa2",
    sql:(k)=>`SELECT
    p.csin, pa.value AS titel,
    COUNT(*) AS positionen,
    SUM(co.order_count) AS stueck,
    SUM((co.total_price + co.shipping_costs) / 100) AS umsatz
FROM bi.customer_order_position_anonymized co
JOIN main.product p ON p.product_increment_id = co.product_increment_id
LEFT JOIN main.product_attribute pa ON pa.csin = p.csin AND pa.attribute_type_id = 1
WHERE co.status_order_shop IN ('sent', 'in_progress')
  AND co.seller_key = '${k}'
  AND co.order_created_at >= '2024-01-01' AND co.order_created_at < '2026-01-01'
GROUP BY p.csin, pa.value ORDER BY umsatz DESC LIMIT 15;` },
  { key:"categories", icon:"📦", label:"Top Kategorien (Tags)", group:"performance",
    hint:"Top-Kategorien des Shops auf Basis von Produkt-Tags", color:"#2e7d32",
    sql:(k)=>`SELECT
    t.name AS kategorie,
    SUM((co.total_price + co.shipping_costs) / 100) AS umsatz,
    SUM(co.order_count) AS teilbestellungen
FROM bi.customer_order_position_anonymized co
JOIN main.product p
    ON p.product_increment_id = co.product_increment_id
JOIN main.product_tag pt
    ON pt.csin = p.csin
    AND pt.is_blocked = 0
JOIN main.tag t
    ON t.id = pt.tag_id
    AND t.tag_type_id = 2
JOIN sm.seller s
    ON s.seller_key = co.seller_key
WHERE co.status_order_shop IN ('sent', 'in_progress')
  AND co.order_created_at >= '2024-01-01'
  AND co.order_created_at < '2026-01-01'
  AND s.seller_key = '${k}'
GROUP BY t.name
ORDER BY umsatz DESC;` },
  { key:"daily_orders", icon:"🧾", label:"Bestelldetails", group:"performance",
    hint:"Chronologische Einzelbestellungen mit Preisen & Status", color:"#37474f",
    sql:(k)=>`SELECT co.order_created_at, p.csin, co.order_number, pa.value AS titel,
   
    ((co.total_price+co.shipping_costs)/100) AS gesamtpreis_eur,
    co.order_count, co.status_order_shop, co.canceled_reason_key
FROM bi.customer_order_position_anonymized co
JOIN main.product p ON p.product_increment_id=co.product_increment_id
LEFT JOIN qa.product_attribute pa ON pa.csin=p.csin AND pa.attribute_type_id=1
JOIN sm.seller s ON s.seller_key=co.seller_key
LEFT JOIN qa.product_gtin pg ON pg.csin=p.csin AND pg.is_main=1
WHERE DATE(co.order_created_at)>='2024-01-01'
  AND s.seller_key='${k}'
ORDER BY co.order_created_at DESC LIMIT 500;` },
  { key:"monthly_quality", icon:"📊", label:"Monatliche Storno/Retouren/Verzug", group:"performance",
    hint:"Stornoquote, Retourenquote & Verzugsquote je Monat", color:"#b45309",
    sql:(k)=>`SELECT 
    s.seller_key AS Shop,
    DATE_FORMAT(co.order_created_at, '%Y-%m') AS Jahr_Monat,
    SUM(co.order_count) AS Bestellpositionen,
    ROUND(SUM((co.total_price + co.shipping_costs) / 100), 2) AS Umsatz,
    ROUND(
        SUM(CASE WHEN co.status_order_shop = 'canceled_by_shop' THEN 1 ELSE 0 END) 
        / COUNT(*) * 100, 2
    ) AS Shopstornoquote,
    ROUND(
        SUM(CASE WHEN co.status_order_shop = 'returned' THEN 1 ELSE 0 END)
        / COUNT(*) * 100, 2
    ) AS Retourenquote,
    ROUND(
        SUM(CASE 
            WHEN co.promised_last_delivery_date < co.updated_at 
                 AND co.status_order_shop NOT IN ('canceled_by_shop', 'returned') 
            THEN 1 ELSE 0 END
        ) / COUNT(*) * 100, 2
    ) AS Shopverzugsquote
FROM bi.customer_order_position_anonymized co
JOIN sm.seller s 
    ON s.seller_key = co.seller_key
WHERE s.seller_key = '${k}'
  AND co.order_created_at >= '2024-01-01'
GROUP BY 
    s.seller_key,
    DATE_FORMAT(co.order_created_at, '%Y-%m')
ORDER BY 
    Jahr_Monat ASC;` },
];

const EXAMPLE_PASTES = {
  sales: `2024-11-01\t4\t1862.8500\t465.71
2024-12-01\t15\t2907.2500\t193.82
2025-01-01\t17\t6461.4800\t380.09
2025-03-01\t10\t4098.3400\t409.83
2025-04-01\t34\t15197.8800\t447.00
2025-05-01\t51\t25750.6200\t504.91
2025-06-01\t13\t6302.9300\t484.84
2025-07-01\t22\t11249.4000\t511.34
2025-08-01\t12\t6669.9800\t555.83
2025-09-01\t9\t3142.3600\t349.15
2025-10-01\t6\t2086.0900\t347.68
2025-11-01\t20\t11162.7500\t558.14
2025-12-01\t10\t4635.8800\t463.59`,
  parity_daily: `day\tseller_key\tnumber_offers\t...\n2026-03-05\tlomado\t1186\t30\t2.53\t0\t46.67\t53.33\t3.105\t470\t39.63\t3.4\t84.26\t12.34\t0.33\t0\t14\t16\t16\t396\t58\t852\t71.84\t1.53\t13\t94.6\t806\t3.87\t33\t3.24
2026-03-04\tlomado\t1186\t27\t2.28\t0\t48.15\t51.85\t2.73\t470\t39.63\t3.4\t84.26\t12.34\t0.33\t0\t13\t14\t16\t396\t58\t852\t71.84\t1.53\t13\t94.6\t806\t3.87\t33\t3.24`,
  products: `5023A2BFC5F87C\tBademöbel Komplett Set LUTON-56-CRAFT\t4\t4\t3593.7600
3DE58D1474D965\tBadmöbel Set 4-teilig NEWPORT-56-GREEN\t3\t3\t3521.6700
C289F5C13C54A0\tBadezimmermöbel Komplett Set CAMPOS-56\t4\t4\t3151.2400
E44B3657371233\tWaschplatz Set XANTEN-56\t4\t4\t2636.3600`,
  categories: `programm\t59406.4000\t72
schrank\t37121.5300\t146
bett\t2510.1500\t7
kommode\t1773.8900\t6
regal\t418.4100\t3
bank\t171.3500\t1
nachttisch\t64.4700\t1`,
  daily_orders: `order_created_at\tcsin\torder_number\ttitel\tgtin14\titem_price_eur\tgesamtpreis_eur\torder_count\tstatus_order_shop\tcanceled_reason_key\tseller_key
2026-02-20 20:51:29\tEA579111F76167\tFE3HVEM\tBadmöbel Set mit Keramikwaschtisch\t04066075011651\t713.8000\t713.8000\t1\tsent\tNULL\tlomado
2025-12-28 10:20:37\tCA3C38B6E5FAD4\tF9V85EZ\tHochschrank RIMAO-100\t04251581553003\t218.0800\t218.0800\t1\tcanceled\tout_of_stock\tlomado
2025-12-17 18:41:49\tA1CAC9B095F261\tFYW2C75\tLandhaus Badmöbel Komplett Set\t04251581518330\t961.0700\t961.0700\t1\treturned\tNULL\tlomado`,
  monthly_quality: `Shop\tJahr_Monat\tBestellpositionen\tUmsatz\tShopstornoquote\tRetourenquote\tShopverzugsquote
lomado\t2024-10\t1\t1081.19\t0.00\t0.00\t100.00
lomado\t2024-11\t6\t2984.28\t0.00\t16.67\t83.33
lomado\t2024-12\t22\t4908.09\t0.00\t18.18\t81.82
lomado\t2025-01\t21\t8960.71\t0.00\t0.00\t100.00
lomado\t2025-03\t10\t4098.34\t0.00\t0.00\t100.00
lomado\t2025-04\t36\t15647.36\t0.00\t0.00\t100.00
lomado\t2025-05\t61\t29013.59\t0.00\t6.56\t90.16
lomado\t2025-06\t14\t6592.30\t0.00\t7.14\t92.86
lomado\t2025-07\t23\t11424.11\t0.00\t0.00\t95.65
lomado\t2025-08\t14\t6669.98\t0.00\t0.00\t100.00
lomado\t2025-09\t10\t3142.36\t0.00\t0.00\t100.00
lomado\t2025-10\t12\t2646.10\t0.00\t16.67\t75.00
lomado\t2025-11\t23\t12379.25\t0.00\t0.00\t95.65
lomado\t2025-12\t14\t6141.22\t0.00\t14.29\t78.57
lomado\t2026-01\t4\t895.21\t0.00\t0.00\t25.00
lomado\t2026-02\t6\t1703.07\t0.00\t0.00\t16.67`
};

// ─── Shared parsing/formatting helpers ───────────────────────────────────────
function parsePasted(text) {
  if (!text?.trim()) return null;
  const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
  if (lines.length < 2) return null;
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const headers = first.split(delim).map(h=>h.trim().replace(/^"|"$/g,""));
  const rows = lines.slice(1).map(line => {
    const cols = line.split(delim);
    return Object.fromEntries(headers.map((h,i)=>[h,(cols[i]??"").trim().replace(/^"|"$/g,"")]));
  });
  return { headers, rows };
}

function num(v){const n=parseFloat(String(v).replace(",","."));return isNaN(n)?0:n;}
function fmtEur(v){return num(v).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";}
function fmtNum(v){return num(v).toLocaleString("de-DE");}
function fmtPct(v,d=1){return num(v).toFixed(d)+"%";}

// German month abbreviations
const DE_MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
function formatGermanMonth(isoDateStr) {
  // isoDateStr like "2024-11-01" or "2024-11"
  const parts = isoDateStr.split("-");
  if (parts.length < 2) return isoDateStr;
  const yr = parts[0];
  const mo = parseInt(parts[1], 10) - 1;
  return `${DE_MONTHS[mo] || ""} ${yr}`;
}

function getSalesRows(salesText) {
  if (!salesText?.trim()) return [];
  const lines = salesText.trim().split(/\r?\n/).filter(l=>l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const firstCols = first.split(delim).map(c=>c.trim());
  const isDateLike = /^\d{4}-\d{2}(-\d{2})?$/.test(firstCols[0] || "");
  const isNumLike = (v)=>v !== "" && !isNaN(num(v));
  if (firstCols.length >= 3 && isDateLike && isNumLike(firstCols[1]) && isNumLike(firstCols[2])) {
    return lines.map(line => {
      const cols = line.split(delim).map(c=>c.trim());
      const [monat, anzahl, umsatz, aov] = cols;
      return { monat: monat||"", anzahl_bestellungen: anzahl||"", umsatz_eur: umsatz||"", avg_order_value_eur: aov||"" };
    });
  }
  return parsePasted(salesText)?.rows || [];
}

function getProductRows(productsText) {
  if (!productsText?.trim()) return [];
  const lines = productsText.trim().split(/\r?\n/).filter(l=>l.trim());
  const rows = [];
  lines.forEach(line => {
    const raw = line.trim();
    if (!raw) return;
    const parts = raw.split(/\s+/);
    if (!parts.length) return;
    // Skip potential header row
    const first = parts[0].toLowerCase();
    if (first==="csin" || first==="p.csin") return;
    if (parts.length < 5) return;
    const csin = parts[0];
    const umsatz = parts[parts.length-1];
    const stueck = parts[parts.length-2];
    const positionen = parts[parts.length-3];
    const titelParts = parts.slice(1, parts.length-3);
    const titel = titelParts.join(" ");
    rows.push({
      csin: csin || "",
      titel: titel || "",
      positionen: positionen || "",
      stueck: stueck || "",
      umsatz: umsatz || "",
    });
  });
  return rows;
}

function getCategoryRows(categoriesText) {
  if (!categoriesText?.trim()) return [];
  // Einige Exporte kommen als einfache Liste: kategorie umsatz teilbestellungen kategorie umsatz teilbestellungen ...
  // Wir zerlegen daher den gesamten String in Tokens und gruppieren jeweils 3 Werte zu einer Zeile.
  const tokens = categoriesText
    .split(/[\s\r\n\t]+/)
    .map(t => t.trim())
    .filter(Boolean);

  const rows = [];
  for (let i = 0; i < tokens.length; i += 3) {
    const kategorie = tokens[i] ?? "";
    const umsatz = tokens[i+1] ?? "";
    const teilbestellungen = tokens[i+2] ?? "";
    if (!kategorie && !umsatz && !teilbestellungen) continue;
    rows.push({ kategorie, umsatz, teilbestellungen });
  }
  return rows;
}

function getParityRows(parityText) {
  if (!parityText?.trim()) return [];
  // Versuche zuerst, eine Kopfzeile mit "day" zu erkennen
  const parsed = parsePasted(parityText);
  if (parsed && parsed.headers && parsed.headers.length >= 2 && parsed.headers[0].toLowerCase().includes("day")) {
    return parsed.rows.map(r => ({
      day: r.day || r.Day || r.Datum || Object.values(r)[0] || "",
      number_offers: r.number_offers || r.Angebote || Object.values(r)[1] || "",
      pct_meta: r.percentage_marketplace_expensive_meta || r["Meta (%)"] || Object.values(r)[2] || "",
      pct_amazon: r.percentage_marketplace_expensive_amazon || r["Amazon (%)"] || Object.values(r)[3] || "",
      pct_otto: r.percentage_marketplace_expensive_otto || r["OTTO (%)"] || Object.values(r)[4] || "",
    }));
  }
  // Headerlose Variante: pro Zeile 5 Werte: day, offers, meta, amazon, otto
  const lines = parityText.trim().split(/\r?\n/).filter(l => l.trim());
  const rows = [];
  lines.forEach(line => {
    const parts = line.trim().split(/[\t\s]+/).filter(Boolean);
    if (parts.length < 5) return;
    const [day, offers, meta, amazon, otto] = parts;
    rows.push({
      day: day || "",
      number_offers: offers || "",
      pct_meta: meta || "",
      pct_amazon: amazon || "",
      pct_otto: otto || "",
    });
  });
  return rows;
}

function getQualityRows(monthlyQualityText) {
  if (!monthlyQualityText?.trim()) return [];
  const lines = monthlyQualityText.trim().split(/\r?\n/).filter(l=>l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const firstCols = first.split(delim).map(c=>c.trim());
  // Detect headerless paste: first col is shop key (non-date), second is date-like
  const isDateLike = (v) => /^\d{4}-\d{2}$/.test(v);
  // If first row looks like a header (Jahr_Monat not date-like in col 0)
  if (isDateLike(firstCols[1]) || (firstCols[0] && !firstCols[0].toLowerCase().includes("shop") && isDateLike(firstCols[0]))) {
    // headerless with cols: Shop, Jahr_Monat, Bestellpositionen, Umsatz, Shopstornoquote, Retourenquote, Shopverzugsquote
  }
  const parsed = parsePasted(monthlyQualityText);
  if (parsed) {
    // Map to canonical field names
    return parsed.rows.map(r => ({
      shop: r.Shop || r.shop || "",
      jahr_monat: r.Jahr_Monat || r.jahr_monat || r.monat || "",
      bestellpositionen: r.Bestellpositionen || r.bestellpositionen || "",
      umsatz: r.Umsatz || r.umsatz || "",
      shopstornoquote: r.Shopstornoquote || r.shopstornoquote || "",
      retourenquote: r.Retourenquote || r.retourenquote || "",
      shopverzugsquote: r.Shopverzugsquote || r.shopverzugsquote || "",
    }));
  }
  return [];
}

// ─── CSV / TSV export helpers ───────────────────────────────────────────────
function rowsToCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",;\t\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = headers.map(esc).join(";");
  const bodyLines = rows.map((r) => headers.map((h) => esc(r[h])).join(";"));
  return [headerLine, ...bodyLines].join("\n");
}

// For copy & paste directly into Excel: tab-separated values
function rowsToTsvForExcel(headers, rows) {
  const esc = (v) => {
    // Replace hard line breaks so we don't accidentally create new rows in Excel
    const s = String(v ?? "").replace(/\r?\n/g, " ");
    return s;
  };
  const headerLine = headers.map(esc).join("\t");
  const bodyLines = rows.map((r) => headers.map((h) => esc(r[h])).join("\t"));
  return [headerLine, ...bodyLines].join("\n");
}

function downloadCsv(filename, csvText) {
  if (!csvText) return;
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Template-based Excel generation ─────────────────────────────────────────

/**
 * Clone a cell's style object deeply so we can reuse it.
 * Works with SheetJS Pro/community cellStyles.
 */
function cloneStyle(cell) {
  if (!cell || !cell.s) return {};
  return JSON.parse(JSON.stringify(cell.s));
}

/**
 * Set a cell value + style in a worksheet.
 * addr like "B5", val = raw value, s = style object, t = type char, z = numFmt string
 */
function setCell(ws, addr, val, s, t, z) {
  const cell = { v: val, t: t || (typeof val === "number" ? "n" : "s"), s: s || {} };
  if (z) cell.z = z;
  ws[addr] = cell;
}

/**
 * Build the excel file using the reference template.
 * Strategy: fetch template → read with cellStyles:true → write dynamic values
 * into the correct cells, extending rows as needed by copying row styles.
 */
async function buildExcel(XLSX, shopName, sellerKey, pasted) {
  // ── 1. Load the template ──────────────────────────────────────────────────
  const templateUrl = "/templates/shop_performance_template.xlsx";
  let templateBuf;
  try {
    const resp = await fetch(templateUrl);
    if (!resp.ok) throw new Error("Template not found at " + templateUrl);
    templateBuf = await resp.arrayBuffer();
  } catch(e) {
    console.warn("Could not load template, falling back to scratch build:", e.message);
    templateBuf = null;
  }

  let wb;
  if (templateBuf) {
    wb = XLSX.read(new Uint8Array(templateBuf), { type: "array", cellStyles: true, cellNF: true });
  } else {
    // Fallback: build from scratch with basic styling
    wb = buildExcelFromScratch(XLSX, shopName, pasted);
    return wb;
  }

  // ── Helper: column letter from 0-based index (0=A, 1=B…) ─────────────────
  const col = (c) => String.fromCharCode(65 + c); // A=65

  // ── Helper: copy style from a reference cell ──────────────────────────────
  const copyS = (ws, refAddr) => {
    const rc = ws[refAddr];
    return rc ? cloneStyle(rc) : {};
  };

  // ── 2. Übersicht-Sheet: Basiswerte setzen (inkl. Seller-Key in C5/B4) ────
  const overviewSheetName = wb.Sheets["Übersicht"] ? "Übersicht" : wb.SheetNames[0];
  const wsOverview = wb.Sheets[overviewSheetName];
  const sellerVal = (sellerKey || "").trim() || "NONE";
  // C5: Freitext-Seller (falls im Template genutzt)
  const sC5 = copyS(wsOverview, "C5");
  setCell(wsOverview, "C5", sellerVal, sC5, "s");

  // ── Helper: write a cell, preserving existing style if desired ────────────
  const wc = (ws, addr, val, overrideStyle, type, numFmt) => {
    const existing = ws[addr];
    const s = overrideStyle !== undefined ? overrideStyle : (existing ? cloneStyle(existing) : {});
    const t = type || (typeof val === "number" ? "n" : val === null ? "z" : "s");
    const cell = { v: val, t, s };
    if (numFmt) cell.z = numFmt;
    ws[addr] = cell;
  };

  // ── Helper: write formula cell ───────────────────────────────────────────
  const wf = (ws, addr, formula, refStyleAddr, numFmt) => {
    const s = copyS(ws, refStyleAddr || addr);
    const cell = { f: formula, t: "n", s };
    if (numFmt) cell.z = numFmt;
    ws[addr] = cell;
  };

  // ── Compute all data ──────────────────────────────────────────────────────
  const sr = getSalesRows(pasted.sales);
  const totRev = sr.reduce((s,d)=>s+num(d.umsatz_eur),0);
  const totOrd = sr.reduce((s,d)=>s+num(d.anzahl_bestellungen),0);

  const byYear = sr.reduce((acc,d)=>{
    const yr = String(d.monat||"").substring(0,4);
    if (!yr.match(/^\d{4}$/)) return acc;
    if (!acc[yr]) acc[yr]={rev:0,orders:0};
    acc[yr].rev += num(d.umsatz_eur);
    acc[yr].orders += num(d.anzahl_bestellungen);
    return acc;
  },{});
  const s24 = byYear["2024"]||{rev:0,orders:0};
  const s25 = byYear["2025"]||{rev:0,orders:0};

  // Übersicht B4: Seller-Key Platzhalter ersetzen
  // If the template contains '[seller_key]' in B4, we simply overwrite it.
  wc(wsOverview, "B4", sellerVal);

  // Übersicht C15: [total_revenue_2025] – Summe Umsatz 2025 oder "NONE"
  if (byYear["2025"] && s25.rev > 0) {
    const styleC15 = copyS(wsOverview, "C15");
    wc(wsOverview, "C15", s25.rev, styleC15, "n", '#,##0.00');
  } else {
    wc(wsOverview, "C15", "NONE");
  }

  const qRows = getQualityRows(pasted.monthly_quality);
  const byYearQ = qRows.reduce((acc,d)=>{
    const yr = String(d.jahr_monat||"").substring(0,4);
    if (!yr.match(/^\d{4}$/)) return acc;
    if (!acc[yr]) acc[yr]={storno:[],ret:[],verz:[]};
    acc[yr].storno.push(num(d.shopstornoquote));
    acc[yr].ret.push(num(d.retourenquote));
    acc[yr].verz.push(num(d.shopverzugsquote));
    return acc;
  },{});
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const q24 = byYearQ["2024"]||{storno:[],ret:[],verz:[]};
  const q25 = byYearQ["2025"]||{storno:[],ret:[],verz:[]};
  const storno24 = avg(q24.storno), storno25 = avg(q25.storno);
  const ret24 = avg(q24.ret), ret25 = avg(q25.ret);
  const verz24 = avg(q24.verz), verz25 = avg(q25.verz);

  // ── Color styles for trend cells ──────────────────────────────────────────
  // Positive (improvement = lower rate) = green fill E2EFDA, green font 375623
  // Negative (worsening = higher rate) = red fill FCE4D6, red font C00000
  const positiveStyle = {
    font:{bold:true,sz:11,name:"Arial",color:{rgb:"FF375623"}},
    fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"},
    alignment:{horizontal:"center",vertical:"center"},
    border:{top:{style:"thin",color:{rgb:"FF000000"}},bottom:{style:"thin",color:{rgb:"FF000000"}},left:{style:"thin",color:{rgb:"FF000000"}},right:{style:"thin",color:{rgb:"FF000000"}}}
  };
  const negativeStyle = {
    font:{bold:true,sz:11,name:"Arial",color:{rgb:"FFC00000"}},
    fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"},
    alignment:{horizontal:"center",vertical:"center"},
    border:{top:{style:"thin",color:{rgb:"FF000000"}},bottom:{style:"thin",color:{rgb:"FF000000"}},left:{style:"thin",color:{rgb:"FF000000"}},right:{style:"thin",color:{rgb:"FF000000"}}}
  };
  const neutralStyle = {
    font:{bold:false,sz:11,name:"Arial",color:{rgb:"FF000000"}},
    fill:{fgColor:{rgb:"FFF2F2F2"},patternType:"solid"},
    alignment:{horizontal:"center",vertical:"center"},
    border:{top:{style:"thin",color:{rgb:"FF000000"}},bottom:{style:"thin",color:{rgb:"FF000000"}},left:{style:"thin",color:{rgb:"FF000000"}},right:{style:"thin",color:{rgb:"FF000000"}}}
  };

  const trendStyle = (v24, v25, lowerIsBetter=true) => {
    if (v24===null || v25===null) return neutralStyle;
    const diff = v25 - v24;
    if (Math.abs(diff) < 0.05) return neutralStyle;
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    return improved ? positiveStyle : negativeStyle;
  };
  const trendLabel = (v24, v25, lowerIsBetter=true) => {
    if (v24===null || v25===null) return "—";
    const diff = v25 - v24;
    if (Math.abs(diff) < 0.05) return "≈ gleich";
    const improved = lowerIsBetter ? diff < 0 : diff > 0;
    const magnitude = Math.abs(diff) > 5 ? "Stark " : "";
    return improved ? `▼ ${magnitude}verbessert` : `▲ ${magnitude}gestiegen`;
  };

  // ── SHEET 1: 📊 Übersicht ────────────────────────────────────────────────
  {
    const ws = wb.Sheets["📊 Übersicht"];
    if (ws) {
      // Title B2: shop name
      wc(ws, "B2", `${name}  |  Partner-Analyse`);

      // Allgemeine Informationen block (B5:C11) — keep labels, update C5 (shop name)
      wc(ws, "C5", name);

      // Geschäftsentwicklung block rows 15-17
      // Row 15: 2024 data
      wc(ws, "B15", `2024: ${fmtNum(s24.orders)}`);
      wc(ws, "C15", `2024: ${fmtEur(s24.rev)}`);
      wc(ws, "D15", storno24!==null ? `2024: ${storno24.toFixed(1)}%` : "2024: —");
      wc(ws, "E15", ret24!==null ? `2024: ${ret24.toFixed(1)}%` : "2024: —");

      // Row 16: 2025 data
      wc(ws, "B16", `2025: ${fmtNum(s25.orders)}`);
      wc(ws, "C16", `2025: ${fmtEur(s25.rev)}`);
      wc(ws, "D16", storno25!==null ? `2025: ${storno25.toFixed(1)}%` : "2025: —");
      wc(ws, "E16", ret25!==null ? `2025: ${ret25.toFixed(1)}%` : "2025: —");

      // Row 17: trend/delta
      const ordGrowth = s24.orders>0 ? ((s25.orders-s24.orders)/s24.orders*100) : null;
      const revGrowth = s24.rev>0 ? ((s25.rev-s24.rev)/s24.rev*100) : null;
      wc(ws, "B17", ordGrowth!==null ? `${ordGrowth>=0?"+":""}${ordGrowth.toFixed(0)}%` : "—",
        ordGrowth===null ? neutralStyle : ordGrowth>=0 ? positiveStyle : negativeStyle);
      wc(ws, "C17", revGrowth!==null ? `${revGrowth>=0?"+":""}${revGrowth.toFixed(0)}%` : "—",
        revGrowth===null ? neutralStyle : revGrowth>=0 ? positiveStyle : negativeStyle);
      // Storno trend: lower = better
      const stornoDiff = (storno24!==null&&storno25!==null) ? storno25-storno24 : null;
      const retDiff = (ret24!==null&&ret25!==null) ? ret25-ret24 : null;
      wc(ws, "D17", stornoDiff===null?"—": stornoDiff<=0?"▼ Besser":"▲ Schlechter",
        trendStyle(storno24, storno25, true));
      wc(ws, "E17", retDiff===null?"—": retDiff<=0?"▼ Besser":"▲ Schlechter",
        trendStyle(ret24, ret25, true));

      // Qualitätskennzahlen block rows 22-27
      const pct = (v) => v!==null ? `${v.toFixed(1)}%` : "—";
      // Row 22: Stornoquote
      wc(ws, "C22", pct(storno24));
      wc(ws, "D22", pct(storno25));
      wc(ws, "E22", trendLabel(storno24,storno25,true), trendStyle(storno24,storno25,true));

      // Row 23: Shop-induz. Stornoquote (same data since we have Shopstornoquote)
      wc(ws, "C23", pct(storno24));
      wc(ws, "D23", pct(storno25));
      wc(ws, "E23", trendLabel(storno24,storno25,true), trendStyle(storno24,storno25,true));

      // Row 24: Retourenquote
      wc(ws, "C24", pct(ret24));
      wc(ws, "D24", pct(ret25));
      wc(ws, "E24", trendLabel(ret24,ret25,true), trendStyle(ret24,ret25,true));

      // Row 26: Verzugsquote gesamt
      wc(ws, "C26", pct(verz24));
      wc(ws, "D26", pct(verz25));
      wc(ws, "E26", trendLabel(verz24,verz25,true), trendStyle(verz24,verz25,true));

      // Row 27: Verzugsquote (Shop) — same data (Shopverzugsquote)
      wc(ws, "C27", pct(verz24));
      wc(ws, "D27", pct(verz25));
      wc(ws, "E27", trendLabel(verz24,verz25,true), trendStyle(verz24,verz25,true));
    }
  }

  // ── SHEET 2: 📈 Umsatz ───────────────────────────────────────────────────
  {
    const ws = wb.Sheets["📈 Umsatz"];
    if (ws) {
      // Title
      wc(ws, "B2", `${name}  |  Monatsumsatz & Bestellpositionen`);

      // Get template style references for 2024 (odd=F2F2F2) and 2025 (BDD7EE/D6E8F5) rows
      // Template has data from row 5. We'll write our data rows from row 5.
      // First clear existing data rows 5..25 (template has up to row 25 + totals at 26)
      const FIRST_DATA_ROW = 5;
      const TOTALS_ROW_TMPL = 26; // where GESAMT row lives in template

      // Gather reference styles from template rows 5 (2024 odd) and 6 (2024 even) and 14 (2025 odd) and 15 (2025 even)
      // Row 5 = F2F2F2 (2024 striped odd), row 6 = FFFFFF (2024 even), row 14 = D6E8F5 (2025 odd), row 15 = BDD7EE (2025 even)
      const refStyles = {
        y24odd: {
          B: copyS(ws,"B5"), C: copyS(ws,"C5"), D: copyS(ws,"D5"), E: copyS(ws,"E5"), F: copyS(ws,"F5")
        },
        y24even: {
          B: copyS(ws,"B6"), C: copyS(ws,"C6"), D: copyS(ws,"D6"), E: copyS(ws,"E6"), F: copyS(ws,"F6")
        },
        y25odd: {
          B: copyS(ws,"B14"), C: copyS(ws,"C14"), D: copyS(ws,"D14"), E: copyS(ws,"E14"), F: copyS(ws,"F14")
        },
        y25even: {
          B: copyS(ws,"B15"), C: copyS(ws,"C15"), D: copyS(ws,"D15"), E: copyS(ws,"E15"), F: copyS(ws,"F15")
        },
        total: {
          B: copyS(ws,"B26"), C: copyS(ws,"C26"), D: copyS(ws,"D26"), E: copyS(ws,"E26"), F: copyS(ws,"F26")
        }
      };

      // Clear rows 5–26 (template data area)
      for (let r = FIRST_DATA_ROW; r <= TOTALS_ROW_TMPL + 5; r++) {
        ["B","C","D","E","F"].forEach(c => { delete ws[c+r]; });
      }
      // Remove old merges that intersect data area
      if (ws["!merges"]) {
        ws["!merges"] = ws["!merges"].filter(m => m.s.r < FIRST_DATA_ROW - 1 || m.s.r > TOTALS_ROW_TMPL + 5);
      }

      // Write data rows
      let dataRow = FIRST_DATA_ROW;
      let y24count = 0, y25count = 0;
      sr.forEach((d, i) => {
        const yr = String(d.monat||"").substring(0,4);
        const is24 = yr === "2024";
        const isOdd = is24 ? (y24count % 2 === 0) : (y25count % 2 === 0);
        const stk = is24 ? (isOdd ? refStyles.y24odd : refStyles.y24even) : (isOdd ? refStyles.y25odd : refStyles.y25even);
        if (is24) y24count++; else y25count++;

        const r = dataRow;
        wc(ws, `B${r}`, formatGermanMonth(d.monat||""), stk.B, "s");
        wc(ws, `C${r}`, num(d.anzahl_bestellungen), stk.C, "n", "#,##0");
        wc(ws, `D${r}`, num(d.umsatz_eur), stk.D, "n", '#,##0.00" €"');
        // E: formula =Drow/Crow
        wf(ws, `E${r}`, `D${r}/C${r}`, `E5`, '#,##0.00" €"');
        ws[`E${r}`].s = stk.E;
        // F: formula or dash for first row
        if (i === 0) {
          wc(ws, `F${r}`, "-", stk.F, "s");
        } else {
          const prevRow = dataRow - 1;
          wf(ws, `F${r}`, `(D${r}-D${prevRow})/D${prevRow}`, `F6`, '\\+0.0%;\\-0.0%;\\-');
          ws[`F${r}`].s = stk.F;
        }
        dataRow++;
      });

      // GESAMT totals row
      const totR = dataRow;
      const firstR = FIRST_DATA_ROW;
      const lastR = dataRow - 1;
      wc(ws, `B${totR}`, "GESAMT", refStyles.total.B, "s");
      wf(ws, `C${totR}`, `SUM(C${firstR}:C${lastR})`, `C26`, "#,##0");
      ws[`C${totR}`].s = refStyles.total.C;
      wf(ws, `D${totR}`, `SUM(D${firstR}:D${lastR})`, `D26`, '#,##0.00" €"');
      ws[`D${totR}`].s = refStyles.total.D;
      wf(ws, `E${totR}`, `D${totR}/C${totR}`, `E26`, '#,##0.00" €"');
      ws[`E${totR}`].s = refStyles.total.E;
      wc(ws, `F${totR}`, "", refStyles.total.F, "s");

      // Products section (was at row 29 in template, now shift)
      const prodSectionRow = totR + 3;
      // Title merge for products section
      const prodTitleCell = ws[`B29`] ? cloneStyle(ws[`B29`]) : {};
      wc(ws, `B${prodSectionRow}`, "🏆  Top 10 Produkte nach Umsatz", ws[`B29`]?.s || {}, "s");
      if (!ws["!merges"]) ws["!merges"] = [];
      ws["!merges"].push({s:{r:prodSectionRow-1,c:1},e:{r:prodSectionRow-1,c:6}});

      // Product header row
      const prodHdrRow = prodSectionRow + 1;
      const hdrS30 = {
        B: copyS(ws,"B30"), C: copyS(ws,"C30"), D: copyS(ws,"D30"), E: copyS(ws,"E30"), F: copyS(ws,"F30")
      };
      wc(ws, `B${prodHdrRow}`, "#", hdrS30.B, "s");
      wc(ws, `C${prodHdrRow}`, "Produkt", hdrS30.C, "s");
      wc(ws, `D${prodHdrRow}`, "Umsatz (€)", hdrS30.D, "s");
      wc(ws, `E${prodHdrRow}`, "Anteil am Gesamtumsatz", hdrS30.E, "s");
      wc(ws, `F${prodHdrRow}`, "Bestellungen", hdrS30.F, "s");

      // Product data rows
      const pd = getProductRows(pasted.products);
      const prodDataRef_odd = {B:copyS(ws,"B31"),C:copyS(ws,"C31"),D:copyS(ws,"D31"),E:copyS(ws,"E31"),F:copyS(ws,"F31")};
      const prodDataRef_even = {B:copyS(ws,"B32"),C:copyS(ws,"C32"),D:copyS(ws,"D32"),E:copyS(ws,"E32"),F:copyS(ws,"F32")};
      pd.slice(0,15).forEach((d,i)=>{
        const r2 = prodHdrRow + 1 + i;
        const stk2 = i%2===0 ? prodDataRef_odd : prodDataRef_even;
        wc(ws, `B${r2}`, i+1, stk2.B, "n", "0");
        wc(ws, `C${r2}`, d.titel||"-", stk2.C, "s");
        wc(ws, `D${r2}`, num(d.umsatz), stk2.D, "n", '#,##0.00" €"');
        wc(ws, `E${r2}`, totRev>0 ? num(d.umsatz)/totRev : 0, stk2.E, "n", "0.0%");
        wc(ws, `F${r2}`, num(d.stueck||d.positionen), stk2.F, "n", "#,##0");
      });

      // Update sheet ref
      const lastDataR = prodHdrRow + 1 + Math.max(pd.length, 1) + 2;
      ws["!ref"] = `A1:G${lastDataR}`;
    }
  }

  // ── SHEET 3: ⚖️ Parität ──────────────────────────────────────────────────
  {
    const ws = wb.Sheets["⚖️ Parität"];
    if (ws) {
      wc(ws, "B2", `${name}  |  Preisparität (Plattformvergleich)`);

      // The parity daily data table starts at row 19 (header) and 20+ (data)
      const PARITY_HDR_ROW = 19;
      const PARITY_DATA_START = 20;

      const pd = parsePasted(pasted.parity_daily);
      if (pd && pd.rows.length) {
        // Reference styles from template
        const refOdd = {
          B: copyS(ws,`B20`), C: copyS(ws,`C20`), D: copyS(ws,`D20`),
          E: copyS(ws,`E20`), F: copyS(ws,`F20`)
        };
        const refEven = {
          B: copyS(ws,`B21`), C: copyS(ws,`C21`), D: copyS(ws,`D21`),
          E: copyS(ws,`E21`), F: copyS(ws,`F21`)
        };
        // Clear old data rows
        for (let r = PARITY_DATA_START; r <= PARITY_DATA_START + 60; r++) {
          ["B","C","D","E","F"].forEach(c => { delete ws[c+r]; });
        }

        // Write new data - template columns: Datum, Angebote, Meta(%), Amazon(%), OTTO(%)
        // parity_daily fields: day, seller_key, number_offers, ...
        // We'll use columns: day→B, number_offers→C (col index 2),
        // and for Meta/Amazon/OTTO we look for relevant column indices from the paste
        const h = pd.headers;
        // Common column name patterns for the parity fields
        const findCol = (...names) => names.map(n => h.findIndex(x => x.toLowerCase().includes(n.toLowerCase()))).find(i => i >= 0) ?? -1;
        const iDay = findCol("day","datum","date");
        const iOffers = findCol("number_offers","angebote","offers");
        // Meta = higher_than_meta_percent or similar
        const iMeta = findCol("meta","higher_than_meta");
        const iAmz = findCol("amazon","amz");
        const iOtto = findCol("otto");

        pd.rows.forEach((d, i) => {
          const r = PARITY_DATA_START + i;
          const stk = i%2===0 ? refOdd : refEven;
          const dayVal = iDay >= 0 ? Object.values(d)[iDay] : (d.day||d.datum||"");
          const offersVal = iOffers >= 0 ? num(Object.values(d)[iOffers]) : num(d.number_offers||0);
          const metaVal = iMeta >= 0 ? num(Object.values(d)[iMeta])/100 : null;
          const amzVal = iAmz >= 0 ? num(Object.values(d)[iAmz])/100 : null;
          const ottoVal = iOtto >= 0 ? num(Object.values(d)[iOtto])/100 : null;

          wc(ws, `B${r}`, dayVal, stk.B, "s");
          wc(ws, `C${r}`, offersVal, stk.C, "n", "#,##0");

          // Meta % - apply red tint if >50%
          const metaS = metaVal!==null && metaVal>0.5
            ? {...stk.D, fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"}}
            : metaVal!==null && metaVal<0.1
            ? {...stk.D, fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"}}
            : stk.D;
          if (metaVal !== null) wc(ws, `D${r}`, metaVal, metaS, "n", "0.0%");
          if (amzVal !== null) wc(ws, `E${r}`, amzVal, stk.E, "n", "0.0%");
          if (ottoVal !== null) wc(ws, `F${r}`, ottoVal, stk.F, "n", "0.0%");
        });

        const lastR = PARITY_DATA_START + pd.rows.length + 2;
        ws["!ref"] = `A1:F${lastR}`;
      }
    }
  }

  // ── SHEET 4: 🔄 Retouren & Verzüge ──────────────────────────────────────
  {
    const ws = wb.Sheets["🔄 Retouren & Verzüge"];
    if (ws) {
      wc(ws, "B2", `${name}  |  Retouren & Lieferverzüge`);

      // This sheet shows monthly quality metrics from pasted.monthly_quality
      // Template layout:
      //   B4: section header "RETOURENGRÜNDE 2025 (Anteile)"
      //   B5: headers (Grund, Anteil, Bewertung)
      //   B6..B14: data (return reasons) — static in template
      //   B16: section header "LIEFERVERZÜGE 2025"
      //   B17: headers (Kennzahl, Wert)
      //   B18..B23: delay metrics — static in template
      //
      // We'll fill the delay section (rows 18-23) with aggregated data from monthly_quality
      // and add a monthly table below

      const qualRows = getQualityRows(pasted.monthly_quality);
      if (qualRows.length) {
        // Aggregate by year
        const q24rows = qualRows.filter(d=>String(d.jahr_monat).startsWith("2024"));
        const q25rows = qualRows.filter(d=>String(d.jahr_monat).startsWith("2025"));

        const avgQ = (rows, field) => {
          const vals = rows.map(d=>num(d[field])).filter(v=>!isNaN(v));
          return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
        };

        const verz24avg = avgQ(q24rows,"shopverzugsquote");
        const verz25avg = avgQ(q25rows,"shopverzugsquote");
        const ret24avg = avgQ(q24rows,"retourenquote");
        const ret25avg = avgQ(q25rows,"retourenquote");

        // Fill delay section values (rows 18-23)
        const refOdd = copyS(ws,"B18");
        const refEven = copyS(ws,"B19");
        const valRefOdd = copyS(ws,"C18");
        const valRefEven = copyS(ws,"C19");

        // Row 18: Verzüge gesamt - count
        const verzCount25 = q25rows.reduce((s,d)=>s+num(d.bestellpositionen)*num(d.shopverzugsquote)/100,0);
        wc(ws,"C18", verz25avg!==null ? `${Math.round(verzCount25)}` : "—");

        // Row 19: Verzugsquote gesamt
        wc(ws,"C19", verz25avg!==null ? `${verz25avg.toFixed(1)}%` : "—");

        // Row 22: Verzugsquote 2024
        wc(ws,"C22", verz24avg!==null ? `${verz24avg.toFixed(1)}%` : "—");

        // Row 23: Verbesserung
        if (verz24avg!==null && verz25avg!==null) {
          const diff = verz25avg - verz24avg;
          const diffLabel = diff<=0 ? `▼ ${Math.abs(diff).toFixed(1)} Prozentpunkte` : `▲ +${diff.toFixed(1)} Prozentpunkte`;
          const diffStyle = diff<=0 ? {...copyS(ws,"B23"), fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"}} : {...copyS(ws,"B23"), fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"}};
          wc(ws,"B23","Verbesserung ggü. 2024", diffStyle,"s");
          wc(ws,"C23", diffLabel, diff<=0 ? {...copyS(ws,"C23"),fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"}} : {...copyS(ws,"C23"),fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"}}, "s");
        }

        // Add monthly table below the template content (from row 26 onwards)
        const monthlyHdrRow = 26;
        // Section title
        const sectionStyle = copyS(ws,"B4");
        wc(ws, `B${monthlyHdrRow}`, "MONATLICHE QUALITÄTSKENNZAHLEN", sectionStyle, "s");
        if (!ws["!merges"]) ws["!merges"] = [];
        ws["!merges"].push({s:{r:monthlyHdrRow-1,c:1},e:{r:monthlyHdrRow-1,c:3}});

        const colHdrStyle = copyS(ws,"B5");
        const colHdrRow = monthlyHdrRow + 1;
        wc(ws, `B${colHdrRow}`, "Monat", colHdrStyle,"s");
        wc(ws, `C${colHdrRow}`, "Stornoquote", colHdrStyle,"s");
        wc(ws, `D${colHdrRow}`, "Retourenquote", colHdrStyle,"s");

        // Also add E column for Verzugsquote
        // Extend merges and column
        const dataRefOdd = copyS(ws,"B6");
        const dataRefEven = copyS(ws,"B7");
        const valRefOdd2 = copyS(ws,"C6");
        const valRefEven2 = copyS(ws,"C7");

        qualRows.forEach((d,i)=>{
          const r = colHdrRow + 1 + i;
          const isOdd = i%2===0;
          const rowLabelS = isOdd ? dataRefOdd : dataRefEven;
          const valS = isOdd ? valRefOdd2 : valRefEven2;

          // Storno rate coloring
          const stV = num(d.shopstornoquote);
          const retV = num(d.retourenquote);
          const stS = stV > 5 ? {...valS, fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"}, font:{...valS.font,color:{rgb:"FFC00000"}}} : stV < 2 ? {...valS, fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"}} : valS;
          const retSt = retV > 5 ? {...valS, fill:{fgColor:{rgb:"FFFCE4D6"},patternType:"solid"}, font:{...valS.font,color:{rgb:"FFC00000"}}} : retV < 2 ? {...valS, fill:{fgColor:{rgb:"FFE2EFDA"},patternType:"solid"}} : valS;

          wc(ws, `B${r}`, d.jahr_monat||"", rowLabelS,"s");
          wc(ws, `C${r}`, stV/100, stS,"n","0.0%");
          wc(ws, `D${r}`, retV/100, retSt,"n","0.0%");
        });

        const lastR = colHdrRow + 1 + qualRows.length + 2;
        ws["!ref"] = `A1:D${lastR}`;
      }
    }
  }

  // ── SHEET 5: 🛒 Sortiment ────────────────────────────────────────────────
  {
    const ws = wb.Sheets["🛒 Sortiment"];
    if (ws) {
      wc(ws, "B2", `${name}  |  Sortiment`);

      // Template has a small layout (rows 6-11 static info + note at 13).
      // We'll keep the static layout and add top products & categories below row 14.

      // Ref styles from existing rows
      const dataOddS = {B:copyS(ws,"B6"), C:copyS(ws,"C6"), D:copyS(ws,"D6")};
      const dataEvenS = {B:copyS(ws,"B7"), C:copyS(ws,"C7"), D:copyS(ws,"D7")};
      const sectionS = copyS(ws,"B4");
      const hdrS = copyS(ws,"B5");

      // Remove old note at row 13 to re-add it at end
      const noteVal = ws["B13"]?.v;
      const noteStyle = copyS(ws,"B13");
      delete ws["B13"]; delete ws["C13"]; delete ws["D13"];

      // ── Top Products section ──
      const prodHdrRow = 14;
      wc(ws, `B${prodHdrRow}`, "TOP PRODUKTE NACH UMSATZ", sectionS,"s");
      if (!ws["!merges"]) ws["!merges"] = [];
      ws["!merges"].push({s:{r:prodHdrRow-1,c:1},e:{r:prodHdrRow-1,c:3}});

      const prodColHdr = prodHdrRow + 1;
      wc(ws, `B${prodColHdr}`, "Produkt", hdrS,"s");
      wc(ws, `C${prodColHdr}`, "Umsatz (€)", hdrS,"s");
      wc(ws, `D${prodColHdr}`, "Anteil", hdrS,"s");

      const pd = getProductRows(pasted.products);
      pd.slice(0,15).forEach((d,i)=>{
        const r = prodColHdr + 1 + i;
        const stk = i%2===0 ? dataOddS : dataEvenS;
        wc(ws, `B${r}`, (d.titel||"-"), stk.B,"s");
        wc(ws, `C${r}`, num(d.umsatz), stk.C,"n",'#,##0.00" €"');
        wc(ws, `D${r}`, totRev>0?num(d.umsatz)/totRev:0, stk.D,"n","0.0%");
      });

      // ── Top Categories section ──
      const catStartRow = prodColHdr + 1 + Math.max(pd.length,1) + 2;
      wc(ws, `B${catStartRow}`, "TOP KATEGORIEN", sectionS,"s");
      ws["!merges"].push({s:{r:catStartRow-1,c:1},e:{r:catStartRow-1,c:3}});

      const catColHdr = catStartRow + 1;
      wc(ws, `B${catColHdr}`, "Kategorie", hdrS,"s");
      wc(ws, `C${catColHdr}`, "Umsatz (€)", hdrS,"s");
      wc(ws, `D${catColHdr}`, "Bestellungen", hdrS,"s");

      const cats = parsePasted(pasted.categories);
      if (cats) {
        // Try to map to: kategorie, umsatz, teilbestellungen
        const catRows = cats.rows;
        catRows.slice(0,20).forEach((d,i)=>{
          const r = catColHdr + 1 + i;
          const stk = i%2===0 ? dataOddS : dataEvenS;
          const kat = d.kategorie || d.name || d.tag || Object.values(d)[0] || "";
          const umsatz = num(d.umsatz || d.revenue || Object.values(d)[1] || 0);
          const orders = num(d.teilbestellungen || d.orders || Object.values(d)[2] || 0);
          wc(ws, `B${r}`, kat, stk.B,"s");
          wc(ws, `C${r}`, umsatz, stk.C,"n",'#,##0.00" €"');
          wc(ws, `D${r}`, orders, stk.D,"n","#,##0");
        });
      }

      // Re-add note at end
      const noteRow = catColHdr + 1 + (cats?Math.max(cats.rows.length,1):1) + 2;
      wc(ws, `B${noteRow}`, noteVal||"", noteStyle,"s");
      ws["!merges"].push({s:{r:noteRow-1,c:1},e:{r:noteRow-1,c:3}});

      const lastR = noteRow + 2;
      ws["!ref"] = `A1:D${lastR}`;
    }
  }

  return wb;
}

// Build a simple, single-sheet workbook ("Data") with all query outputs side by side.
async function buildDataWorkbook(XLSX, shopName, sellerKey, pasted) {
  const wb = XLSX.utils.book_new();
  const ws = {};
  const sheetName = "Data";

  const setByRC = (row, col, value) => {
    const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
    ws[addr] = { v: value, t: typeof value === "number" ? "n" : "s" };
  };

  let currentCol = 1;
  let maxRow = 1;
  let maxCol = 1;

  const addTable = (title, headers, rows) => {
    if (!rows || !rows.length || !headers || !headers.length) return;

    const startCol = currentCol;
    let r = 1;

    setByRC(r, startCol, title);
    r += 2;

    headers.forEach((h, idx) => {
      setByRC(r, startCol + idx, h);
    });
    r += 1;

    rows.forEach((rowObj) => {
      headers.forEach((h, idx) => {
        const v = rowObj[h] ?? "";
        const isNumber = typeof v === "number";
        const addr = XLSX.utils.encode_cell({ r: r - 1, c: startCol + idx - 1 });
        ws[addr] = {
          v: isNumber ? v : String(v),
          t: isNumber ? "n" : "s",
        };
      });
      r += 1;
    });

    const tableLastRow = r - 1;
    const tableLastCol = startCol + headers.length - 1;
    if (tableLastRow > maxRow) maxRow = tableLastRow;
    if (tableLastCol > maxCol) maxCol = tableLastCol;

    currentCol = tableLastCol + 3;
  };

  const salesRows = getSalesRows(pasted.sales);
  addTable("Monatsumsatz", ["monat","anzahl_bestellungen","umsatz_eur","avg_order_value_eur"], salesRows);

  const parityRows = getParityRows(pasted.parity_daily);
  addTable("Preisparität (täglich)", ["day","number_offers","pct_meta","pct_amazon","pct_otto"], parityRows);

  const productRows = getProductRows(pasted.products);
  addTable("Top Produkte", ["csin","titel","positionen","stueck","umsatz"], productRows);

  const categoryRows = getCategoryRows(pasted.categories);
  addTable("Top Kategorien", ["kategorie","umsatz","teilbestellungen"], categoryRows);

  const dailyParsed = parsePasted(pasted.daily_orders);
  const dailyRows = dailyParsed && dailyParsed.rows ? dailyParsed.rows : [];
  if (dailyRows.length) {
    const headers = (dailyParsed.headers && dailyParsed.headers.length
      ? dailyParsed.headers
      : Object.keys(dailyRows[0] || []));
    addTable("Bestelldetails", headers, dailyRows);
  }

  const qualityRows = getQualityRows(pasted.monthly_quality);
  addTable(
    "Monatliche Storno/Retouren/Verzug",
    ["jahr_monat","bestellpositionen","umsatz","shopstornoquote","retourenquote","shopverzugsquote"],
    qualityRows
  );

  if (maxRow < 1) maxRow = 1;
  if (maxCol < 1) maxCol = 1;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow - 1, c: maxCol - 1 },
  });

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

// Build a single preview "sheet" that mirrors the Data workbook layout
// so the UI shows one combined page instead of multiple tabs.
function buildPreviewSheetsDataOnly(shopName, sellerKey, pasted) {
  const grid = [];
  let currentCol = 0;
  let maxRow = -1;
  let maxCol = -1;

  const ensureCell = (r, c) => {
    while (grid.length <= r) grid.push([]);
    while (grid[r].length <= c) grid[r].push("");
  };

  const setCell = (r, c, value) => {
    ensureCell(r, c);
    grid[r][c] = value;
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  };

  const addTable = (title, headers, rows) => {
    if (!rows || !rows.length || !headers || !headers.length) return;

    const startCol = currentCol;
    let r = 0;

    // Title row
    setCell(r, startCol, title);
    r += 2; // blank row between title and header

    // Header row
    headers.forEach((h, idx) => {
      setCell(r, startCol + idx, h);
    });
    r += 1;

    // Data rows
    rows.forEach((rowObj) => {
      headers.forEach((h, idx) => {
        const v = rowObj[h] ?? "";
        setCell(r, startCol + idx, v);
      });
      r += 1;
    });

    currentCol = startCol + headers.length + 3; // leave two empty columns before next table
  };

  const salesRows = getSalesRows(pasted.sales);
  addTable("Monatsumsatz", ["monat","anzahl_bestellungen","umsatz_eur","avg_order_value_eur"], salesRows);

  const parityRows = getParityRows(pasted.parity_daily);
  addTable("Preisparität (täglich)", ["day","number_offers","pct_meta","pct_amazon","pct_otto"], parityRows);

  const productRows = getProductRows(pasted.products);
  addTable("Top Produkte", ["csin","titel","positionen","stueck","umsatz"], productRows);

  const categoryRows = getCategoryRows(pasted.categories);
  addTable("Top Kategorien", ["kategorie","umsatz","teilbestellungen"], categoryRows);

  const dailyParsed = parsePasted(pasted.daily_orders);
  const dailyRows = dailyParsed && dailyParsed.rows ? dailyParsed.rows : [];
  if (dailyRows.length) {
    const headers = (dailyParsed.headers && dailyParsed.headers.length
      ? dailyParsed.headers
      : Object.keys(dailyRows[0] || []));
    addTable("Bestelldetails", headers, dailyRows);
  }

  const qualityRows = getQualityRows(pasted.monthly_quality);
  addTable(
    "Monatliche Storno/Retouren/Verzug",
    ["jahr_monat","bestellpositionen","umsatz","shopstornoquote","retourenquote","shopverzugsquote"],
    qualityRows
  );

  // Always show at least a 100x100 Grid in the Data preview
  const baseSize = 100;
  const rowCount = Math.max(baseSize, maxRow >= 0 ? maxRow + 1 : 1);
  const colCount = Math.max(baseSize, maxCol >= 0 ? maxCol + 1 : 1);

  const rowsOut = [];
  for (let r = 0; r < rowCount; r += 1) {
    const src = grid[r] || [];
    const out = [];
    for (let c = 0; c < colCount; c += 1) {
      out[c] = src[c] != null ? src[c] : "";
    }
    rowsOut.push(out);
  }

  const headers = Array.from({ length: colCount }, () => "");

  return [
    {
      name: "Data",
      kpis: [],
      headers,
      rows: rowsOut,
      totals: null,
    },
  ];
}

// ─── Fallback: build from scratch (if template fetch fails) ──────────────────
function buildExcelFromScratch(XLSX, shopName, pasted) {
  const wb = XLSX.utils.book_new();
  const DK="1F3864",MD="2F5496",GR="F2F2F2",WH="FFFFFF",BL="4472C4",GY="595959";
  const H=(v,bg=DK)=>({v,t:"s",s:{font:{bold:true,sz:11,color:{rgb:WH},name:"Arial"},fill:{fgColor:{rgb:bg},patternType:"solid"},alignment:{horizontal:"center",vertical:"center"}}});
  const C=(v,type="s",stripe=false,fmt)=>({v:type==="n"?num(v):v,t:type,s:{font:{sz:11,name:"Arial"},fill:{fgColor:{rgb:stripe?GR:WH},patternType:"solid"},alignment:{horizontal:type==="n"?"right":"left",vertical:"center"},numFmt:fmt}});
  const row=(ws,r,cells)=>cells.forEach((c,i)=>{if(c!==null){const a=String.fromCharCode(66+i)+r;ws[a]=c;}});

  // Build minimal 5-sheet workbook
  ["📊 Übersicht","📈 Umsatz","⚖️ Parität","🔄 Retouren & Verzüge","🛒 Sortiment"].forEach(name=>{
    const ws={};ws["B2"]={v:name,t:"s",s:{font:{bold:true,sz:15,color:{rgb:WH},name:"Arial"},fill:{fgColor:{rgb:DK},patternType:"solid"}}};
    ws["!ref"]="A1:G30";XLSX.utils.book_append_sheet(wb,ws,name);
  });
  return wb;
}

// ─── Preview helpers ──────────────────────────────────────────────────────────
function buildPreviewSheets(shopName, sellerKey, pasted) {
  const size = 100;
  const makeGrid = () => ({
    headers: Array.from({length:size}, () => ""),
    rows: Array.from({length:size}, () => Array(size).fill("")),
  });

  // Parsed data from pasted query results
  const salesRows = getSalesRows(pasted.sales);
  const salesSorted = salesRows.slice().sort((a,b)=>String(a.monat||"").localeCompare(String(b.monat||"")));
  const totalSalesRev = salesRows.reduce((s,d)=>s+num(d.umsatz_eur),0);
  const totalSalesOrders = salesRows.reduce((s,d)=>s+num(d.anzahl_bestellungen),0);
  const salesByYear = salesRows.reduce((acc,d)=>{
    const yr = String(d.monat||"").substring(0,4);
    if(!/^\d{4}$/.test(yr)) return acc;
    if(!acc[yr]) acc[yr]={rev:0,orders:0};
    acc[yr].rev+=num(d.umsatz_eur);
    acc[yr].orders+=num(d.anzahl_bestellungen);
    return acc;
  },{});
  const y24 = salesByYear["2024"]||{rev:0,orders:0};
  const y25 = salesByYear["2025"]||{rev:0,orders:0};

  const qualityRows = getQualityRows(pasted.monthly_quality);
  const qualityByYear = qualityRows.reduce((acc,d)=>{
    const yr = String(d.jahr_monat||"").substring(0,4);
    if(!/^\d{4}$/.test(yr)) return acc;
    if(!acc[yr]) acc[yr]={storno:[],ret:[],verz:[]};
    acc[yr].storno.push(num(d.shopstornoquote));
    acc[yr].ret.push(num(d.retourenquote));
    acc[yr].verz.push(num(d.shopverzugsquote));
    return acc;
  },{});
  const avgArr = arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null;
  const q24 = qualityByYear["2024"]||{storno:[],ret:[],verz:[]};
  const q25 = qualityByYear["2025"]||{storno:[],ret:[],verz:[]};
  const storno24 = avgArr(q24.storno), storno25 = avgArr(q25.storno);
  const ret24 = avgArr(q24.ret), ret25 = avgArr(q25.ret);
  const verz24 = avgArr(q24.verz), verz25 = avgArr(q25.verz);

  const parityRows = getParityRows(pasted.parity_daily);
  const productRows = getProductRows(pasted.products);
  const categoryRows = getCategoryRows(pasted.categories);
  const dailyDetails = parsePasted(pasted.daily_orders);

  const sheets = [];

  // SHEET: 📊 Übersicht
  const g1 = makeGrid();
  const set1 = (r,c,v) => {
    if (r<1||r>size||c<1||c>size) return;
    g1.rows[r-1][c-1] = v;
  };

  // Title / Allgemeine Daten
  set1(1,1," | Partner-Analyse"); // A1
  set1(3,1,"Allgemeine Daten");   // A3
  set1(4,1,"Seller_key");         // A4
  // B4: aktueller Seller-Key (falls vorhanden)
  set1(4,2, (sellerKey || "").trim()); // B4
  set1(5,1,"Schnittstelle");      // A5
  set1(6,1,"OpenTrans Format");   // A6
  set1(7,1,"Partner seit");       // A7
  set1(8,1,"Provision");          // A8
  set1(9,1,"Angebotsfeed");       // A9
  set1(10,1,"Ansprechpartner");   // A10

  // Geschäftsentwicklung 2024 → 2025 block
  set1(12,1,"GESCHÄFTSENTWICKLUNG 2024 → 2025"); // A12
  set1(13,1,"Jahr");               // A13
  set1(13,2,"Bestellpositionen");  // B13
  set1(13,3,"Umsatz (€)");         // C13
  set1(13,4,"Stornoquote");        // D13
  set1(13,5,"Retourenquote");      // E13
  set1(14,1,2024);                 // A14
  set1(15,1,2025);                 // A15

  // Qualitätskennzahlen 2024 vs 2025 block
  set1(17,1,"QUALITÄTSKENNZAHLEN 2024 vs 2025"); // A17
  set1(18,1,"Kennzahl");           // A18
  set1(18,2,"2024");               // B18
  set1(18,3,"2025");               // C18
  set1(18,4,"Trend");              // D18
  set1(18,5,"Hinweis");            // E18
  set1(19,1,"Stornoquote");                // A19
  set1(20,1,"Shop-induz. Stornoquote");    // A20
  set1(21,1,"Retourenquote");              // A21
  set1(22,1,"Goodwill Ratio");             // A22
  set1(23,1,"Verzugsquote (gesamt)");      // A23
  set1(24,1,"Verzugsquote (Shop)");        // A24

  // Positiv/Negativ
  set1(27,1,"✅ POSITIV");         // A27
  set1(27,3,"⚠️ NEGATIV");        // C27

  // Ziele
  set1(35,1,"🎯 MINIMAL-ZIEL");   // A35
  set1(35,3,"🏆 MAXIMAL-ZIEL");   // C35

  // Dynamische Werte: Geschäftsentwicklung 2024/2025
  if (y24.orders||y24.rev||storno24||ret24) {
    set1(14,2, y24.orders||"");
    set1(14,3, y24.rev||"");
    set1(14,4, storno24!=null?storno24.toFixed(1)+"%":"");
    set1(14,5, ret24!=null?ret24.toFixed(1)+"%":"");
  }
  if (y25.orders||y25.rev||storno25||ret25) {
    set1(15,2, y25.orders||"");
    set1(15,3, y25.rev||"");
    set1(15,4, storno25!=null?storno25.toFixed(1)+"%":"");
    set1(15,5, ret25!=null?ret25.toFixed(1)+"%":"");
  }

  // Dynamische Werte: Qualitätskennzahlen 2024 vs 2025
  const trendText=(vA,vB,lowerIsBetter=true)=>{
    if(vA==null||vB==null) return "";
    const diff=vB-vA;
    if(Math.abs(diff)<0.05) return "≈ gleich";
    const improved = lowerIsBetter ? diff<0 : diff>0;
    const mag = Math.abs(diff)>5?"stark ":"";
    return improved?`▼ ${mag}besser`:`▲ ${mag}schlechter`;
  };
  // Row 19: Stornoquote
  set1(19,2,storno24!=null?storno24.toFixed(1)+"%":"");
  set1(19,3,storno25!=null?storno25.toFixed(1)+"%":"");
  set1(19,4,trendText(storno24,storno25,true));
  // Row 20: Shop-induz. Stornoquote (gleich wie Stornoquote mangels Detail)
  set1(20,2,storno24!=null?storno24.toFixed(1)+"%":"");
  set1(20,3,storno25!=null?storno25.toFixed(1)+"%":"");
  set1(20,4,trendText(storno24,storno25,true));
  // Row 21: Retourenquote
  set1(21,2,ret24!=null?ret24.toFixed(1)+"%":"");
  set1(21,3,ret25!=null?ret25.toFixed(1)+"%":"");
  set1(21,4,trendText(ret24,ret25,true));
  // Row 23: Verzugsquote gesamt
  set1(23,2,verz24!=null?verz24.toFixed(1)+"%":"");
  set1(23,3,verz25!=null?verz25.toFixed(1)+"%":"");
  set1(23,4,trendText(verz24,verz25,true));

  // ── Regelbasierte Hinweise (Order-Volumen, AOV, Retouren, Stornos, Wachstum) ──
  const totalOrders25 = y25.orders || 0;
  const aov25 = y25.orders > 0 ? y25.rev / y25.orders : null;

  // 1.1 Order Volume relevance threshold
  let volumeNote = "";
  if (totalOrders25 > 0 && totalOrders25 <= 10) {
    volumeNote = "Geringes Datenvolumen (≤10 Bestellungen) – KPIs nur indikativ";
  }

  // 1.2 Revenue vs Orders sanity check (AOV)
  let aovNote = "";
  if (aov25 !== null && aov25 > 0 && (aov25 < 5 || aov25 > 2000)) {
    aovNote = "AOV auffällig (<5€ oder >2000€) – Produktmix/Daten prüfen";
  }

  // 3. Return Rate Logic
  let returnNote = "";
  if (totalOrders25 > 10) {
    if (totalOrders25 > 50 && ret25 != null && ret25 > 15) {
      returnNote = "Kritisch: Retourenquote >15% bei >50 Bestellungen";
    } else if (ret25 != null && ret25 > 10) {
      returnNote = "Warnung: Retourenquote >10%";
    }
  }

  // 4. Cancellation Rate Logic (Stornoquote)
  let cancelNote = "";
  if (totalOrders25 > 10) {
    if (storno25 != null && storno25 > 10) {
      cancelNote = "Kritisch: Stornoquote >10%";
    } else if (storno25 != null && storno25 > 5) {
      cancelNote = "Warnung: Stornoquote >5%";
    }
  }

  // 11. Growth Signal (Revenue YOY)
  let growthNote = "";
  if (y24.rev > 0 && y25.rev > 0) {
    const growth = ((y25.rev - y24.rev) / y24.rev) * 100;
    if (growth > 20) {
      growthNote = "Starkes Umsatzwachstum (>20% YoY)";
    } else if (growth >= 5) {
      growthNote = "Gesundes Umsatzwachstum (5–20% YoY)";
    } else if (growth < 0) {
      growthNote = "Umsatzrückgang – Entwicklung beobachten";
    }
  }

  // Hinweise neben die relevanten Zellen schreiben
  // AOV / Wachstum-Hinweis neben 2025-Zeile der Geschäftsentwicklung (Zeile 15, Spalte 5)
  const combinedDevNote = [aovNote, growthNote].filter(Boolean).join(" | ");
  if (combinedDevNote) {
    set1(15,5,combinedDevNote);
  }

  // Storno-Hinweis in Qualitätsblock Zeile 19, Spalte 5
  const stornoCombined = [cancelNote, volumeNote].filter(Boolean).join(" | ");
  if (stornoCombined) {
    set1(19,5,stornoCombined);
  }

  // Retouren-Hinweis in Qualitätsblock Zeile 21, Spalte 5
  const retCombined = [returnNote, volumeNote].filter(Boolean).join(" | ");
  if (retCombined) {
    set1(21,5,retCombined);
  }

  sheets.push({
    name:"📊 Übersicht",
    kpis:[],
    headers:g1.headers,
    rows:g1.rows,
    totals:null,
  });

  // SHEET: 📈 Umsatz
  const g2 = makeGrid();
  const set2 = (r,c,v) => {
    if (r<1||r>size||c<1||c>size) return;
    g2.rows[r-1][c-1] = v;
  };

  // Kopfzeile der Monatstabelle ab Zeile 1
  set2(1,1,"Monat");              // A1
  set2(1,2,"Bestellpositionen");  // B1
  set2(1,3,"Umsatz (€)");         // C1
  set2(1,4,"Ø Warenkorbwert (€)");// D1
  set2(1,5,"Ggü. Vormonat (%)");  // E1

  // Gesamtsumme eine Zeile unterhalb der letzten Datenzeile (Standard: Zeile 23)
  set2(23,1,"GESAMT");            // A23
  set2(23,2,"=SUM(B2:B22)");      // B23
  set2(23,3,"=SUM(C2:C22)");      // C23
  set2(23,4,"=C23/B23");          // D23

  // Bereich Top-10-Produkte beginnt jetzt in Zeile 26 (statt 28)
  set2(26,1,"🏆 Top 10 Produkte nach Umsatz"); // A26
  set2(27,1,"#");                 // A27
  set2(27,2,"Produkt");           // B27
  set2(27,3,"Views (Mio.)");      // C27
  set2(27,4,"Umsatz (€)");        // D27
  set2(27,5,"Anteil am Gesamtumsatz"); // E27
  for(let i=0;i<10;i++){          // A28–A37: 1–10
    set2(28+i,1,1+i);
  }
  set2(38,1,"Top 10 Gesamt");     // A38
  set2(38,4,"=SUM(D28:D37)");     // D38

  // Bereich Umsatz nach Kategorie beginnt nun zwei Zeilen früher
  set2(41,1,"📦 Umsatz nach Kategorie"); // A41
  set2(42,1,"#");                 // A42
  set2(42,2,"Kategorie");         // B42
  set2(42,3,"Bestellungen");      // C42
  set2(42,4,"Umsatz (€)");        // D42
  set2(42,5,"Anteil am Gesamtumsatz"); // E42
  for(let i=0;i<10;i++){          // A43–A52: 1–10
    set2(43+i,1,1+i);
  }
  set2(53,1,"Gesamtumsatz");      // A53
  set2(53,4,"=SUM(D43:D52)");     // D53

  // Dynamische Werte: Monatsumsatz-Tabelle (Zeilen 4ff)
  if (salesSorted.length){
    let prevRev=null;
    salesSorted.forEach((d,idx)=>{
      const r=2+idx; // Datenzeilen ab Zeile 2
      if(r>22) return; // begrenzen auf sichtbare Zeilen
      const rev=num(d.umsatz_eur);
      const ord=num(d.anzahl_bestellungen);
      set2(r,1,formatGermanMonth(d.monat||""));
      set2(r,2,ord||"");
      set2(r,3,rev||"");
      set2(r,4,ord>0?(rev/ord).toFixed(2):"");
      if(prevRev!=null && prevRev>0){
        const mom=(rev-prevRev)/prevRev*100;
        set2(r,5,mom.toFixed(1)+"%");
      }
      prevRev=rev;
    });
  }

  // Dynamische Werte: Top 10 Produkte nach Umsatz
  if (productRows.length){
    const top=productRows.slice(0,10);
    const totalProdRev=top.reduce((s,p)=>s+num(p.umsatz||p.revenue||0),0);
    top.forEach((p,i)=>{
      const r=30+i;
      const titel=p.titel||p.Produkt||p.product||Object.values(p)[1]||"";
      const views=p.views||p.views_mio||p["Views (Mio.)"]||"";
      const rev=num(p.umsatz||p.revenue||Object.values(p)[3]||0);
      set2(r,2,titel);
      set2(r,3,views);
      set2(r,4,rev||"");
      set2(r,5,totalProdRev>0?((rev/totalProdRev)*100).toFixed(1)+"%":"");
    });
  }

  // Dynamische Werte: Umsatz nach Kategorie
  if (categoryRows.length){
    const topC=categoryRows.slice(0,10);
    const totalCatRev=topC.reduce((s,c)=>s+num(c.umsatz||0),0);
    topC.forEach((c,i)=>{
      const r=45+i;
      const kat=c.kategorie||"";
      const orders=num(c.teilbestellungen||0);
      const rev=num(c.umsatz||0);
      set2(r,2,kat);
      set2(r,3,orders||"");
      set2(r,4,rev||"");
      set2(r,5,totalCatRev>0?((rev/totalCatRev)*100).toFixed(1)+"%":"");
    });
  }

  sheets.push({
    name:"📈 Umsatz",
    kpis:[],
    headers:g2.headers,
    rows:g2.rows,
    totals:null,
  });

  // SHEET: ⚖️ Parität
  const g3 = makeGrid();
  const set3 = (r,c,v) => {
    if (r<1||r>size||c<1||c>size) return;
    g3.rows[r-1][c-1] = v;
  };

  // Kopfbereich wie spezifiziert
  set3(1,1,"ÜBERSICHT");       // A1
  // B1, C1, D1 bleiben leer

  set3(2,1,"Kennzahl");        // A2
  set3(2,2,"Anteil");          // B2
  set3(2,3,"Bewertung");       // C2

  set3(3,1,"Bestpreis (mit Preisanpassung)");   // A3
  set3(4,1,"Bestpreis (ohne Preisanpassung)");  // A4
  set3(5,1,"bis 2% über Bestpreis");            // A5
  set3(6,1,"2–5% über Bestpreis");              // A6
  set3(7,1,"5–10% über Bestpreis");             // A7
  set3(8,1,"mehr als 10% über Bestpreis");      // A8
  set3(9,1,"Teurer als Meta");                  // A9
  set3(10,1,"Teurer als Amazon");               // A10
  set3(11,1,"Teurer als OTTO");                 // A11
  // Zeile 12 bleibt leer

  set3(13,1,"TAGESVERLAUF PARITÄT (letzten 30 Tage)"); // A13
  set3(14,1,"Datum");          // A14
  set3(14,2,"Angebote");       // B14
  set3(14,3,"Meta (%)");       // C14
  set3(14,4,"Amazon (%)");     // D14
  set3(14,5,"OTTO (%)");       // E14

  // Dynamische Werte: Tagesverlauf Parität (bis zu 30 Tage)
  if (parityRows.length){
    parityRows.slice(0,30).forEach((d,idx)=>{
      const r=15+idx; // Daten ab Zeile 15 unterhalb der Kopfzeile
      set3(r,1,d.day||"");
      set3(r,2,num(d.number_offers||0));
      set3(r,3,num(d.pct_meta||0));
      set3(r,4,num(d.pct_amazon||0));
      set3(r,5,num(d.pct_otto||0));
    });
  }

  sheets.push({
    name:"⚖️ Parität",
    kpis:[],
    headers:g3.headers,
    rows:g3.rows,
    totals:null,
  });

  // SHEET: 🔄 Retouren & Verzüge
  const g4 = makeGrid();
  const set4 = (r,c,v) => {
    if (r<1||r>size||c<1||c>size) return;
    g4.rows[r-1][c-1] = v;
  };

  set4(2,1,"Küchen Preisbombe | Retouren & Lieferverzüge"); // A2
  // Inhalt um 3 Zeilen nach oben verschoben
  set4(1,1,"RETOURENGRÜNDE 2025 (Anteile)"); // vormals A4
  set4(2,1,"Grund");          // vormals A5
  set4(2,2,"Anteil");         // vormals B5
  set4(2,3,"Bewertung");      // vormals C5
  set4(3,1,"Falsche Teile (wrong_parts)"); // vormals A6
  set4(4,1,"Fehlende Teile (parts_missing)"); // vormals A7
  set4(5,1,"Beschädigtes Produkt (damaged)"); // vormals A8
  set4(6,1,"Beschädigte Verpackung (packaging)"); // vormals A9
  set4(7,1,"Inkompatibel (incompatible)"); // vormals A10
  set4(8,1,"Versehentlich bestellt"); // vormals A11
  set4(9,1,"Qualitätsmangel (quality)"); // vormals A12
  set4(10,1,"Günstigerer Preis gefunden"); // vormals A13

  set4(13,1,"LIEFERVERZÜGE 2025"); // vormals A16
  set4(14,1,"Kennzahl");           // vormals A17
  set4(14,2,"Wert");               // vormals B17
  set4(15,1,"Verzüge gesamt (2025)"); // vormals A18
  set4(16,1,"Verzugsquote gesamt");   // vormals A19
  set4(17,1,"davon Paketware");       // vormals A20
  set4(18,1,"davon Spedition");       // vormals A21
  set4(19,1,"Verzugsquote (2024)");   // vormals A22
  set4(20,1,"Verbesserung");          // vormals A23

  // Dynamische Werte: Retourengründe 2025 aus Bestelldetails
  if (dailyDetails && dailyDetails.rows.length){
    const rows=dailyDetails.rows;
    const byReason={};
    let totalOrders=0;
    rows.forEach(r=>{
      const status=String(r.status_order_shop||"").toLowerCase();
      const reason=(r.canceled_reason_key||r.reason||"unbekannt").toString().toLowerCase()||"unbekannt";
      const count=num(r.order_count||r.ordercount||1)||1;
      totalOrders+=count;
      if(status==="returned"||status==="canceled_by_shop"||status==="canceled_by_customer"||status==="canceled"){
        byReason[reason]=(byReason[reason]||0)+count;
      }
    });
    const entries=Object.entries(byReason).sort((a,b)=>b[1]-a[1]).slice(0,8);
    entries.forEach(([reason,count],idx)=>{
      const r=3+idx; // um 3 Zeilen nach oben verschoben (vormals 6+idx)
      const share=totalOrders>0?(count/totalOrders*100):0;
      set4(r,1,reason);
      set4(r,2,share.toFixed(1)+"%");
      set4(r,3,share>10?"kritisch":share>5?"auffällig":"ok");
    });
  }

  // Dynamische Werte: Lieferverzüge 2025 aus Qualitätsdaten
  const qual2025 = qualityRows.filter(d=>String(d.jahr_monat||"").startsWith("2025"));
  if (qual2025.length){
    const sumBest=qual2025.reduce((s,d)=>s+num(d.bestellpositionen),0);
    const avgVerz=avgArr(qual2025.map(d=>num(d.shopverzugsquote)));
    set4(15,2,sumBest||""); // vormals Zeile 18
    set4(16,2,avgVerz!=null?avgVerz.toFixed(1)+"%":""); // vormals Zeile 19
  }

  sheets.push({
    name:"🔄 Retouren & Verzüge",
    kpis:[],
    headers:g4.headers,
    rows:g4.rows,
    totals:null,
  });

  // SHEET: 🛒 Sortiment
  const g5 = makeGrid();
  const set5 = (r,c,v) => {
    if (r<1||r>size||c<1||c>size) return;
    g5.rows[r-1][c-1] = v;
  };

  set5(2,1,"Küchen Preisbombe | Sortiment"); // A2
  // Inhalt um 3 Zeilen nach oben verschoben
  set5(1,1,"SORTIMENT-ÜBERSICHT"); // vormals A4
  set5(2,1,"Kategorie");           // vormals A5
  set5(2,2,"Anzahl");             // vormals B5
  set5(2,3,"Anteil / Hinweis");   // vormals C5
  set5(3,1,"Angebote gesamt");   // vormals A6
  set5(4,1,"Nicht vorrätig");    // vormals A7
  set5(5,1,"Preisangabe fehlerhaft"); // vormals A8
  set5(6,1,"Lieferzeit fehlt");  // vormals A9
  set5(7,1,"Kein Bild");        // vormals A10
  set5(10,1,"📌 Notiz: ");       // vormals A13

  // Dynamische Werte für Sortiment können später ergänzt werden (z.B. aus Kategorien/Feeds)

  sheets.push({
    name:"🛒 Sortiment",
    kpis:[],
    headers:g5.headers,
    rows:g5.rows,
    totals:null,
  });

  return sheets;
}

// ─── UI Components ────────────────────────────────────────────────────────────
function ExcelPreview({ sheets, activeSheet, onSheetChange, onEditCell }) {
  if (!sheets.length) return null;
  const sheet = sheets[Math.min(activeSheet, sheets.length-1)];
  if (!sheet) return null;
  const GRID="#D0D7E8", ALT="#F2F5FC", NB="rgb(4,16,103)";
  const [copyState,setCopyState]=useState("idle");
  const [colWidths, setColWidths] = useState([]);
  const [rowHeights, setRowHeights] = useState([]);
  const resizeStateRef = useRef(null);

  // Initialize widths/heights when sheet or dimensions change
  useEffect(() => {
    const cols = sheet.headers ? sheet.headers.length : (sheet.rows?.[0]?.length || 0);
    const rows = sheet.rows ? sheet.rows.length : 0;
    setColWidths(prev => {
      const next = prev.slice(0, cols);
      while (next.length < cols) next.push(80);
      return next;
    });
    setRowHeights(prev => {
      const next = prev.slice(0, rows);
      while (next.length < rows) next.push(26);
      return next;
    });
  }, [sheet]);

  // Global mouse handlers for drag-resize
  useEffect(() => {
    function handleMouseMove(e) {
      const st = resizeStateRef.current;
      if (!st) return;
      const delta = st.axis === "col" ? e.clientX - st.startPos : e.clientY - st.startPos;
      const next = Math.max(30, st.startSize + delta);
      if (st.axis === "col") {
        setColWidths(prev => {
          const arr = prev.slice();
          arr[st.index] = next;
          return arr;
        });
      } else {
        setRowHeights(prev => {
          const arr = prev.slice();
          arr[st.index] = next;
          return arr;
        });
      }
    }
    function handleMouseUp() {
      resizeStateRef.current = null;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleCopySheet=()=>{
    if(!sheet.rows || sheet.rows.length===0) return;
    const text=sheet.rows.map(row=>row.map(c=>c==null?"":String(c)).join("\t")).join("\n");
    copyText(text).then(ok=>{
      setCopyState(ok?"ok":"err");
      setTimeout(()=>setCopyState("idle"),2000);
    });
  };

  const copyStyles={
    idle:{border:"1.5px solid "+NB,background:"#e8eaf6",color:NB},
    ok:{border:"1.5px solid #1e8c45",background:"#e8f5e9",color:"#1e8c45"},
    err:{border:"1.5px solid #c62828",background:"#ffebee",color:"#c62828"},
  }[copyState]||{border:"1.5px solid "+NB,background:"#e8eaf6",color:NB};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",background:"#E4E9F4",borderBottom:"2px solid "+GRID,flexShrink:0,padding:"0 6px",flexWrap:"wrap",gap:4}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {sheets.map((s,i)=>(
            <button key={i} onClick={()=>onSheetChange(i)} style={{
            padding:"6px 13px",border:"none",cursor:"pointer",whiteSpace:"nowrap",fontSize:11,
            borderTop:i===activeSheet?"2.5px solid "+NB:"2.5px solid transparent",
            borderRight:"1px solid "+GRID, background:i===activeSheet?"#ffffff":"transparent",
            color:i===activeSheet?NB:"#6b7694",fontWeight:i===activeSheet?700:400,
            marginBottom:i===activeSheet?-2:0,transition:"all 0.12s",
            }}>{s.name}</button>
          ))}
        </div>
        <button onClick={handleCopySheet}
          style={{marginLeft:"auto",marginRight:4,padding:"4px 11px",borderRadius:999,fontSize:10,fontWeight:700,cursor:"pointer",
            border:copyStyles.border,background:copyStyles.background,color:copyStyles.color,display:"inline-flex",alignItems:"center",gap:6}}>
          {copyState==="ok"?"✓ Seite kopiert":copyState==="err"?"Manuell markieren":"📋 Seite kopieren"}
        </button>
      </div>
      <div style={{flex:1,overflowX:"auto",overflowY:"auto"}}>
        {sheet.kpis&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat("+Math.min(sheet.kpis.length,8)+",1fr)",borderBottom:"2px solid "+GRID}}>
            {sheet.kpis.map((kpi,i)=>(
              <div key={i} style={{padding:"10px 14px",borderRight:i<sheet.kpis.length-1?"1px solid "+GRID:"none",background:i%2===0?ALT:"#fff"}}>
                <div style={{fontSize:9,fontWeight:700,color:"#6b7694",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{kpi.icon} {kpi.label}</div>
                <div style={{fontSize:15,fontWeight:800,color:NB,fontFamily:"ui-monospace,monospace"}}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:12}}>
          <thead>
            <tr style={{background:"#EEF1F9"}}>
              <th style={{padding:"2px 6px",borderRight:"1px solid "+GRID,borderBottom:"1px solid "+GRID,fontSize:10,color:"#9ca8c4",fontWeight:500,textAlign:"center",minWidth:34,userSelect:"none"}}>#</th>
              {sheet.headers.map((_,i)=>(
                <th
                  key={i}
                  style={{
                    position:"relative",
                    padding:"2px 8px",
                    borderRight:"1px solid "+GRID,
                    borderBottom:"1px solid "+GRID,
                    fontSize:10,
                    color:"#9ca8c4",
                    fontWeight:500,
                    textAlign:"center",
                    userSelect:"none",
                    width:colWidths[i] || 80,
                    minWidth:colWidths[i] || 80,
                  }}
                >
                  {String.fromCharCode(65+i)}
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      resizeStateRef.current = {
                        axis:"col",
                        index:i,
                        startPos:e.clientX,
                        startSize:colWidths[i] || 80,
                      };
                    }}
                    style={{
                      position:"absolute",
                      top:0,
                      right:0,
                      width:6,
                      height:"100%",
                      cursor:"col-resize",
                      zIndex:1,
                    }}
                  />
                </th>
              ))}
            </tr>
            <tr>
              <th style={{padding:"5px 6px",background:NB,borderRight:"1px solid rgba(255,255,255,0.12)",borderBottom:"2px solid "+GRID,fontSize:10,color:"transparent",minWidth:34}}>0</th>
              {sheet.headers.map((h,i)=>(
                <th
                  key={i}
                  style={{
                    padding:"6px 8px",
                    background:NB,
                    color:"#fff",
                    fontWeight:700,
                    fontSize:11,
                    textAlign:i===0?"left":"right",
                    borderRight:"1px solid rgba(255,255,255,0.12)",
                    borderBottom:"2px solid "+GRID,
                    whiteSpace:"nowrap",
                    width:colWidths[i] || 80,
                    minWidth:colWidths[i] || 80,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length===0
              ?<tr><td colSpan={sheet.headers.length+1} style={{padding:14,color:"#b0b8cc",fontStyle:"italic",textAlign:"center",borderBottom:"1px solid "+GRID}}>Keine Daten — SQL ausführen und Ergebnis einfügen</td></tr>
              :sheet.rows.map((row,ri)=>{
                const stripe=ri%2!==0;
                return(
                  <tr key={ri} style={{background:stripe?ALT:"#fff",height:rowHeights[ri] || 26}}>
                    <td
                      style={{
                        position:"relative",
                        padding:"3px 6px",
                        textAlign:"center",
                        fontSize:10,
                        color:"#b0b8cc",
                        borderRight:"1px solid "+GRID,
                        borderBottom:"1px solid "+GRID,
                        background:"#F5F7FC",
                        userSelect:"none",
                        fontFamily:"ui-monospace,monospace",
                        minWidth:34,
                      }}
                    >
                      {ri+1}
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          resizeStateRef.current = {
                            axis:"row",
                            index:ri,
                            startPos:e.clientY,
                            startSize:rowHeights[ri] || 26,
                          };
                        }}
                        style={{
                          position:"absolute",
                          left:0,
                          bottom:0,
                          width:"100%",
                          height:5,
                          cursor:"row-resize",
                          zIndex:1,
                        }}
                      />
                    </td>
                    {row.map((cell,ci)=>{
                      const tone=sheet.colorCol?.[ci]?.(cell);
                      const isN=/^-?[\d\s.,]+[€%]?$/.test(String(cell).trim())&&ci>0;
                      return(
                        <td
                          key={ci}
                          style={{
                            padding:0,
                            textAlign:ci===0?"left":isN?"right":"left",
                            fontFamily:isN?"ui-monospace,monospace":"inherit",
                            fontSize:12,
                            borderRight:"1px solid "+GRID,
                            borderBottom:"1px solid "+GRID,
                            whiteSpace:"nowrap",
                            color:tone==="bad"?"#c62828":tone==="good"?"#1e8c45":"#1a2240",
                            fontWeight:tone?700:ci===0?500:400,
                            background:tone==="bad"?"#fff0f0":tone==="good"?"#f0fdf4":"transparent",
                            width:colWidths[ci] || (ci===0?90:80),
                            minWidth:colWidths[ci] || (ci===0?90:80),
                          }}
                        >
                          <input
                            value={cell ?? ""}
                            onChange={e=>{
                              if(onEditCell){
                                onEditCell(activeSheet, ri, ci, e.target.value);
                              }
                            }}
                            style={{
                              width:"100%",
                              height:"100%",
                              boxSizing:"border-box",
                              border:"none",
                              outline:"none",
                              background:"transparent",
                              padding:"4px 8px",
                              textAlign:ci===0?"left":isN?"right":"left",
                              fontFamily:isN?"ui-monospace,monospace":"inherit",
                              fontSize:12,
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            }
            {sheet.totals&&(
              <tr style={{background:NB}}>
                <td style={{padding:"4px 6px",background:NB,borderRight:"1px solid rgba(255,255,255,0.15)"}}/>
                {sheet.totals.map((v,i)=>(
                  <td key={i} style={{padding:"4px 8px",color:"#fff",fontWeight:800,textAlign:i===0?"left":"right",fontFamily:"ui-monospace,monospace",fontSize:12,borderRight:"1px solid rgba(255,255,255,0.15)"}}>{v}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({tone,children}){
  const s={ok:{bg:"#e8f5e9",color:"#1e8c45",border:"#a5d6a7"},warn:{bg:"#fff3e0",color:"#e65100",border:"#ffcc80"},idle:{bg:"#f1f3f8",color:"#6b7694",border:"#e2e6f0"}}[tone]||{bg:"#f1f3f8",color:"#6b7694",border:"#e2e6f0"};
  return <span style={{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:999,background:s.bg,color:s.color,border:"1px solid "+s.border,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{children}</span>;
}

function Divider({label,color="rgb(4,16,103)"}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"6px 0 2px"}}>
      <div style={{flex:1,height:1,background:"#e2e6f0"}}/>
      <span style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:"0.07em",padding:"3px 10px",borderRadius:999,background:color+"14",border:"1px solid "+color+"22",whiteSpace:"nowrap"}}>{label}</span>
      <div style={{flex:1,height:1,background:"#e2e6f0"}}/>
    </div>
  );
}

function QueryCard({q,sellerKey,value,onChange}){
  const [sqlOpen,setSqlOpen]=useState(false);
  const [copyState,setCopyState]=useState("idle");
  const [pasteState,setPasteState]=useState("idle");
  const taRef=useRef(null);
  const parsed=parsePasted(value);
  const hasData=parsed&&parsed.rows.length>0;
  const sql=q.sql(sellerKey);
  const salesRows = q.key==="sales" ? getSalesRows(value) : null;
  const parityRows = q.key==="parity_daily" ? getParityRows(value) : null;
  const productRows = q.key==="products" ? getProductRows(value) : null;
  const categoryRows = q.key==="categories" ? getCategoryRows(value) : null;
  const dailyOrderRows = q.key==="daily_orders" && parsed ? parsed.rows : null;
  const qualityRows = q.key==="monthly_quality" ? getQualityRows(value) : null;

  const handleCopy=()=>{
    copyText(sql).then(ok=>{setCopyState(ok?"ok":"err");setTimeout(()=>setCopyState("idle"),2500);});
  };
  const handlePaste=async()=>{
    const text=await readClipboard();
    if(text){onChange(text);setPasteState("ok");setTimeout(()=>setPasteState("idle"),2000);}
    else{taRef.current?.focus();setPasteState("denied");setTimeout(()=>setPasteState("idle"),3500);}
  };

  const copyBtn={idle:{border:"1.5px solid rgb(4,16,103)",bg:"#e8eaf6",color:"rgb(4,16,103)"},ok:{border:"1.5px solid #1e8c45",bg:"#e8f5e9",color:"#1e8c45"},err:{border:"1.5px solid #c62828",bg:"#ffebee",color:"#c62828"}};
  const pasteBtn={idle:{border:"1.5px solid #e2e6f0",bg:"#f1f3f8",color:"#6b7694"},ok:{border:"1.5px solid #1e8c45",bg:"#e8f5e9",color:"#1e8c45"},denied:{border:"1.5px solid #e65100",bg:"#fff3e0",color:"#e65100"}};
  const cb=copyBtn[copyState]||copyBtn.idle;
  const pb=pasteBtn[pasteState]||pasteBtn.idle;
  const exampleText=EXAMPLE_PASTES[q.key];

  return(
    <div style={{borderRadius:12,overflow:"hidden",border:"1.5px solid "+(hasData?"#a5d6a7":"#e2e6f0"),background:"#fff",boxShadow:"0 2px 16px rgba(4,16,103,0.07)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:hasData?"#f0fdf4":"#f8f9fb",borderBottom:"1px solid "+(hasData?"#c8e6c9":"#e2e6f0")}}>
        <div style={{width:32,height:32,borderRadius:8,background:q.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,border:"1px solid "+q.color+"22",flexShrink:0}}>{q.icon}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1a2240"}}>{q.label}</div>
          <div style={{fontSize:11,color:"#6b7694",marginTop:1}}>{q.hint}</div>
        </div>
        {hasData?<StatusBadge tone="ok">✓ {parsed.rows.length} Zeilen</StatusBadge>:<StatusBadge tone="idle">Ausstehend</StatusBadge>}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:12,padding:"10px 14px",borderTop:"1px solid #f1f3f8"}}>
        <div style={{flex:1,minWidth:260}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:"#6b7694",textTransform:"uppercase",letterSpacing:"0.05em"}}>① SQL kopieren</span>
            <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
              <button onClick={()=>setSqlOpen(v=>!v)} style={{padding:"4px 10px",borderRadius:999,fontSize:10,fontWeight:600,cursor:"pointer",border:"1px solid #e2e6f0",background:"#fff",color:"#6b7694"}}>
                {sqlOpen?"▲ ausblenden":"▼ anzeigen"}
              </button>
              <button onClick={handleCopy} style={{padding:"4px 13px",borderRadius:999,fontSize:11,fontWeight:700,cursor:"pointer",border:cb.border,background:cb.bg,color:cb.color,transition:"all 0.15s"}}>
                {copyState==="ok"?"✓ Kopiert":copyState==="err"?"Manuell kopieren ↓":"SQL kopieren"}
              </button>
            </div>
          </div>
          <pre onClick={e=>{const r=document.createRange();r.selectNodeContents(e.currentTarget);window.getSelection().removeAllRanges();window.getSelection().addRange(r);}}
            style={{margin:0,padding:"7px 10px",background:"#0d1117",borderRadius:8,fontSize:9.5,color:"#8b949e",overflowX:"auto",maxHeight:sqlOpen?300:56,lineHeight:1.6,fontFamily:"ui-monospace,monospace",cursor:"text",userSelect:"text",transition:"max-height 0.2s",overflow:"hidden"}}>
            {sql}
          </pre>
          <p style={{margin:"4px 0 0",fontSize:9.5,color:"#b0b8cc"}}>Klick auf Code → alles markiert. Dann Strg+C zum Kopieren.</p>
        </div>
        <div style={{flex:1,minWidth:260}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:"#6b7694",textTransform:"uppercase",letterSpacing:"0.05em"}}>② Ergebnis einfügen</span>
            <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
              {exampleText&&(
                <button onClick={()=>{onChange(exampleText);setPasteState("ok");setTimeout(()=>setPasteState("idle"),2000);}}
                  style={{padding:"4px 10px",borderRadius:999,fontSize:10,fontWeight:600,cursor:"pointer",border:"1px solid #e2e6f0",background:"#fff",color:"#0369a1"}}>
                  Beispiel einfügen
                </button>
              )}
              <button onClick={handlePaste} style={{padding:"4px 13px",borderRadius:999,fontSize:11,fontWeight:700,cursor:"pointer",border:pb.border,background:pb.bg,color:pb.color,transition:"all 0.15s"}}>
                {pasteState==="ok"?"✓ Eingefügt":pasteState==="denied"?"Strg+V im Feld unten":"📋 Einfügen"}
              </button>
              {value&&(
                <button onClick={()=>{onChange("");setPasteState("idle");}} style={{padding:"4px 10px",borderRadius:999,fontSize:10,fontWeight:600,cursor:"pointer",border:"1px solid #e2e6f0",background:"#fff",color:"#6b7694"}}>✕</button>
              )}
            </div>
          </div>
          <textarea ref={taRef} value={value} onChange={e=>onChange(e.target.value)}
            placeholder={"BI-Tool: Strg+A → Strg+C → dann hier Strg+V\noder Schaltfläche '📋 Einfügen' oben klicken"}
            style={{width:"100%",height:hasData?56:76,padding:"7px 10px",borderRadius:8,border:"1.5px solid "+(hasData?"#a5d6a7":"#e2e6f0"),fontSize:10.5,fontFamily:"ui-monospace,monospace",resize:"vertical",outline:"none",boxSizing:"border-box",background:hasData?"#f0fdf4":"#fff",color:"#1a2240",lineHeight:1.5,transition:"border-color 0.2s"}}/>
          {hasData&&<p style={{margin:"3px 0 4px",fontSize:10,color:"#6b7694"}}>Spalten: {parsed.headers.slice(0,6).join(", ")}{parsed.headers.length>6?"…":""}</p>}
          {/* Mini preview: Monatsumsatz */}
          {salesRows && salesRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Monatsumsatz (erste {Math.min(salesRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["monat","anzahl_bestellungen","umsatz_eur","avg_order_value_eur"];
                      const tsv = rowsToTsvForExcel(headers, salesRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["monat","anzahl_bestellungen","umsatz_eur","avg_order_value_eur"];
                      const csv = rowsToCsv(headers, salesRows);
                      downloadCsv(`${sellerKey || "shop"}_monatsumsatz.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>monat</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>anzahl_bestellungen</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>umsatz_eur</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>average order value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesRows.slice(0,12).map((r,idx)=>(
                      <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{r.monat}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.anzahl_bestellungen}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.umsatz_eur}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.avg_order_value_eur}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Mini preview: Preisparität (täglich) */}
          {parityRows && parityRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Parität (erste {Math.min(parityRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["day","number_offers","pct_meta","pct_amazon","pct_otto"];
                      const tsv = rowsToTsvForExcel(headers, parityRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["day","number_offers","pct_meta","pct_amazon","pct_otto"];
                      const csv = rowsToCsv(headers, parityRows);
                      downloadCsv(`${sellerKey || "shop"}_preisparitaet_daily.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>day</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>number_offers</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>pct_meta</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>pct_amazon</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>pct_otto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parityRows.slice(0,12).map((r,idx)=>{
                      const day = r.day || r.Datum || Object.values(r)[0] || "";
                      const offers = r.number_offers || r.Angebote || Object.values(r)[1] || "";
                      const pctMeta = r.percentage_marketplace_expensive_meta || r["Meta (%)"] || Object.values(r)[2] || "";
                      const pctAmz = r.percentage_marketplace_expensive_amazon || r["Amazon (%)"] || Object.values(r)[3] || "";
                      const pctOtto = r.percentage_marketplace_expensive_otto || r["OTTO (%)"] || Object.values(r)[4] || "";
                      return (
                        <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{day}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{offers}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{pctMeta}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{pctAmz}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{pctOtto}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Mini preview: Top Produkte */}
          {productRows && productRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Top Produkte (erste {Math.min(productRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["csin","titel","positionen","stueck","umsatz"];
                      const tsv = rowsToTsvForExcel(headers, productRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["csin","titel","positionen","stueck","umsatz"];
                      const csv = rowsToCsv(headers, productRows);
                      downloadCsv(`${sellerKey || "shop"}_top_produkte.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>csin</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>titel</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>stueck</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>umsatz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.slice(0,12).map((r,idx)=>(
                      <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{r.csin}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{r.titel}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.stueck}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.umsatz}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Mini preview: Top Kategorien */}
          {categoryRows && categoryRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Top Kategorien (erste {Math.min(categoryRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["kategorie","umsatz","teilbestellungen"];
                      const tsv = rowsToTsvForExcel(headers, categoryRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["kategorie","umsatz","teilbestellungen"];
                      const csv = rowsToCsv(headers, categoryRows);
                      downloadCsv(`${sellerKey || "shop"}_top_kategorien.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>kategorie</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>umsatz</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>teilbestellungen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryRows.slice(0,12).map((r,idx)=>{
                      const kat = r.kategorie || r.Kategorie || Object.values(r)[0] || "";
                      const rev = r.umsatz || r.revenue || Object.values(r)[1] || "";
                      const teil = r.teilbestellungen || r.Bestellungen || Object.values(r)[2] || "";
                      return (
                        <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{kat}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{rev}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{teil}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Mini preview: Bestelldetails */}
          {dailyOrderRows && dailyOrderRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Bestelldetails (erste {Math.min(dailyOrderRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = parsed?.headers && parsed.headers.length
                        ? parsed.headers
                        : Object.keys(dailyOrderRows[0] || {});
                      const tsv = rowsToTsvForExcel(headers, dailyOrderRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = parsed?.headers && parsed.headers.length
                        ? parsed.headers
                        : Object.keys(dailyOrderRows[0] || {});
                      const csv = rowsToCsv(headers, dailyOrderRows);
                      downloadCsv(`${sellerKey || "shop"}_bestelldetails.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>order_created_at</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>csin</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>order_number</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>titel</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>gesamtpreis_eur</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>status / reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyOrderRows.slice(0,12).map((r,idx)=>{
                      const created = r.order_created_at || Object.values(r)[0] || "";
                      const csin = r.csin || Object.values(r)[1] || "";
                      const ordNum = r.order_number || Object.values(r)[2] || "";
                      const titel = r.titel || r.title || Object.values(r)[3] || "";
                      const price = r.gesamtpreis_eur || r.total_price_eur || Object.values(r)[6] || "";
                      const status = r.status_order_shop || "";
                      const reason = r.canceled_reason_key || "";
                      return (
                        <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{created}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{csin}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{ordNum}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{titel}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{price}</td>
                          <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{status}{reason?` / ${reason}`:""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Mini preview: Monatliche Storno/Retouren/Verzug */}
          {qualityRows && qualityRows.length>0 && (
            <div style={{marginTop:4,border:"1px solid #e2e6f0",borderRadius:6,overflow:"hidden"}}>
              <div style={{background:"#f1f3f8",padding:"4px 8px",fontSize:10,fontWeight:600,color:"#4b5563",display:"flex",alignItems:"center",gap:8}}>
                <span>Vorschau Qualitätskennzahlen (erste {Math.min(qualityRows.length,12)} Zeilen)</span>
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["jahr_monat","bestellpositionen","umsatz","shopstornoquote","retourenquote","shopverzugsquote"];
                      const tsv = rowsToTsvForExcel(headers, qualityRows);
                      copyText(tsv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#0369a1"}}
                  >
                    CSV kopieren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ["jahr_monat","bestellpositionen","umsatz","shopstornoquote","retourenquote","shopverzugsquote"];
                      const csv = rowsToCsv(headers, qualityRows);
                      downloadCsv(`${sellerKey || "shop"}_qualitaetskennzahlen.csv`, csv);
                    }}
                    style={{padding:"3px 8px",borderRadius:999,border:"1px solid #e2e6f0",background:"#ffffff",fontSize:9,fontWeight:600,cursor:"pointer",color:"#1a2240"}}
                  >
                    CSV herunterladen
                  </button>
                </div>
              </div>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:10.5}}>
                  <thead>
                    <tr style={{background:"#eef1f9"}}>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"left"}}>Jahr_Monat</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>Bestellpositionen</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>Umsatz</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>Shopstornoquote</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",borderRight:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>Retourenquote</th>
                      <th style={{padding:"4px 6px",borderBottom:"1px solid #e2e6f0",fontWeight:600,textAlign:"right"}}>Shopverzugsquote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualityRows.slice(0,12).map((r,idx)=>(
                      <tr key={idx} style={{background:idx%2===0?"#ffffff":"#f9fafb"}}>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace"}}>{r.jahr_monat}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.bestellpositionen}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.umsatz}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.shopstornoquote}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",borderRight:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.retourenquote}</td>
                        <td style={{padding:"3px 6px",borderBottom:"1px solid #f1f3f8",fontFamily:"ui-monospace,monospace",textAlign:"right"}}>{r.shopverzugsquote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function ShopPerformanceTool(){
  const [sellerKey,setSellerKey]=useState("");
  const [shopName,setShopName]=useState("");
  const [pasted,setPasted]=useState(()=>Object.fromEntries(QUERIES.map(q=>[q.key,""])));
  const [activeSheet,setActiveSheet]=useState(0);
  const [previewSheets,setPreviewSheets]=useState([]);
  const [isDownloading,setIsDownloading]=useState(false);
  const [downloadError,setDownloadError]=useState("");

  // Update preview whenever pasted data or shopName changes
  useEffect(()=>{
    try {
      const sheets = buildPreviewSheetsDataOnly(
        shopName || sellerKey || "Shop",
        (sellerKey || "").trim(),
        pasted
      );
      setPreviewSheets(sheets);
    } catch(e) { console.error("Preview error:", e); }
  }, [pasted, shopName, sellerKey]);

  const perfReady=QUERIES.filter(q=>parsePasted(pasted[q.key])).length;
  const effectiveSellerKey=(sellerKey||"").trim();

  const handleDownloadExcel = async () => {
    if (isDownloading) return;
    setDownloadError("");
    setIsDownloading(true);
    try {
      const XLSXmod = await import("xlsx");
      const XLSX = XLSXmod.default || XLSXmod;
      const wb = await buildDataWorkbook(
        XLSX,
        shopName || sellerKey || "Shop",
        effectiveSellerKey,
        pasted
      );
      const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const baseName = (shopName || effectiveSellerKey || "shop_performance")
        .replace(/[^a-z0-9_\-]+/gi,"_")
        .replace(/_+/g,"_")
        .replace(/^_+|_+$/g,"");
      a.href = url;
      a.download = `${baseName || "shop_performance"}_performance.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Excel download error:", e);
      setDownloadError("Excel konnte nicht erstellt werden. Bitte versuch es erneut.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleEditCell=(sheetIndex,rowIndex,colIndex,value)=>{
    setPreviewSheets(prev=>{
      if(!prev.length) return prev;
      return prev.map((s,i)=>{
        if(i!==sheetIndex) return s;
        const newRows=s.rows.map((row,ri)=>{
          if(ri!==rowIndex) return row;
          const nr=row.slice();
          nr[colIndex]=value;
          return nr;
        });
        return {...s,rows:newRows};
      });
    });
  };

  const inp={width:"100%",padding:"9px 12px",borderRadius:10,border:"1.5px solid #e2e6f0",fontSize:13,outline:"none",boxSizing:"border-box",color:"#1a2240",background:"#fff",fontFamily:"inherit"};
  const NB="rgb(4,16,103)";

  return(
    <div style={{maxWidth:1080,margin:"0 auto",padding:"22px 18px",fontFamily:"ui-sans-serif,system-ui",boxSizing:"border-box",background:"#f8f9fb",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:14,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <div style={{width:36,height:36,borderRadius:9,background:NB,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <div>
            <h1 style={{margin:0,fontSize:19,fontWeight:800,color:"#1a2240",letterSpacing:"-0.02em"}}>Shop Performance</h1>
            <p style={{margin:0,fontSize:12,color:"#6b7694"}}>SQL kopieren → Ergebnis einfügen → Excel-Sheet kopieren & in Vorlage einfügen</p>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}/>
      </div>

      {/* Config */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:13,padding:"13px 16px",borderRadius:12,background:"#fff",boxShadow:"0 2px 16px rgba(4,16,103,0.08)",marginBottom:14,alignItems:"end"}}>
        <div><label style={{display:"block",fontSize:10,fontWeight:700,color:"#6b7694",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>Seller Key</label>
          <input value={sellerKey} onChange={e=>{setSellerKey(e.target.value);}} placeholder="z.B. mygardenhome" style={inp}/></div>
        <div><label style={{display:"block",fontSize:10,fontWeight:700,color:"#6b7694",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>Shop Name (Excel-Titel)</label>
          <input value={shopName} onChange={e=>setShopName(e.target.value)} placeholder="z.B. Mygardenhome" style={inp}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:5,paddingBottom:2}}>
          <StatusBadge tone={perfReady===0?"idle":perfReady===QUERIES.length?"ok":"warn"}>{perfReady}/{QUERIES.length} Queries</StatusBadge>
          
        </div>
      </div>

      {/* Query cards */}
      <div style={{display:"grid",gap:9,marginBottom:14}}>
        <Divider label="📊 Daten einfügen" color={NB}/>
        {QUERIES.map(q=>(
          <QueryCard key={q.key} q={q} sellerKey={effectiveSellerKey} value={pasted[q.key]}
            onChange={text=>{setPasted(p=>({...p,[q.key]:text}));}}/>
        ))}
      </div>

      {/* Preview */}
      {previewSheets.length>0&&(
        <div style={{borderRadius:12,overflow:"hidden",border:"1.5px solid #e2e6f0",background:"#fff",boxShadow:"0 2px 16px rgba(4,16,103,0.08)",marginBottom:14,height:420}}>
          <ExcelPreview sheets={previewSheets} activeSheet={activeSheet} onSheetChange={setActiveSheet} onEditCell={handleEditCell}/>
        </div>
      )}

      {/* Excel download */}
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10}}>
        {downloadError && (
          <span style={{fontSize:11,color:"#c62828"}}>
            {downloadError}
          </span>
        )}
        <button
          onClick={handleDownloadExcel}
          disabled={isDownloading || perfReady===0}
          style={{
            padding:"8px 16px",
            borderRadius:999,
            fontSize:12,
            fontWeight:800,
            border:"none",
            cursor:(isDownloading || perfReady===0)?"default":"pointer",
            opacity:(isDownloading || perfReady===0)?0.6:1,
            background:NB,
            color:"#ffffff",
            display:"inline-flex",
            alignItems:"center",
            gap:8,
            boxShadow:"0 2px 10px rgba(4,16,103,0.35)",
          }}
        >
          {isDownloading ? "Excel wird erstellt…" : "Excel herunterladen"}
        </button>
      </div>
    </div>
  );
}

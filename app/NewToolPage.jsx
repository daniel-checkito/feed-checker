import React, { useMemo, useState } from "react";

const QUERY1_TEMPLATE = `SELECT *
FROM bi.price_parity_statistics_shop_monthly pss
WHERE pss.seller_key = '[seller_key]'
#WHERE pss.percentage_marketplace_expensive_meta > '10' AND day ='2024-10-25'
#ORDER BY pss.day desc
#WHERE pss.percentage_marketplace_expensive_meta > '10'
#WHERE pss.month = '10' AND pss.\`year\`= '2025'
#WHERE DAY = '2025-10-15';`;

const QUERY2_TEMPLATE = `SELECT
    p.csin,
    pa.value AS titel,
    COUNT(*) AS positionen,
    SUM(co.order_count) AS stueck,
    SUM((co.total_price + co.shipping_costs) / 100) AS umsatz
FROM bi.customer_order_position_anonymized co
JOIN main.product p
    ON p.product_increment_id = co.product_increment_id
LEFT JOIN main.product_attribute pa
    ON pa.csin = p.csin AND pa.attribute_type_id = 1
WHERE co.status_order_shop IN ('sent', 'in_progress')
  AND co.seller_key = '[seller_key]'
  AND co.order_created_at >= '2025-01-01'
  AND co.order_created_at <  '2026-01-01'
GROUP BY p.csin, pa.value
ORDER BY positionen DESC
LIMIT 100;`;

const QUERY3_TEMPLATE = `SELECT
    DATE_TRUNC('month', co.order_created_at)::date AS monat,
    COUNT(DISTINCT co.order_id) AS anzahl_bestellungen,
    SUM((co.total_price + co.shipping_costs) / 100) AS umsatz_eur,
    ROUND(
      SUM((co.total_price + co.shipping_costs) / 100) / NULLIF(COUNT(DISTINCT co.order_id), 0),
      2
    ) AS avg_order_value_eur
FROM bi.customer_order_position_anonymized co
WHERE co.status_order_shop IN ('sent', 'in_progress')
  AND co.seller_key = '[seller_key]'
  AND co.order_created_at >= '2025-01-01'
  AND co.order_created_at <  '2026-01-01'
GROUP BY DATE_TRUNC('month', co.order_created_at)
ORDER BY monat;`;

function detectDelimiter(line) {
  if (!line) return ",";
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function parseCsv(text) {
  if (!text || !text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return null;
  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  const headers = headerLine.split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(delimiter);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] !== undefined ? cols[idx] : "";
    });
    return row;
  });
  return { headers, rows };
}

export default function NewToolPage() {
  const [sellerKey, setSellerKey] = useState("");
  const [csvParityText, setCsvParityText] = useState("");
  const [csvTopProductsText, setCsvTopProductsText] = useState("");
  const [csvSalesText, setCsvSalesText] = useState("");
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeDashboardPage, setActiveDashboardPage] = useState("page1");
  const [copyStatus, setCopyStatus] = useState("");

  const query1 = useMemo(() => {
    const key = sellerKey && sellerKey.trim() ? sellerKey.trim() : "[seller_key]";
    return QUERY1_TEMPLATE.replace("[seller_key]", key);
  }, [sellerKey]);

  const query2 = useMemo(() => {
    const key = sellerKey && sellerKey.trim() ? sellerKey.trim() : "[seller_key]";
    return QUERY2_TEMPLATE.replace("[seller_key]", key);
  }, [sellerKey]);

  const query3 = useMemo(() => {
    const key = sellerKey && sellerKey.trim() ? sellerKey.trim() : "[seller_key]";
    return QUERY3_TEMPLATE.replace("[seller_key]", key);
  }, [sellerKey]);

  const csvData = useMemo(() => parseCsv(csvParityText), [csvParityText]);

  const paritySummary = useMemo(() => {
    if (!csvData) return null;
    const { headers, rows } = csvData;
    if (!rows.length) return null;

    const lowerHeaders = headers.map((h) => h.toLowerCase());
    const numberOffersIdx = lowerHeaders.indexOf("number_offers");
    const dayIdx = lowerHeaders.indexOf("day");

    const result = {
      rowCount: rows.length,
      numberOffersFound: numberOffersIdx !== -1,
      numberOffersStats: null,
      daySpan: null,
    };

    if (numberOffersIdx !== -1) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;

      rows.forEach((r) => {
        const raw = Object.values(r)[numberOffersIdx];
        const n = Number(String(raw).replace(",", "."));
        if (!Number.isNaN(n)) {
          if (n < min) min = n;
          if (n > max) max = n;
          sum += n;
          count += 1;
        }
      });

      if (count > 0) {
        result.numberOffersStats = {
          min,
          max,
          avg: sum / count,
          count,
        };
      }
    }

    if (dayIdx !== -1) {
      const days = rows
        .map((r) => {
          const v = Object.values(r)[dayIdx];
          return String(v || "").trim();
        })
        .filter(Boolean);
      if (days.length) {
        const unique = Array.from(new Set(days)).sort();
        result.daySpan = {
          first: unique[0],
          last: unique[unique.length - 1],
          distinct: unique.length,
        };
      }
    }

    return result;
  }, [csvData]);

  const exampleMonthlyRows = [
    {
      year: 2024,
      month: "01",
      revenueThisYear: 120000,
      revenueLastYear: 95000,
      revenueYoY: 26.3,
      orders: 3200,
      avgOrderValue: 37.5,
      cancelPct: 2.1,
      returnPct: 4.5,
      trackingLinkPct: 96.2,
      repricedPct: 68.4,
      campaignPct: 12.3,
      offers: 1800,
      cheapestC24: 52.1,
      cheapestAmazon: 28.4,
      cheapestOtto: 11.5,
      cheapestMeta: 8.0,
      topProduct: "Elektrorasierer X100",
      topCategory: "Haushaltsgeraete",
    },
    {
      year: 2024,
      month: "02",
      revenueThisYear: 98000,
      revenueLastYear: 91000,
      revenueYoY: 7.7,
      orders: 2900,
      avgOrderValue: 33.8,
      cancelPct: 2.4,
      returnPct: 4.1,
      trackingLinkPct: 95.8,
      repricedPct: 70.2,
      campaignPct: 10.5,
      offers: 1820,
      cheapestC24: 49.3,
      cheapestAmazon: 30.1,
      cheapestOtto: 12.0,
      cheapestMeta: 8.6,
      topProduct: "Kaffeemaschine Pro 500",
      topCategory: "Kuechengeraete",
    },
    {
      year: 2024,
      month: "03",
      revenueThisYear: 132500,
      revenueLastYear: 101000,
      revenueYoY: 31.2,
      orders: 3500,
      avgOrderValue: 37.9,
      cancelPct: 1.9,
      returnPct: 4.0,
      trackingLinkPct: 96.8,
      repricedPct: 72.0,
      campaignPct: 15.2,
      offers: 1870,
      cheapestC24: 53.4,
      cheapestAmazon: 26.7,
      cheapestOtto: 11.1,
      cheapestMeta: 8.8,
      topProduct: "Smartphone Alpha 256GB",
      topCategory: "Smartphones",
    },
    {
      year: 2024,
      month: "04",
      revenueThisYear: 110200,
      revenueLastYear: 105000,
      revenueYoY: 4.9,
      orders: 3050,
      avgOrderValue: 36.1,
      cancelPct: 2.0,
      returnPct: 4.3,
      trackingLinkPct: 95.9,
      repricedPct: 69.7,
      campaignPct: 9.8,
      offers: 1900,
      cheapestC24: 50.8,
      cheapestAmazon: 29.6,
      cheapestOtto: 10.9,
      cheapestMeta: 8.7,
      topProduct: "Gaming Headset Ultra",
      topCategory: "Zubehoer",
    },
  ];

  const exampleTopProductsYear = [
    {
      name: "Smartphone Alpha 256GB",
      views: 48500,
      revenueLastYear: 185000,
      revenueSharePct: 18.5,
    },
    {
      name: "Elektrorasierer X100",
      views: 32000,
      revenueLastYear: 96000,
      revenueSharePct: 9.6,
    },
    {
      name: "Kaffeemaschine Pro 500",
      views: 27500,
      revenueLastYear: 84500,
      revenueSharePct: 8.5,
    },
    {
      name: "Gaming Headset Ultra",
      views: 21000,
      revenueLastYear: 61000,
      revenueSharePct: 6.1,
    },
    {
      name: "4K Fernseher Vision 55\"",
      views: 19500,
      revenueLastYear: 58000,
      revenueSharePct: 5.8,
    },
  ];

  const exampleTopCategoriesYear = [
    {
      name: "Smartphones",
      revenueLastYear: 420000,
      revenueSharePct: 42.0,
    },
    {
      name: "Kuechengeraete",
      revenueLastYear: 210000,
      revenueSharePct: 21.0,
    },
    {
      name: "Haushaltsgeraete",
      revenueLastYear: 135000,
      revenueSharePct: 13.5,
    },
    {
      name: "TV & Heimkino",
      revenueLastYear: 98000,
      revenueSharePct: 9.8,
    },
    {
      name: "Zubehoer",
      revenueLastYear: 72000,
      revenueSharePct: 7.2,
    },
  ];

  // Zeilen fuer die visuelle Darstellung von Seite 2 als eine grosse Tabelle (wie Excel-Sheet)
  const page2GridRows = [];

  // Block 1: Monats-KPIs (Qualitaet & Parity)
  page2GridRows.push([
    "Row",
    "Jahr",
    "Monat",
    "Storno_Prozent",
    "Retouren_Prozent",
    "Tracking_Link_Prozent",
    "Repriced_Bestellungen_Prozent",
    "Kampagnen_Deal_Bestellungen_Prozent",
    "Pct_CHECK24_am_billigsten",
    "Pct_Amazon_am_billigsten",
    "Pct_Otto_am_billigsten",
    "Pct_Meta_am_billigsten",
  ]);
  exampleMonthlyRows.forEach((row, idx) => {
    page2GridRows.push([
      String(idx + 1),
      row.year,
      row.month,
      row.cancelPct,
      row.returnPct,
      row.trackingLinkPct,
      row.repricedPct,
      row.campaignPct,
      row.cheapestC24,
      row.cheapestAmazon,
      row.cheapestOtto,
      row.cheapestMeta,
    ]);
  });

  // Leerzeile
  page2GridRows.push([]);

  // Block 2: Price Parity
  page2GridRows.push([
    "Row",
    "Jahr",
    "Monat",
    "Pct_CHECK24_am_billigsten",
    "Pct_Amazon_am_billigsten",
    "Pct_Otto_am_billigsten",
    "Pct_Meta_am_billigsten",
  ]);
  exampleMonthlyRows.forEach((row, idx) => {
    page2GridRows.push([
      String(idx + 1),
      row.year,
      row.month,
      row.cheapestC24,
      row.cheapestAmazon,
      row.cheapestOtto,
      row.cheapestMeta,
    ]);
  });

  // Leerzeile
  page2GridRows.push([]);

  // Block 3: Top Produkte
  page2GridRows.push([
    "Rank",
    "Produkt",
    "Views",
    "Umsatz_letztes_Jahr_EUR",
    "Anteil_Store_Umsatz_Prozent",
  ]);
  exampleTopProductsYear.forEach((p, idx) => {
    page2GridRows.push([
      String(idx + 1),
      p.name,
      String(p.views),
      String(p.revenueLastYear),
      String(p.revenueSharePct),
    ]);
  });

  // Leerzeile
  page2GridRows.push([]);

  // Block 4: Top Kategorien
  page2GridRows.push([
    "Rank",
    "Kategorie",
    "Umsatz_letztes_Jahr_EUR",
    "Anteil_Store_Umsatz_Prozent",
  ]);
  exampleTopCategoriesYear.forEach((c, idx) => {
    page2GridRows.push([
      "Top_Kategorien",
      String(idx + 1),
      c.name,
      String(c.revenueLastYear),
      String(c.revenueSharePct),
    ]);
  });

  function setCopyFeedback(kind) {
    setCopyStatus(kind);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setCopyStatus((prev) => (prev === kind ? "" : prev));
      }, 2000);
    }
  }

  function handleCopyDashboardPage1() {
    const headers = [
      "Row",
      "Jahr",
      "Monat",
      "Umsatz_dieses_Jahr_EUR",
      "Umsatz_letztes_Jahr_EUR",
      "Umsatz_YoY_Prozent",
      "Anzahl_Bestellungen",
      "Durchschnittlicher_Bestellwert_EUR",
      "Anzahl_Angebote_Listings",
    ];

    const lines = [headers.join("\t")];
    exampleMonthlyRows.forEach((row, idx) => {
      const excelRow = idx + 2; // Header ist Zeile 1 in Excel
      const yoyFormula = `=(D${excelRow}-E${excelRow})/E${excelRow}`;
      lines.push(
        [
          String(idx + 1),
          row.year,
          row.month,
          row.revenueThisYear,
          row.revenueLastYear,
          yoyFormula,
          row.orders,
          row.avgOrderValue,
          row.offers,
        ].join("\t")
      );
    });

    const text = lines.join("\n");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopyFeedback("page1"))
        .catch(() => {});
    } else {
      alert("Konnte Seite 1 nicht automatisch kopieren. Bitte Tabelle manuell markieren und kopieren.");
    }
  }

  function handleCopyDashboardPage2() {
    const lines = [];

    // Block 1: Monats-KPIs (Qualitaet & Parity) – eine Tabelle
    lines.push(
      [
        "Row",
        "Jahr",
        "Monat",
        "Storno_Prozent",
        "Retouren_Prozent",
        "Tracking_Link_Prozent",
        "Repriced_Bestellungen_Prozent",
        "Kampagnen_Deal_Bestellungen_Prozent",
        "Pct_CHECK24_am_billigsten",
        "Pct_Amazon_am_billigsten",
        "Pct_Otto_am_billigsten",
        "Pct_Meta_am_billigsten",
      ].join("\t")
    );
    exampleMonthlyRows.forEach((row, idx) => {
      lines.push(
        [
          String(idx + 1),
          row.year,
          row.month,
          row.cancelPct,
          row.returnPct,
          row.trackingLinkPct,
          row.repricedPct,
          row.campaignPct,
          row.cheapestC24,
          row.cheapestAmazon,
          row.cheapestOtto,
          row.cheapestMeta,
        ].join("\t")
      );
    });

    // Leerzeile als Abstand
    lines.push("");

    // Block 2: Price Parity – eigene Tabelle (gleiche Monatsdaten, nur sauber separiert)
    lines.push(
      [
        "Row",
        "Jahr",
        "Monat",
        "Pct_CHECK24_am_billigsten",
        "Pct_Amazon_am_billigsten",
        "Pct_Otto_am_billigsten",
        "Pct_Meta_am_billigsten",
      ].join("\t")
    );
    exampleMonthlyRows.forEach((row, idx) => {
      lines.push(
        [
          String(idx + 1),
          row.year,
          row.month,
          row.cheapestC24,
          row.cheapestAmazon,
          row.cheapestOtto,
          row.cheapestMeta,
        ].join("\t")
      );
    });

    // Leerzeile als Abstand
    lines.push("");

    // Block 3: Top Produkte – Jahres-Umsatz & Anteil
    lines.push(
      [
        "Rank",
        "Produkt",
        "Views",
        "Umsatz_letztes_Jahr_EUR",
        "Anteil_Store_Umsatz_Prozent",
      ].join("\t")
    );
    exampleTopProductsYear.forEach((p, idx) => {
      lines.push(
        [
          String(idx + 1),
          p.name,
          String(p.views),
          String(p.revenueLastYear),
          String(p.revenueSharePct),
        ].join("\t")
      );
    });

    // Leerzeile als Abstand
    lines.push("");

    // Block 4: Top Kategorien – Jahres-Umsatz & Anteil
    lines.push(
      ["Rank", "Kategorie", "Umsatz_letztes_Jahr_EUR", "Anteil_Store_Umsatz_Prozent"].join("\t")
    );
    exampleTopCategoriesYear.forEach((c, idx) => {
      lines.push(
        [String(idx + 1), c.name, String(c.revenueLastYear), String(c.revenueSharePct)].join("\t")
      );
    });

    const text = lines.join("\n");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopyFeedback("page2"))
        .catch(() => {});
    } else {
      alert("Konnte Seite 2 nicht automatisch kopieren. Bitte Tabelle manuell markieren und kopieren.");
    }
  }

  function handleCopyDashboardPage3() {
    // Platzhalter-Seite 3 fuer weitere Analysen / Chart-Daten
    const headers = ["Row"];
    for (let i = 1; i <= 20; i += 1) {
      headers.push(`Extra_Col_${i}`);
    }

    const lines = [headers.join("\t")];
    for (let r = 0; r < 20; r += 1) {
      const row = [String(r + 1)];
      for (let c = 1; c <= 20; c += 1) {
        row.push("");
      }
      lines.push(row.join("\t"));
    }

    const text = lines.join("\n");
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopyFeedback("page3"))
        .catch(() => {});
    } else {
      alert("Konnte Seite 3 nicht automatisch kopieren. Bitte Tabelle manuell markieren und kopieren.");
    }
  }

  function handleCopyQuery(q) {
    if (!q) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(q)
        .then(() => {
          if (q === query1) setCopyFeedback("query1");
          else if (q === query2) setCopyFeedback("query2");
          else if (q === query3) setCopyFeedback("query3");
        })
        .catch(() => {});
    } else {
      // Fallback: simple alert so the user can select manually
      alert("Konnte nicht automatisch kopieren. Bitte Text manuell markieren und kopieren.");
    }
  }

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Shop Performance</div>
      <div style={{ marginTop: 6, fontSize: 13, color: "#6B7280", lineHeight: "18px" }}>
        Schritt 1: Seller Key eingeben. Schritt 2–4: Kurz die vorbereiteten Queries ausfuehren und die Ergebnisse in die
        kleinen Felder einfuegen. Das Dashboard fasst alles zusammen und kann nach Excel kopiert werden.
      </div>

      {/* Seller Key Input */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>1. Seller Key eingeben</div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>
          Dieser Wert wird in den SQL-Queries anstelle von <code>[seller_key]</code> verwendet.
        </div>
        <input
          value={sellerKey}
          onChange={(e) => setSellerKey(e.target.value)}
          placeholder="z B SELLER_12345"
          style={{
            marginTop: 4,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #D1D5DB",
            fontSize: 13,
            width: "100%",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Query Sales – Monatsumsatz & Bestellungen */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
          2. Umsatz & Bestellungen – Ergebnisse einfuegen
        </div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>
          Query fuer Monatsumsatz und Bestellungen wird ueber den Button kopiert. Im DWH ausfuehren und Ergebnis kurz
          einfügen.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => handleCopyQuery(query3)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #D1D5DB",
              background: "#F9FAFB",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            SQL kopieren
          </button>
          <div style={{ fontSize: 11, color: "#6B7280" }}>
            Nur ausfuehren und Ergebnis in das Feld rechts kopieren.
          </div>
          {copyStatus === "query3" ? (
            <div style={{ fontSize: 11, color: "#059669" }}>SQL kopiert ✅</div>
          ) : null}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "#111827" }}>
          Ergebnis einfuegen {csvSalesText.trim() ? "✅" : ""}
        </div>
        <textarea
          value={csvSalesText}
          onChange={(e) => setCsvSalesText(e.target.value)}
          placeholder="Ergebnis aus der Umsatz-/Bestell-Query hier einfuegen..."
          style={{
            width: "100%",
            minHeight: 90,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 11,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            boxSizing: "border-box",
            whiteSpace: "pre",
          }}
        />
      </div>

      {/* Query 1 + CSV Ergebnis */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>3. Price Parity – Ergebnisse einfuegen</div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>
          Query fuer Price-Parity wird ueber den Button kopiert, im DWH ausfuehren und Ergebnis kurz hier einfuegen.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => handleCopyQuery(query1)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #D1D5DB",
              background: "#F9FAFB",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            SQL kopieren
          </button>
          <div style={{ fontSize: 11, color: "#6B7280" }}>
            Nur ausfuehren und Ergebnis in das Feld rechts kopieren.
          </div>
          {copyStatus === "query1" ? (
            <div style={{ fontSize: 11, color: "#059669" }}>SQL kopiert ✅</div>
          ) : null}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "#111827" }}>
          Ergebnis einfuegen {csvParityText.trim() ? "✅" : ""}
        </div>
        <textarea
          value={csvParityText}
          onChange={(e) => setCsvParityText(e.target.value)}
          placeholder="Ergebnis aus Price-Parity-Query hier einfuegen..."
          style={{
            width: "100%",
            minHeight: 90,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 11,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            boxSizing: "border-box",
            whiteSpace: "pre",
          }}
        />

        {paritySummary ? (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #D1FAE5",
              background: "#ECFDF5",
              fontSize: 12,
              color: "#065F46",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Schnelle Auswertung (number_offers)</div>
            <div>Zeilen im CSV: {paritySummary.rowCount}</div>
            {paritySummary.daySpan ? (
              <div>
                Zeitraum: {paritySummary.daySpan.first} – {paritySummary.daySpan.last} (
                {paritySummary.daySpan.distinct} unterschiedliche Tage)
              </div>
            ) : null}
            {paritySummary.numberOffersStats ? (
              <div style={{ marginTop: 4 }}>
                <div>
                  <strong>number_offers</strong> (ueber alle Zeilen mit gueltigem Wert):
                </div>
                <div>
                  Minimum: {paritySummary.numberOffersStats.min.toLocaleString("de-DE")} · Maximum:{" "}
                  {paritySummary.numberOffersStats.max.toLocaleString("de-DE")} · Durchschnitt:{" "}
                  {paritySummary.numberOffersStats.avg.toFixed(2).toLocaleString("de-DE")}
                </div>
                <div>Zeilen mit gueltigem number_offers: {paritySummary.numberOffersStats.count}</div>
              </div>
            ) : (
              <div style={{ marginTop: 4 }}>
                In der CSV wurde keine Spalte <code>number_offers</code> gefunden oder sie enthielt keine gueltigen Werte.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Query 2 – Top Produkte + CSV Ergebnis */}
      <div
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>4. Top Produkte – Ergebnisse einfuegen</div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>
          Query zu Top-Produkten (Umsatz & Stueck) wird ueber den Button kopiert, im DWH ausfuehren und Ergebnis hier
          einfuegen.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => handleCopyQuery(query2)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #D1D5DB",
              background: "#F9FAFB",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            SQL kopieren
          </button>
          <div style={{ fontSize: 11, color: "#6B7280" }}>
            Ergebnis einfach in das kleine Feld rechts kopieren.
          </div>
          {copyStatus === "query2" ? (
            <div style={{ fontSize: 11, color: "#059669" }}>SQL kopiert ✅</div>
          ) : null}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: "#111827" }}>
          Ergebnis einfuegen {csvTopProductsText.trim() ? "✅" : ""}
        </div>
        <textarea
          value={csvTopProductsText}
          onChange={(e) => setCsvTopProductsText(e.target.value)}
          placeholder="Ergebnis aus der Top-Produkte-Query hier einfuegen..."
          style={{
            width: "100%",
            minHeight: 90,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
            fontSize: 11,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            boxSizing: "border-box",
            whiteSpace: "pre",
          }}
        />
      </div>

      {/* Dashboard Launcher */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #E5E7EB",
          background: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>5. Dashboard oeffnen</div>
        <div style={{ fontSize: 12, color: "#4B5563" }}>
          Das Dashboard zeigt alle wichtigen Monats-Kennzahlen in einer Tabelle, die du komplett nach Excel kopieren
          kannst.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowDashboard(true)}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid #111827",
              background: "#111827",
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dashboard als Pop-up anzeigen
          </button>
          <div style={{ fontSize: 11, color: "#6B7280" }}>Unten siehst du bereits einen Ausschnitt der Tabelle.</div>
        </div>

        {/* Kleiner Ausschnitt des Dashboards direkt auf der Seite */}
        <div
          style={{
            marginTop: 10,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            overflow: "auto",
            maxHeight: 260,
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 11,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                    width: 36,
                  }}
                >
                  #
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "left",
                  }}
                >
                  Jahr
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "left",
                  }}
                >
                  Monat
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Umsatz dieses Jahr
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Umsatz letztes Jahr
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Umsatz YoY %
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Bestellungen
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Avg. Bestellwert
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Storno-%
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Retouren-%
                </th>
                <th
                  style={{
                    border: "1px solid #E5E7EB",
                    padding: 6,
                    background: "#F9FAFB",
                    textAlign: "right",
                  }}
                >
                  Tracking-%
                </th>
              </tr>
            </thead>
            <tbody>
              {exampleMonthlyRows.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{idx + 1}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6 }}>{row.year}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6 }}>{row.month}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                    {row.revenueThisYear}
                  </td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                    {row.revenueLastYear}
                  </td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                    {row.revenueYoY}
                  </td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{row.orders}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                    {row.avgOrderValue}
                  </td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{row.cancelPct}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{row.returnPct}</td>
                  <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                    {row.trackingLinkPct}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dashboard Pop-up Overlay */}
      {showDashboard ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "90vw",
              maxWidth: 1200,
              maxHeight: "85vh",
              background: "#FFFFFF",
              borderRadius: 16,
              boxShadow: "0 20px 45px rgba(15, 23, 42, 0.35)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #E5E7EB",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                  Monats-Dashboard – Seite 1 & 2
                </div>
                <div style={{ fontSize: 11, color: "#6B7280" }}>
                  Seite 1: Umsatz & Volumen. Seite 2: Qualitaets-KPIs & Price Parity. Jede Seite kann separat nach Excel
                  kopiert werden.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleCopyDashboardPage1}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #111827",
                    background: "#111827",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Seite 1 kopieren {copyStatus === "page1" ? "✅" : ""}
                </button>
                <button
                  type="button"
                  onClick={handleCopyDashboardPage2}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #111827",
                    background: "#FFFFFF",
                    color: "#111827",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Seite 2 kopieren {copyStatus === "page2" ? "✅" : ""}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDashboard(false)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #D1D5DB",
                    background: "#F9FAFB",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Schliessen
                </button>
              </div>
            </div>

            <div
              style={{
                padding: 12,
                overflow: "auto",
              }}
            >
              {/* Tabs fuer Dashboard-Seiten */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 10,
                  borderBottom: "1px solid #E5E7EB",
                  paddingBottom: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveDashboardPage("page1")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: activeDashboardPage === "page1" ? "1px solid #111827" : "1px solid #D1D5DB",
                    background: activeDashboardPage === "page1" ? "#111827" : "#F9FAFB",
                    color: activeDashboardPage === "page1" ? "#FFFFFF" : "#111827",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Seite 1 – Umsatz & Volumen
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDashboardPage("page2")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: activeDashboardPage === "page2" ? "1px solid #111827" : "1px solid #D1D5DB",
                    background: activeDashboardPage === "page2" ? "#111827" : "#F9FAFB",
                    color: activeDashboardPage === "page2" ? "#FFFFFF" : "#111827",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Seite 2 – Qualitaets-KPIs & Price Parity
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDashboardPage("page3")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: activeDashboardPage === "page3" ? "1px solid #111827" : "1px solid #D1D5DB",
                    background: activeDashboardPage === "page3" ? "#111827" : "#F9FAFB",
                    color: activeDashboardPage === "page3" ? "#FFFFFF" : "#111827",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Seite 3 – Platz fuer weitere Analysen
                </button>
              </div>

              {/* Inhalt der aktiven Seite */}
              {activeDashboardPage === "page1" && (
                <div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                    Seite 1: Monatsumsatz, Bestellungen, Durchschnittsbon und Anzahl Listings. Perfekt fuer Umsatz- und
                    Angebots-Charts.
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                            width: 40,
                          }}
                        >
                          #
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "left",
                          }}
                        >
                          Jahr
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "left",
                          }}
                        >
                          Monat
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Umsatz dieses Jahr (EUR)
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Umsatz letztes Jahr (EUR)
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Umsatz YoY (%)
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Anzahl Bestellungen
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Durchschnittlicher Bestellwert (EUR)
                        </th>
                        <th
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            border: "1px solid #E5E7EB",
                            padding: 6,
                            background: "#F9FAFB",
                            textAlign: "right",
                          }}
                        >
                          Anzahl Angebote (Listings)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {exampleMonthlyRows.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{idx + 1}</td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6 }}>{row.year}</td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6 }}>{row.month}</td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                            {row.revenueThisYear}
                          </td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                            {row.revenueLastYear}
                          </td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                            {row.revenueYoY}
                          </td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{row.orders}</td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>
                            {row.avgOrderValue}
                          </td>
                          <td style={{ border: "1px solid #E5E7EB", padding: 6, textAlign: "right" }}>{row.offers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeDashboardPage === "page2" && (
                <div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                    Seite 2: Storno-, Retouren-, Tracking- und Repricing-Kennzahlen sowie Price-Parity-Anteile und Top
                    Produkte/Kategorien.
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                    }}
                  >
                    <tbody>
                      {page2GridRows.map((row, idx) => {
                        const cells = [...row];
                        while (cells.length < 13) {
                          cells.push("");
                        }
                        return (
                          <tr key={idx}>
                            {cells.map((value, cIdx) => (
                              <td
                                key={cIdx}
                                style={{
                                  border: "1px solid #E5E7EB",
                                  padding: 4,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {activeDashboardPage === "page3" && (
                <div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                    Seite 3 ist als leere Matrix gedacht (z. B. 100 Zeilen x 100 Spalten), die du in Excel fuer
                    Zusatzanalysen und Charts nutzen kannst.
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 11,
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            border: "1px solid #E5E7EB",
                            padding: 4,
                            background: "#F9FAFB",
                            textAlign: "right",
                            width: 32,
                          }}
                        >
                          #
                        </th>
                        {Array.from({ length: 20 }).map((_, idx) => (
                          <th
                            key={idx}
                            style={{
                              border: "1px solid #E5E7EB",
                              padding: 4,
                              background: "#F9FAFB",
                              textAlign: "center",
                            }}
                          >
                            C{idx + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 20 }).map((_, rIdx) => (
                        <tr key={rIdx}>
                          <td style={{ border: "1px solid #E5E7EB", padding: 4, textAlign: "right" }}>{rIdx + 1}</td>
                          {Array.from({ length: 20 }).map((_, cIdx) => (
                            <td key={cIdx} style={{ border: "1px solid #E5E7EB", padding: 4 }}>
                              {/* bewusst leer, nur Platzhalter-Zellen */}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

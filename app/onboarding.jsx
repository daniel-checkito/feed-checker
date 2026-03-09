import { useState, useRef } from "react";
import * as XLSX from "xlsx";

const BRAND = "rgb(4,16,103)";

// ── tiny helpers ──────────────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: -2 }}>{hint}</div>}
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #E5E7EB",
  fontSize: 13,
  color: "#111827",
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle = { ...inputStyle };
const textareaStyle = { ...inputStyle, resize: "vertical", minHeight: 60, fontFamily: "inherit" };

function Input(props) {
  return <input style={inputStyle} {...props} />;
}
function Select({ children, ...props }) {
  return <select style={selectStyle} {...props}>{children}</select>;
}
function Textarea(props) {
  return <textarea style={textareaStyle} {...props} />;
}

function StatusPill({ value }) {
  const map = {
    ok:      { label: "✅ OK",         bg: "#ECFDF3", color: "#166534" },
    warn:    { label: "⚠️ Hinweis",    bg: "#FFFBEB", color: "#92400E" },
    bad:     { label: "❌ Problem",    bg: "#FEF2F2", color: "#991B1B" },
    "":      { label: "–",            bg: "#F3F4F6", color: "#6B7280" },
  };
  const s = map[value] || map[""];
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, background: s.bg, color: s.color,
    }}>{s.label}</span>
  );
}

function SectionHeader({ n, title }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      borderBottom: "2px solid #E5E7EB", paddingBottom: 8, marginBottom: 16,
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: "50%", background: BRAND,
        color: "#fff", fontSize: 11, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{n}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>{title}</span>
    </div>
  );
}

function CopyBox({ label, code }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>{label}</div>
      <div style={{
        position: "relative", background: "#F9FAFB", border: "1px solid #E5E7EB",
        borderRadius: 8, padding: "10px 64px 10px 12px",
        fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#1D4ED8",
        whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "17px",
      }}>
        {code}
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          style={{
            position: "absolute", top: 6, right: 6,
            padding: "3px 8px", borderRadius: 6, border: "1px solid #E5E7EB",
            background: "#fff", fontSize: 11, fontWeight: 600,
            cursor: "pointer", color: copied ? "#166534" : "#374151",
          }}
        >{copied ? "✓" : "Kopieren"}</button>
      </div>
    </div>
  );
}

function BackendLink({ label, url, icon = "🔗" }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 999, border: "1px solid #E5E7EB",
      background: "#F9FAFB", fontSize: 12, color: "#374151", textDecoration: "none",
      cursor: "pointer",
    }}>
      {icon} {label}
    </a>
  );
}

// ── SQL templates ─────────────────────────────────────────────────────────────
const SQL = {
  orders: (id) => `SELECT
  COUNT(*)                    AS bestellpositionen,
  SUM(revenue)                AS umsatz,
  AVG(shop_cancellation_rate) AS shopstornoquote,
  AVG(return_rate)            AS retourenquote,
  AVG(delay_rate)             AS shopverzugsquote
FROM partner_orders
WHERE partner_id = '${id || "PARTNER_ID"}'
  AND order_date >= CURRENT_DATE - INTERVAL '30 days';`,

  parity: (id) => `SELECT
  percentage_marketplace_expensive_met,
  percentage_marketplace_expensive_amazon,
  percentage_marketplace_expensive_otto
FROM price_parity_report
WHERE partner_id = '${id || "PARTNER_ID"}'
  AND report_date = CURRENT_DATE - 1;`,

  parityExamples: (id) => `SELECT
  csin, check24_price, amazon_price,
  ROUND((check24_price - amazon_price) / amazon_price * 100, 2) AS pct_diff
FROM price_examples
WHERE partner_id = '${id || "PARTNER_ID"}'
  AND check24_price > amazon_price
ORDER BY pct_diff DESC
LIMIT 10;`,
};

// ── initial state ─────────────────────────────────────────────────────────────
const INIT = {
  partner:        "",
  date:           new Date().toISOString().split("T")[0],
  analyst:        "",
  partner_id:     "",

  amazon_id:      "",
  otto_id:        "",
  idealo_id:      "",
  ids_status:     "",
  autorelease:    "",
  dynamic_price:  "",
  setup_note:     "",

  feed_total:     "",
  feed_filtered:  "",
  feed_complete:  "",
  feed_in_pc:     "",
  feed_content:   "",
  feed_stock:     "",
  feed_delivery:  "",
  feed_note:      "",

  orders_pos:     "",
  orders_rev:     "",
  orders_cancel:  "",
  orders_return:  "",
  orders_delay:   "",
  orders_note:    "",

  price_met:      "",
  price_amazon:   "",
  price_otto:     "",
  price_examples: "",
  bb_best:        "",
  bb_2:           "",
  bb_2_5:         "",
  bb_5_10:        "",
  bb_10:          "",
  repricer:       "",
  repricer_note:  "",

  amz_active:     "",
  amz_rev:        "",
  amz_products:   "",
  amz_note:       "",

  prod_status:    "",
  prod_note:      "",
  accounti_note:  "",
  extra_note:     "",
  overall:        "",
};

// ── email builder ─────────────────────────────────────────────────────────────
function buildEmail(d) {
  const filterRate = d.feed_total && d.feed_filtered
    ? ((+d.feed_filtered / +d.feed_total) * 100).toFixed(1) + "%"
    : "–";

  const ratingLabel = {
    gut: "🟢 Gut – alles im grünen Bereich",
    mittel: "🟡 Mittel – Handlungsbedarf",
    schlecht: "🔴 Kritisch – dringender Handlungsbedarf",
  }[d.overall] || "–";

  const lines = [
    `Betreff: Onboarding-Analyse ${d.partner || "[Partnername]"} – ${d.date}`,
    "",
    `Hallo,`,
    "",
    `anbei die Zusammenfassung unserer Onboarding-Analyse für den Partner ${d.partner || "[Partnername]"} vom ${d.date}.`,
    "",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `GESAMTBEWERTUNG: ${ratingLabel}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    `─── GRUNDEINSTELLUNGEN ───────────────────`,
    `• Marktplatz-IDs: ${d.ids_status === "ok" ? "vollständig" : d.ids_status === "partial" ? "teilweise" : d.ids_status === "missing" ? "fehlend" : "–"}`,
    `• Auto-Bestellfreigabe: ${d.autorelease === "yes" ? "aktiv" : d.autorelease === "no" ? "nicht aktiv" : "–"}`,
    `• Dynamische Preisanpassung: ${d.dynamic_price === "yes" ? "aktiv" : d.dynamic_price === "no" ? "nicht aktiv" : d.dynamic_price === "partial" ? "teilweise" : "–"}`,
    d.setup_note ? `• Notiz: ${d.setup_note}` : "",
    "",
    `─── FEED & ANGEBOTE ──────────────────────`,
    `• Angebote gesamt: ${d.feed_total || "–"} | Herausgefiltert: ${d.feed_filtered || "–"} (${filterRate})`,
    `• Feed vollständig: ${d.feed_complete === "yes" ? "Ja" : d.feed_complete === "partial" ? "Teilweise" : d.feed_complete === "no" ? "Nein" : "–"}`,
    d.feed_in_pc ? `• In Product Creation: ${d.feed_in_pc}` : "",
    d.feed_content ? `• Content To-Do: ${d.feed_content}` : "",
    d.feed_stock ? `• Nicht vorrätig: ${d.feed_stock}` : "",
    d.feed_delivery ? `• Lieferzeit fehlt: ${d.feed_delivery}` : "",
    d.feed_note ? `• Notiz: ${d.feed_note}` : "",
    "",
    `─── BESTELLPERFORMANCE (30 TAGE) ─────────`,
    `• Bestellpositionen: ${d.orders_pos || "–"} | Umsatz: ${d.orders_rev ? Number(d.orders_rev).toLocaleString("de-DE") + " €" : "–"}`,
    `• Shopstornoquote: ${d.orders_cancel ? d.orders_cancel + "%" : "–"} | Retourenquote: ${d.orders_return ? d.orders_return + "%" : "–"} | Verzug: ${d.orders_delay ? d.orders_delay + "%" : "–"}`,
    d.orders_note ? `• Auffälligkeiten: ${d.orders_note}` : "",
    "",
    `─── PREISPARITÄT & BUYBOX ────────────────`,
    `• Teurer als MET: ${d.price_met ? d.price_met + "%" : "–"} | Amazon: ${d.price_amazon ? d.price_amazon + "%" : "–"} | Otto: ${d.price_otto ? d.price_otto + "%" : "–"}`,
    `• Buybox Bestpreis: ${d.bb_best ? d.bb_best + "%" : "–"}`,
    `• Repricer: ${d.repricer === "yes" ? "aktiv" : d.repricer === "no" ? "nicht aktiv" : d.repricer === "rule" ? "aktiv – " + d.repricer_note : "–"}`,
    d.price_examples ? `• Preisbeispiele: ${d.price_examples}` : "",
    "",
    d.amz_active ? [
      `─── AMAZON / VERKAUFSZAHLEN ──────────────`,
      `• Amazon: ${d.amz_active === "yes" ? "aktiv" : "nicht aktiv"}`,
      d.amz_active === "yes" && d.amz_rev ? `• Monatlicher Umsatz: ${Number(d.amz_rev).toLocaleString("de-DE")} €` : "",
      d.amz_note ? `• Notiz: ${d.amz_note}` : "",
      "",
    ].filter(Boolean).join("\n") : "",
    `─── PRODUKTDARSTELLUNG ───────────────────`,
    `• Status: ${d.prod_status === "yes" ? "i.O." : d.prod_status === "issues" ? "Probleme" : d.prod_status === "no" ? "nicht i.O." : "–"}`,
    d.prod_note ? `• ${d.prod_note}` : "",
    d.accounti_note ? `\n─── ACCOUNTI-INFOS ───────────────────────\n${d.accounti_note}` : "",
    d.extra_note ? `\n─── SONSTIGES ────────────────────────────\n${d.extra_note}` : "",
    "",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Analysiert von: ${d.analyst || "[Analyst]"} | ${d.date}`,
  ].filter((l) => l !== "").join("\n");

  return lines;
}

// ── main component ────────────────────────────────────────────────────────────
export default function Onboarding() {
  const [d, setD] = useState(INIT);
  const [emailText, setEmailText] = useState("");
  const [emailGenerated, setEmailGenerated] = useState(false);
  const emailRef = useRef(null);

  const set = (key) => (e) => setD((prev) => ({ ...prev, [key]: e.target.value }));

  const filterRate = d.feed_total && d.feed_filtered
    ? ((+d.feed_filtered / +d.feed_total) * 100).toFixed(1) + "%"
    : null;

  function genEmail() {
    setEmailText(buildEmail(d));
    setEmailGenerated(true);
    setTimeout(() => emailRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function exportXLSX() {
    const rows = [
      ["Partnerbewertung Akquise-Onboarding"],
      ["Partner", d.partner, "Datum", d.date, "Analyst", d.analyst],
      [],
      ["=== GRUNDEINSTELLUNGEN ==="],
      ["Amazon ID", d.amazon_id, "Otto ID", d.otto_id, "Idealo ID", d.idealo_id],
      ["IDs Status", d.ids_status, "Auto-Bestellfreigabe", d.autorelease, "Dyn. Preisanpassung", d.dynamic_price],
      ["Setup-Notiz", d.setup_note],
      [],
      ["=== FEED & ANGEBOTE ==="],
      ["Angebote gesamt", d.feed_total, "Herausgefiltert", d.feed_filtered, "Filter-Rate", filterRate || "–"],
      ["Feed vollständig", d.feed_complete, "In PC", d.feed_in_pc, "Content ToDo", d.feed_content],
      ["Nicht vorrätig", d.feed_stock, "Lieferzeit fehlt", d.feed_delivery, "Notiz", d.feed_note],
      [],
      ["=== BESTELLPERFORMANCE ==="],
      ["Bestellpositionen", d.orders_pos, "Umsatz", d.orders_rev, "Stornoquote", d.orders_cancel],
      ["Retourenquote", d.orders_return, "Verzugsquote", d.orders_delay, "Auffälligkeiten", d.orders_note],
      [],
      ["=== PREISPARITÄT & BUYBOX ==="],
      ["% teurer MET", d.price_met, "% teurer Amazon", d.price_amazon, "% teurer Otto", d.price_otto],
      ["Buybox Best", d.bb_best, "Buybox 2%", d.bb_2, "Buybox 2-5%", d.bb_2_5],
      ["Buybox 5-10%", d.bb_5_10, "Buybox 10%+", d.bb_10, "Repricer", d.repricer],
      ["Preisbeispiele", d.price_examples],
      [],
      ["=== AMAZON ==="],
      ["Aktiv", d.amz_active, "Monatl. Umsatz", d.amz_rev, "Produkte", d.amz_products],
      ["Notiz", d.amz_note],
      [],
      ["=== PRODUKTDARSTELLUNG ==="],
      ["Status", d.prod_status, "Notiz", d.prod_note],
      [],
      ["=== ACCOUNTI & SONSTIGES ==="],
      ["Accounti-Infos", d.accounti_note],
      ["Sonstiges", d.extra_note],
      ["Gesamtbewertung", d.overall],
      [],
      ["=== E-MAIL ==="],
      [emailText],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 35 }, { wch: 30 }, { wch: 35 }, { wch: 20 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, ws, "Onboarding");
    const name = `Onboarding_${(d.partner || "Partner").replace(/\s+/g, "_")}_${d.date}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  // card wrapper
  const Card = ({ children, style }) => (
    <div style={{
      background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12,
      padding: 20, marginBottom: 14, ...style,
    }}>{children}</div>
  );

  const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
  const grid3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 };

  return (
    <div style={{
      maxWidth: 900, margin: "0 auto", padding: "24px 24px 48px",
      fontFamily: "ui-sans-serif, system-ui", boxSizing: "border-box",
    }}>
      {/* ── page title ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>Partner Onboarding</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>Akquise-Checkliste — alles auf einem Blick</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={genEmail} style={{
            padding: "9px 18px", borderRadius: 999, border: `1px solid ${BRAND}`,
            background: BRAND, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>✉️ E-Mail generieren</button>
          <button onClick={exportXLSX} style={{
            padding: "9px 18px", borderRadius: 999, border: "1px solid #E5E7EB",
            background: "#fff", color: "#111827", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>💾 XLSX speichern</button>
        </div>
      </div>

      {/* ── 0 Meta ── */}
      <Card>
        <div style={{ ...grid3, gridTemplateColumns: "2fr 1fr 1fr" }}>
          <Field label="Partnername">
            <Input placeholder="z.B. Möbelhaus GmbH" value={d.partner} onChange={set("partner")} />
          </Field>
          <Field label="Datum">
            <Input type="date" value={d.date} onChange={set("date")} />
          </Field>
          <Field label="Analysiert von">
            <Input placeholder="Dein Name" value={d.analyst} onChange={set("analyst")} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Partner-ID (für SQL-Queries)" hint="Wird automatisch in alle Queries eingesetzt">
            <Input placeholder="z.B. 12345" value={d.partner_id} onChange={set("partner_id")} />
          </Field>
        </div>
      </Card>

      {/* ── 1 Grundeinstellungen ── */}
      <Card>
        <SectionHeader n="1" title="Grundeinstellungen" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="Merchant-Center" url="https://merchant.check24.de/partner" />
          <BackendLink label="Partnereinstellungen" url="https://merchant.check24.de/settings" icon="⚙️" />
        </div>
        <div style={grid3}>
          <Field label="Amazon Seller ID">
            <Input placeholder="A1B2C3…" value={d.amazon_id} onChange={set("amazon_id")} />
          </Field>
          <Field label="Otto Partner-ID">
            <Input placeholder="123456" value={d.otto_id} onChange={set("otto_id")} />
          </Field>
          <Field label="Idealo ID">
            <Input placeholder="78910" value={d.idealo_id} onChange={set("idealo_id")} />
          </Field>
        </div>
        <div style={{ ...grid3, marginTop: 14 }}>
          <Field label="IDs Status">
            <Select value={d.ids_status} onChange={set("ids_status")}>
              <option value="">– bitte wählen –</option>
              <option value="ok">✅ Alle hinterlegt</option>
              <option value="partial">⚠️ Teilweise</option>
              <option value="missing">❌ Fehlend</option>
            </Select>
          </Field>
          <Field label="Auto-Bestellfreigabe">
            <Select value={d.autorelease} onChange={set("autorelease")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Aktiv</option>
              <option value="no">❌ Nicht aktiv</option>
            </Select>
          </Field>
          <Field label="Dynamische Preisanpassung">
            <Select value={d.dynamic_price} onChange={set("dynamic_price")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Aktiv (inkl. Amazon)</option>
              <option value="partial">⚠️ Teilweise</option>
              <option value="no">❌ Nicht aktiv</option>
            </Select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Notiz">
            <Textarea placeholder="Auffälligkeiten…" value={d.setup_note} onChange={set("setup_note")} />
          </Field>
        </div>
      </Card>

      {/* ── 2 Feed ── */}
      <Card>
        <SectionHeader n="2" title="Feed & Angebote" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="Feed-Übersicht" url="https://merchant.check24.de/feed" />
          <BackendLink label="Herausgefilterte Angebote" url="https://merchant.check24.de/feed/filtered" icon="🔍" />
          <BackendLink label="Feed-Fehler GUI" url="https://merchant.check24.de/feed/errors" icon="⚠️" />
        </div>
        <div style={grid3}>
          <Field label="Offers insgesamt">
            <Input type="number" placeholder="z.B. 12500" value={d.feed_total} onChange={set("feed_total")} />
          </Field>
          <Field label="Herausgefiltert">
            <Input type="number" placeholder="z.B. 340" value={d.feed_filtered} onChange={set("feed_filtered")} />
          </Field>
          <Field label="Filter-Rate">
            <Input value={filterRate ? filterRate : ""} placeholder="wird berechnet" readOnly
              style={{ ...inputStyle, color: "#6B7280", background: "#F9FAFB" }} />
          </Field>
        </div>
        <div style={{ ...grid3, marginTop: 14 }}>
          <Field label="In Product Creation">
            <Input type="number" placeholder="Anzahl" value={d.feed_in_pc} onChange={set("feed_in_pc")} />
          </Field>
          <Field label="Content To-Do">
            <Input type="number" placeholder="Anzahl" value={d.feed_content} onChange={set("feed_content")} />
          </Field>
          <Field label="Nicht vorrätig">
            <Input type="number" placeholder="Anzahl" value={d.feed_stock} onChange={set("feed_stock")} />
          </Field>
        </div>
        <div style={{ ...grid2, marginTop: 14 }}>
          <Field label="Lieferzeit fehlt">
            <Input type="number" placeholder="Anzahl" value={d.feed_delivery} onChange={set("feed_delivery")} />
          </Field>
          <Field label="Feed vollständig?">
            <Select value={d.feed_complete} onChange={set("feed_complete")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Ja</option>
              <option value="partial">⚠️ Teilweise</option>
              <option value="no">❌ Nein</option>
            </Select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Weitere Hinweise">
            <Textarea placeholder="Sonstige Filter-Gründe…" value={d.feed_note} onChange={set("feed_note")} />
          </Field>
        </div>
      </Card>

      {/* ── 3 Bestellungen ── */}
      <Card>
        <SectionHeader n="3" title="Bestellperformance (letzte 30 Tage)" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="Superset Partner Dashboard" url="https://superset.check24.de/dashboard/partner" icon="📈" />
          <BackendLink label="Backoffice Bestellungen" url="https://backoffice.check24.de/orders" />
        </div>
        <CopyBox label="SQL – Bestellkennzahlen (Superset / TablePlus)" code={SQL.orders(d.partner_id)} />
        <div style={{ ...grid3, marginTop: 14 }}>
          <Field label="Bestellpositionen">
            <Input type="number" placeholder="z.B. 420" value={d.orders_pos} onChange={set("orders_pos")} />
          </Field>
          <Field label="Umsatz (€)">
            <Input type="number" placeholder="z.B. 18500" value={d.orders_rev} onChange={set("orders_rev")} />
          </Field>
          <Field label="Shopstornoquote (%)">
            <Input type="number" step="0.1" placeholder="z.B. 2.3" value={d.orders_cancel} onChange={set("orders_cancel")} />
          </Field>
          <Field label="Retourenquote (%)">
            <Input type="number" step="0.1" placeholder="z.B. 5.1" value={d.orders_return} onChange={set("orders_return")} />
          </Field>
          <Field label="Shopverzugsquote (%)">
            <Input type="number" step="0.1" placeholder="z.B. 1.2" value={d.orders_delay} onChange={set("orders_delay")} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Auffälligkeiten" hint="Leer lassen wenn alles i.O.">
            <Textarea placeholder="Kommentar…" value={d.orders_note} onChange={set("orders_note")} />
          </Field>
        </div>
      </Card>

      {/* ── 4 Preisparität & Buybox ── */}
      <Card>
        <SectionHeader n="4" title="Preisparität & Buybox" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="TablePlus öffnen" url="tableplus://" icon="🗄️" />
          <BackendLink label="Buybox-Übersicht" url="https://merchant.check24.de/buybox" icon="🏆" />
        </div>
        <CopyBox label="SQL – Preisparität (TablePlus)" code={SQL.parity(d.partner_id)} />
        <div style={{ ...grid3, marginTop: 14 }}>
          <Field label="% teurer als MET">
            <Input type="number" step="0.1" placeholder="z.B. 12.4" value={d.price_met} onChange={set("price_met")} />
          </Field>
          <Field label="% teurer als Amazon">
            <Input type="number" step="0.1" placeholder="z.B. 8.2" value={d.price_amazon} onChange={set("price_amazon")} />
          </Field>
          <Field label="% teurer als Otto">
            <Input type="number" step="0.1" placeholder="z.B. 5.7" value={d.price_otto} onChange={set("price_otto")} />
          </Field>
        </div>

        <CopyBox label="SQL – Preisbeispiele (TablePlus)" code={SQL.parityExamples(d.partner_id)} />
        <div style={{ marginTop: 14 }}>
          <Field label="Auffällige Preisbeispiele">
            <Textarea placeholder="z.B. CSIN 123456: CHECK24 24,99€ vs. Amazon 19,99€" value={d.price_examples} onChange={set("price_examples")} />
          </Field>
        </div>

        {/* Buybox */}
        <div style={{ marginTop: 18, borderTop: "1px solid #F3F4F6", paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>Anteil der Buyboxen</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            {[
              { key: "bb_best", label: "Bestpreis" },
              { key: "bb_2", label: "2% über Best" },
              { key: "bb_2_5", label: "2–5%" },
              { key: "bb_5_10", label: "5–10%" },
              { key: "bb_10", label: "10%+" },
            ].map(({ key, label }) => (
              <div key={key} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6 }}>{label}</div>
                <input
                  type="number" placeholder="%" value={d[key]} onChange={set(key)}
                  style={{ width: "100%", border: "none", borderBottom: "1px solid #E5E7EB", background: "transparent",
                    textAlign: "center", fontSize: 15, fontWeight: 700, padding: "4px 0", color: "#111827", boxSizing: "border-box" }}
                />
                <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>%</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...grid2, marginTop: 14 }}>
          <Field label="Repricer aktiv?">
            <Select value={d.repricer} onChange={set("repricer")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Ja</option>
              <option value="rule">⚙️ Ja – bestimmte Regel</option>
              <option value="no">❌ Nein</option>
            </Select>
          </Field>
          <Field label="Repricer-Details">
            <Input placeholder="Regel-Name oder Details…" value={d.repricer_note} onChange={set("repricer_note")} />
          </Field>
        </div>
      </Card>

      {/* ── 5 Amazon ── */}
      <Card>
        <SectionHeader n="5" title="Amazon / Verkaufszahlen" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="Helium10 X-Ray" url="https://www.helium10.com/tools/xray/" icon="📦" />
          <BackendLink label="Market Tracker" url="https://www.helium10.com/tools/market-tracker/" icon="📊" />
        </div>
        <div style={grid3}>
          <Field label="Amazon aktiv?">
            <Select value={d.amz_active} onChange={set("amz_active")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Ja</option>
              <option value="no">❌ Nein</option>
            </Select>
          </Field>
          <Field label="Monatl. Amazon-Umsatz (€)">
            <Input type="number" placeholder="z.B. 45000" value={d.amz_rev} onChange={set("amz_rev")} disabled={d.amz_active !== "yes"}
              style={{ ...inputStyle, background: d.amz_active !== "yes" ? "#F9FAFB" : "#fff", color: d.amz_active !== "yes" ? "#9CA3AF" : "#111827" }} />
          </Field>
          <Field label="Relevante Produkte">
            <Input type="number" placeholder="z.B. 230" value={d.amz_products} onChange={set("amz_products")} disabled={d.amz_active !== "yes"}
              style={{ ...inputStyle, background: d.amz_active !== "yes" ? "#F9FAFB" : "#fff", color: d.amz_active !== "yes" ? "#9CA3AF" : "#111827" }} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Notiz">
            <Textarea placeholder="Auffälligkeiten, Chancen…" value={d.amz_note} onChange={set("amz_note")} />
          </Field>
        </div>
      </Card>

      {/* ── 6 Produktdarstellung & Abschluss ── */}
      <Card>
        <SectionHeader n="6" title="Produktdarstellung & Abschluss" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <BackendLink label="CHECK24 Frontend" url="https://www.check24.de" icon="🎨" />
          <BackendLink label="Pipe-Übersicht" url="https://merchant.check24.de/pipe" icon="🔧" />
          <BackendLink label="Accounti" url="https://accounti.check24.de" icon="👤" />
        </div>
        <div style={grid2}>
          <Field label="Produktdarstellung OK?">
            <Select value={d.prod_status} onChange={set("prod_status")}>
              <option value="">– bitte wählen –</option>
              <option value="yes">✅ Ja, alles i.O.</option>
              <option value="issues">⚠️ Probleme gefunden</option>
              <option value="no">❌ Nicht in Ordnung</option>
            </Select>
          </Field>
          <Field label="Gesamtbewertung">
            <Select value={d.overall} onChange={set("overall")}>
              <option value="">– bitte wählen –</option>
              <option value="gut">🟢 Gut – alles i.O.</option>
              <option value="mittel">🟡 Mittel – Handlungsbedarf</option>
              <option value="schlecht">🔴 Kritisch – dringend</option>
            </Select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Produktdarstellung – Probleme" hint="Leer lassen wenn alles i.O.">
            <Textarea placeholder="Kommentar…" value={d.prod_note} onChange={set("prod_note")} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Accounti-Infos / Gesprächsnotizen">
            <Textarea placeholder="Letzte Kommunikation, Vereinbarungen…" value={d.accounti_note} onChange={set("accounti_note")} style={{ ...textareaStyle, minHeight: 80 }} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Zusätzliche Notizen">
            <Textarea placeholder="Sonstiges…" value={d.extra_note} onChange={set("extra_note")} />
          </Field>
        </div>
      </Card>

      {/* ── E-Mail preview ── */}
      <div ref={emailRef}>
        {emailGenerated && (
          <Card style={{ borderColor: BRAND }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>✉️ Generierte E-Mail</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { navigator.clipboard.writeText(emailText); }}
                  style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid #E5E7EB", background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  📋 Kopieren
                </button>
                <button onClick={exportXLSX}
                  style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${BRAND}`, background: BRAND, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  💾 XLSX speichern
                </button>
              </div>
            </div>
            <textarea
              value={emailText} onChange={(e) => setEmailText(e.target.value)}
              rows={20}
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: 14,
                fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: "18px",
                background: "#F9FAFB", color: "#111827", resize: "vertical", boxSizing: "border-box" }}
            />
          </Card>
        )}
      </div>

      {/* floating action ── */}
      <div style={{
        position: "fixed", bottom: 24, right: 24, display: "flex", gap: 10,
        filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.15))",
      }}>
        <button onClick={exportXLSX} style={{
          padding: "10px 18px", borderRadius: 999, border: "1px solid #E5E7EB",
          background: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>💾 XLSX</button>
        <button onClick={genEmail} style={{
          padding: "10px 18px", borderRadius: 999, background: BRAND,
          color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
        }}>✉️ E-Mail</button>
      </div>
    </div>
  );
}
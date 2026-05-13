"use client";
import React, { useState, useRef, useMemo, useEffect } from 'react';
import Papa from 'papaparse';

// ─── PALETTE ───────────────────────────────────────────────────────────────
const PALETTE = {
  redBg:'#FEE2E2', redAccent:'#F87171', redText:'#B91C1C',
  orangeBg:'#FFEDD5', orangeAccent:'#FB923C', orangeText:'#EA580C',
  yellowBg:'#FEF9C3', yellowAccent:'#FACC15', yellowText:'#CA8A04',
  greenBg:'#DCFCE7', greenAccent:'#4ADE80', greenText:'#15803D',
  blueBg:'#DBEAFE', blueAccent:'#60A5FA', blueText:'#1E40AF',
  cardBg:'#FFFFFF', surface:'#F8FAFC', border:'#E5E7EB',
  textPrimary:'#111827', textMuted:'#6B7280',
};

// ─── CONSTANTS ─────────────────────────────────────────────────────────────
const MC_BLUE = "#1553B6";
const MC_PFLICHT_COLS = [
  "name","description","brand","category_path","seller_offer_id","ean",
  "price","availability","stock_amount","delivery_time","delivery_includes","shipping_mode",
  "image_url",
  "color","material","size","size_height","size_depth","size_diameter",
  "manufacturer_name","manufacturer_street","manufacturer_postcode",
  "manufacturer_city","manufacturer_country","manufacturer_email",
];
const MC_OPTIONAL_COLS = [
  "deeplink","model",
  "size_lying_surface","size_seat_height","ausrichtung","style","temper","weight","weight_capacity",
  "youtube_link","bild_3d_glb","bild_3d_usdz","assembly_instructions",
  "illuminant_included","incl_mattress","incl_slatted_frame","led_verbaut","lighting_included","set_includes","socket",
  "care_instructions","filling","removable_cover","suitable_for_allergic",
  "energy_efficiency_category","product_data_sheet",
  "manufacturer_phone_number",
];
const MC_PFLICHT_ALIASES = {
  ean:["ean","gtin","gtin14","ean13","barcode"],
  brand:["brand","marke"],
  category_path:["category_path","kategorie","category","kategoriepfad","produktgruppe"],
  description:["description","beschreibung","desc"],
  name:["name","title","titel","product_name","produktname"],
  seller_offer_id:["seller_offer_id","sellerofferid","artikelnummer","offer_id","sku","merchant_sku","eindeutige_id","unique_id"],
  color:["color","farbe","colour"],
  material:["material","materials","werkstoff"],
  size:["size","abmessung","dimension","größe","maße"],
  size_depth:["size_depth","tiefe","depth"],
  size_diameter:["size_diameter","durchmesser","diameter"],
  size_height:["size_height","höhe","hoehe","height"],
  image_url:["image_url","image","img_url","bild","bild_url","bildlink_1","bildlink1"],
  manufacturer_name:["manufacturer_name","manufacturer","hersteller"],
  manufacturer_street:["manufacturer_street","hersteller_strasse","hersteller_straße"],
  manufacturer_postcode:["manufacturer_postcode","hersteller_plz"],
  manufacturer_city:["manufacturer_city","hersteller_stadt","hersteller_ort"],
  manufacturer_country:["manufacturer_country","hersteller_land"],
  manufacturer_email:["manufacturer_email","hersteller_email"],
  availability:["availability","verfügbarkeit","verfuegbarkeit","lieferstatus"],
  delivery_time:["delivery_time","lieferzeit"],
  delivery_includes:["delivery_includes","lieferumfang"],
  price:["price","preis","vk","selling_price"],
  stock_amount:["stock_amount","stock","bestand","quantity","qty"],
  shipping_mode:["shipping_mode","versandtyp","versandart","shipping_type","delivery_mode","lieferart"],
};
const MC_OPTIONAL_ALIASES = {
  deeplink:["deeplink","link","url","produktlink"],
  model:["model","modell"],
  size_lying_surface:["size_lying_surface","liegefläche"],
  size_seat_height:["size_seat_height","sitzhöhe"],
  ausrichtung:["ausrichtung","orientation"],
  style:["style","stil"],
  temper:["temper","härte"],
  weight:["weight","gewicht"],
  weight_capacity:["weight_capacity","tragkraft","belastbarkeit"],
  youtube_link:["youtube_link","youtube","video_link"],
  bild_3d_glb:["bild_3d_glb","3d_glb","glb"],
  bild_3d_usdz:["bild_3d_usdz","3d_usdz","usdz"],
  assembly_instructions:["assembly_instructions","montageanleitung"],
  illuminant_included:["illuminant_included","leuchtmittel"],
  incl_mattress:["incl_mattress","matratze_enthalten"],
  incl_slatted_frame:["incl_slatted_frame","lattenrost_enthalten"],
  led_verbaut:["led_verbaut","led"],
  lighting_included:["lighting_included","beleuchtung"],
  set_includes:["set_includes","set_inhalt"],
  socket:["socket","steckdose"],
  care_instructions:["care_instructions","pflegehinweise"],
  filling:["filling","füllung"],
  removable_cover:["removable_cover","abnehmbarer_bezug"],
  suitable_for_allergic:["suitable_for_allergic","allergikergeeignet"],
  energy_efficiency_category:["energy_efficiency_category","energieklasse"],
  product_data_sheet:["product_data_sheet","datenblatt"],
  manufacturer_phone_number:["manufacturer_phone_number","hersteller_telefon"],
};

// ─── LOCAL HELPERS (standalone, no globals needed) ──────────────────────────
function normalizeKey(input) {
  const s = String(input ?? "");
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9_ ]/g, "").replace(/\s/g, "_");
}

function bestHeaderMatch(headers, candidates) {
  const safeH = (Array.isArray(headers) ? headers : []).filter(Boolean);
  const safeC = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const normH = safeH.map(h => ({ raw: h, norm: normalizeKey(h) }));
  const normC = safeC.map(c => normalizeKey(c));
  for (const c of normC) { const e = normH.find(h => h.norm === c); if (e) return e.raw; }
  for (const c of normC) { const e = normH.find(h => h.norm.includes(c) || c.includes(h.norm)); if (e) return e.raw; }
  return null;
}

function detectFieldByContent(fields, headers, rows) {
  // Minimal content-based detection: try to find unmapped fields by sample values
  const result = {};
  const sample = rows.slice(0, 20);
  for (const field of fields) {
    for (const h of headers) {
      if (Object.values(result).includes(h)) continue;
      const vals = sample.map(r => String(r[h] ?? '').trim()).filter(Boolean);
      if (!vals.length) continue;
      if (field === 'ean' && vals.every(v => /^\d{8,14}$/.test(v))) { result[field] = h; break; }
      if (field === 'price' && vals.every(v => /^\d[\d.,]*$/.test(v))) { result[field] = h; break; }
    }
  }
  return result;
}

// ─── TRANSLATIONS ───────────────────────────────────────────────────────────
const T = {
  de: {
    title: "Ihr Angebotsfeed",
    step1: "Upload", step2: "Zuordnung", step3: "Pflichtfelder",
    step4: "Optionale Felder", step5: "Ergebnis",
    next: "Weiter →", back: "← Zurück",
    uploadPrompt: "Datei hierher ziehen oder anklicken",
    uploadSub: "CSV, max. 64 MB",
    pflichtfelder: "Pflichtfelder",
    optionaleFelder: "Optionale Felder",
    hinweise: "Hinweise",
    artikelBetroffen: "Artikel betroffen",
    handlungsempfehlungen: "Handlungsempfehlungen",
    allEinklappen: "Alle Kategorien einklappen",
    allAusklappen: "Alle Kategorien ausklappen",
    feedUebersicht: "FEED-ÜBERSICHT",
    detailsAnsehen: "Details ansehen",
    pflichtfeldabdeckung: "Pflichtfeldabdeckung",
    optionaleFeldabdeckung: "Optionale Feldabdeckung",
    vollstaendig: "vollständig",
    unvollstaendig: "unvollständig",
    luecken: "Lücken",
    gesamt: "gesamt",
    soGehtEsWeiter: "SO GEHT ES WEITER",
    step1Label: "Fehlerbericht herunterladen",
    step1Sub: "CSV-Datei mit allen Fehlern je Zeile für Excel",
    step2Label: "Fehler in Excel korrigieren",
    step2Sub: "Betroffene Artikel anhand der Fehlerspalte bearbeiten",
    step3Label: "Korrigierten Feed hochladen",
    step3Sub: "Direkt im Händlerportal unter Einstellungen → Feed",
    fehlerberichtCsv: "FEHLERBERICHT ALS CSV",
    fehlerberichtDesc: "Pro Artikel werden alle Fehler in einer Spalte aufgelistet – direkt in Excel korrigierbar.",
    fehlerberichtBtn: "Fehlerbericht herunterladen",
    neuHochladen: "Neu hochladen →",
    verhindern: "verhindern das Listing",
    verbessern: "verbessern Filter, Suche und Conversion",
    qualitaet: "Qualitätsverbesserungen, optional",
    listbar: "listbar",
    optional: "Optional",
    weitereBuckets: "Alle",
  },
  en: {
    title: "Your Product Feed",
    step1: "Upload", step2: "Mapping", step3: "Required Fields",
    step4: "Optional Fields", step5: "Results",
    next: "Next →", back: "← Back",
    uploadPrompt: "Drop file here or click to select",
    uploadSub: "CSV, max. 64 MB",
    pflichtfelder: "Required Fields",
    optionaleFelder: "Optional Fields",
    hinweise: "Hints",
    artikelBetroffen: "items affected",
    handlungsempfehlungen: "Recommendations",
    allEinklappen: "Collapse all categories",
    allAusklappen: "Expand all categories",
    feedUebersicht: "FEED OVERVIEW",
    detailsAnsehen: "View details",
    pflichtfeldabdeckung: "Required field coverage",
    optionaleFeldabdeckung: "Optional field coverage",
    vollstaendig: "complete",
    unvollstaendig: "incomplete",
    luecken: "gaps",
    gesamt: "total",
    soGehtEsWeiter: "NEXT STEPS",
    step1Label: "Download error report",
    step1Sub: "CSV file with all errors per row for Excel",
    step2Label: "Fix errors in Excel",
    step2Sub: "Edit affected items using the error column",
    step3Label: "Upload corrected feed",
    step3Sub: "Directly in the partner portal under Settings → Feed",
    fehlerberichtCsv: "ERROR REPORT AS CSV",
    fehlerberichtDesc: "All errors are listed per item in one column – directly editable in Excel.",
    fehlerberichtBtn: "Download error report",
    neuHochladen: "Upload new →",
    verhindern: "prevent listing",
    verbessern: "improve filters, search & conversion",
    qualitaet: "Quality improvements, optional",
    listbar: "listable",
    optional: "Optional",
    weitereBuckets: "All",
  },
};

// ─── FIELD LABELS ────────────────────────────────────────────────────────────
const FL = {
  de: {
    name:"Artikelname", description:"Beschreibung", brand:"Marke",
    category_path:"Kategoriepfad", seller_offer_id:"Eigene Artikel-ID",
    ean:"EAN (GTIN14)", price:"Preis", availability:"Verfügbarkeit",
    stock_amount:"Bestand", delivery_time:"Lieferzeit",
    delivery_includes:"Lieferumfang", shipping_mode:"Versandart",
    image_url:"Hauptbild", color:"Farbe", material:"Material",
    size:"Maße (Gesamt)", size_height:"Höhe", size_depth:"Tiefe",
    size_diameter:"Durchmesser", manufacturer_name:"Herstellername",
    manufacturer_street:"Herstellerstraße", manufacturer_postcode:"Herstellerpostleitzahl",
    manufacturer_city:"Herstellerstadt", manufacturer_country:"Herstellerland",
    manufacturer_email:"Hersteller-E-Mail",
    deeplink:"Deeplink", model:"Modellbezeichnung",
    size_lying_surface:"Liegefläche", size_seat_height:"Sitzhöhe",
    ausrichtung:"Ausrichtung", style:"Stil", temper:"Härtegrad",
    weight:"Gewicht", weight_capacity:"Belastbarkeit",
    youtube_link:"Youtube-Video", bild_3d_glb:"3D-Ansicht (GLB)", bild_3d_usdz:"3D-Ansicht (USDZ)",
    assembly_instructions:"Montageanleitung",
    illuminant_included:"Leuchtmittel inkl.", incl_mattress:"Matratze inkl.",
    incl_slatted_frame:"Lattenrost inkl.", led_verbaut:"LED verbaut",
    lighting_included:"Beleuchtung inkl.", set_includes:"Set-Inhalt", socket:"Steckdose",
    care_instructions:"Pflegehinweise", filling:"Füllung",
    removable_cover:"Bezug abnehmbar", suitable_for_allergic:"Allergikergeeignet",
    energy_efficiency_category:"Energieeffizienzklasse", product_data_sheet:"Produktdatenblatt",
    manufacturer_phone_number:"Herstellertelefon",
  },
  en: {
    name:"Product name", description:"Description", brand:"Brand",
    category_path:"Category path", seller_offer_id:"Seller offer ID",
    ean:"EAN (GTIN14)", price:"Price", availability:"Availability",
    stock_amount:"Stock", delivery_time:"Delivery time",
    delivery_includes:"Delivery includes", shipping_mode:"Shipping mode",
    image_url:"Main image", color:"Color", material:"Material",
    size:"Size", size_height:"Height", size_depth:"Depth",
    size_diameter:"Diameter", manufacturer_name:"Manufacturer name",
    manufacturer_street:"Manufacturer street", manufacturer_postcode:"Manufacturer postcode",
    manufacturer_city:"Manufacturer city", manufacturer_country:"Manufacturer country",
    manufacturer_email:"Manufacturer email",
    deeplink:"Deeplink", model:"Model",
    size_lying_surface:"Lying surface", size_seat_height:"Seat height",
    ausrichtung:"Orientation", style:"Style", temper:"Firmness",
    weight:"Weight", weight_capacity:"Weight capacity",
    youtube_link:"YouTube video", bild_3d_glb:"3D view (GLB)", bild_3d_usdz:"3D view (USDZ)",
    assembly_instructions:"Assembly instructions",
    illuminant_included:"Illuminant incl.", incl_mattress:"Mattress incl.",
    incl_slatted_frame:"Slatted frame incl.", led_verbaut:"LED built-in",
    lighting_included:"Lighting incl.", set_includes:"Set contents", socket:"Socket",
    care_instructions:"Care instructions", filling:"Filling",
    removable_cover:"Removable cover", suitable_for_allergic:"Allergy-friendly",
    energy_efficiency_category:"Energy efficiency class", product_data_sheet:"Product data sheet",
    manufacturer_phone_number:"Manufacturer phone",
  },
};

// ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct >= 90) return PALETTE.greenAccent;
  if (pct >= 60) return PALETTE.orangeAccent;
  return PALETTE.redAccent;
}
function textColorForPct(pct) {
  if (pct >= 90) return PALETTE.greenText;
  if (pct >= 60) return PALETTE.orangeText;
  return PALETTE.redText;
}

function fieldIcon(field, color) {
  const icons = {
    name: 'T', description: '≡', brand: '◇', ean: 'EAN', category_path: '≔',
    seller_offer_id: '◇', image_url: '⌗', price: '€', availability: '◎',
    stock_amount: '□', delivery_time: '⏱', delivery_includes: '≡',
    shipping_mode: '⊡', color: '◉', material: '⬡', size: '⤢',
    size_height: '⤢', size_depth: '⤢', size_diameter: '⤢',
    manufacturer_name: '⊙', manufacturer_email: '✉', manufacturer_street: '⊙',
    manufacturer_postcode: '⊙', manufacturer_city: '⊙', manufacturer_country: '⊙',
    deeplink: '⧉', model: '⊡', weight: '⊡', weight_capacity: '⊡',
    energy_efficiency_category: '◎', youtube_link: '▶',
    image_url_single: '⌗',
  };
  return <span style={{ fontSize: 14, fontWeight: 800, color }}>{icons[field] || '•'}</span>;
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────
function RecCard({ rec, sectionColor, sectionBg, sectionAccent, t, lang }) {
  const [open, setOpen] = React.useState(false);
  const fieldLabel = FL[lang]?.[rec.field] || rec.field;
  const titleSuffix = rec.type === 'missing' ? ' fehlt' : rec.type === 'single' ? '' : `: ${rec.type}`;
  const title = rec.type === 'quality' ? fieldLabel : `${fieldLabel}${titleSuffix}`;

  return (
    <div
      style={{
        background: PALETTE.cardBg, borderRadius: 12,
        border: `1px solid ${PALETTE.border}`, padding: '14px 18px', marginBottom: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'pointer',
      }}
      onClick={() => setOpen(v => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: sectionBg, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          {fieldIcon(rec.field, sectionAccent)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: PALETTE.textPrimary }}>{title}</div>
          <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 2 }}>{rec.shortDesc}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {rec.count !== null ? (
            <>
              <span style={{ fontSize: 18, fontWeight: 800, color: sectionColor }}>{rec.count.toLocaleString('de-DE')}</span>
              <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{t.artikelBetroffen}</span>
            </>
          ) : (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              background: PALETTE.surface, color: PALETTE.textMuted,
              border: `1px solid ${PALETTE.border}`,
            }}>
              – {t.optional}
            </span>
          )}
          <span style={{ fontSize: 14, color: PALETTE.textMuted, transform: open ? 'rotate(90deg)' : 'none', transition: '0.2s' }}>›</span>
        </div>
      </div>
      {open && rec.examples && rec.examples.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${PALETTE.border}` }}>
          {rec.examples.slice(0, 5).map((ex, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '4px 8px', background: PALETTE.surface,
              borderRadius: 6, marginBottom: 4, color: PALETTE.textPrimary,
            }}>
              {ex.ean && <strong>{ex.ean}</strong>}{ex.name && ` · ${ex.name}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ label, count, subtitle, color, bg, accent, open, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', cursor: 'pointer', background: PALETTE.cardBg,
        borderRadius: 12, border: `1px solid ${PALETTE.border}`,
        marginBottom: open ? 0 : 8,
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: '50%', background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, color: accent, fontWeight: 800 }}>!</span>
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color }}>{count}</span>
      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: bg, color }}>{subtitle}</span>
      <span style={{ marginLeft: 'auto', fontSize: 16, color: PALETTE.textMuted, transform: open ? 'rotate(90deg)' : 'none', transition: '0.2s' }}>›</span>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export function McAngebotsfeed() {
  // ── State ──
  const [step, setStep] = useState(1);
  const [lang, setLang] = useState("de");
  const [langOpen, setLangOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [manualMapping, setManualMapping] = useState({});
  const fileRef = useRef(null);

  // Step 3/4 expansions
  const [expandedFieldExamples, setExpandedFieldExamples] = useState(new Set());

  // Step 4 image features
  const [selectedImageBucket, setSelectedImageBucket] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Step 5 recommendations
  const [expandedRecs, setExpandedRecs] = useState(new Set());
  const [allSectionsCollapsed, setAllSectionsCollapsed] = useState(false);
  const [pflichtOpen, setPflichtOpen] = useState(true);
  const [optionalOpen, setOptionalOpen] = useState(true);
  const [hinweiseOpen, setHinweiseOpen] = useState(true);

  const t = T[lang];

  // ── Lightbox keyboard navigation ──
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowLeft') setLightboxIndex(i => (i - 1 + lightboxImages.length) % lightboxImages.length);
      if (e.key === 'ArrowRight') setLightboxIndex(i => (i + 1) % lightboxImages.length);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen, lightboxImages.length]);

  // ── Parse file ──
  function parseFile(f) {
    if (!f) return;
    setFile(f);
    setRows([]); setHeaders([]); setManualMapping({});
    const tryParseMc = (encoding) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result;
        if (typeof text !== 'string') return;
        if (encoding === 'UTF-8' && (/Ã¤|Ã¶|Ã¼/.test(text) || text.includes('ï¿½'))) {
          tryParseMc('windows-1252'); return;
        }
        Papa.parse(text, {
          header: true, skipEmptyLines: true, relaxColumnCount: true,
          complete: (res) => {
            const r = Array.isArray(res.data) ? res.data : [];
            const h = res.meta?.fields || Object.keys(r[0] || {});
            setHeaders(h); setRows(r); setStep(2);
          }
        });
      };
      reader.readAsText(f, encoding);
    };
    tryParseMc('UTF-8');
  }

  // ── Mapping logic ──
  const mcAutoMapping = useMemo(() => {
    if (!headers.length) return {};
    const m = {};
    for (const key of MC_PFLICHT_COLS) {
      if (key === 'image_url') continue;
      m[key] = bestHeaderMatch(headers, MC_PFLICHT_ALIASES[key] || [key]) || null;
    }
    for (const key of MC_OPTIONAL_COLS) {
      m[key] = bestHeaderMatch(headers, MC_OPTIONAL_ALIASES[key] || [key]) || null;
    }
    return m;
  }, [headers]);

  const mcContentMapping = useMemo(() => {
    if (!headers.length || !rows.length) return {};
    const allFields = [...MC_PFLICHT_COLS.filter(f => f !== 'image_url'), ...MC_OPTIONAL_COLS];
    const unmapped = allFields.filter(f => !mcAutoMapping[f]);
    if (!unmapped.length) return {};
    return detectFieldByContent(unmapped, headers, rows);
  }, [headers, rows, mcAutoMapping]);

  const mcMapping = useMemo(
    () => ({ ...mcAutoMapping, ...mcContentMapping, ...manualMapping }),
    [mcAutoMapping, mcContentMapping, manualMapping]
  );

  const mcImageColumns = useMemo(
    () => headers.filter(h => { const n = h.toLowerCase(); return n.includes('image') || n.includes('bild') || n.includes('img'); }),
    [headers]
  );

  // ── Analysis ──
  const issues = useMemo(() => {
    if (!rows.length || !headers.length) return null;

    const missingPflichtCols = MC_PFLICHT_COLS.filter(c => {
      if (c === 'image_url') return mcImageColumns.length === 0;
      const DIM_PFLICHT = ['size', 'size_height', 'size_depth', 'size_diameter'];
      if (DIM_PFLICHT.includes(c)) return !DIM_PFLICHT.some(k => !!mcMapping[k]);
      return !mcMapping[c];
    });
    const missingOptionalCols = MC_OPTIONAL_COLS.filter(c => !mcMapping[c]);

    const pflichtErrors = [];
    const optionalHints = [];
    const duplicateEans = {}, duplicateNameEans = {};
    let pflichtOkCount = 0, totalOptionalFieldsPresent = 0;
    const optionalFieldCount = MC_OPTIONAL_COLS.length + 9;
    const pflichtErrorRowNums = new Set();

    rows.forEach((row, i) => {
      const rn = i + 1;
      const ean = mcMapping.ean ? String(row[mcMapping.ean] ?? '').trim() : '';
      const name = mcMapping.name ? String(row[mcMapping.name] ?? '').trim() : '';
      let pflichtOk = true;
      let optionalFieldsPresent = 0;

      for (const key of MC_PFLICHT_COLS) {
        if (key === 'image_url') continue;
        const col = mcMapping[key];
        if (!col) continue;
        const val = String(row[col] ?? '').trim();
        if (!val) { pflichtErrors.push({ row: rn, ean, field: key, type: 'missing' }); pflichtOk = false; continue; }
        if (key === 'ean' && !/^\d{8,14}$/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: 'invalid', value: val }); pflichtOk = false; }
        if (key === 'price') {
          if (/^[€$£]/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: 'invalid_currency', value: val }); pflichtOk = false; }
          else { const n = parseFloat(val.replace(',', '.')); if (isNaN(n) || n <= 0) { pflichtErrors.push({ row: rn, ean, field: key, type: 'invalid', value: val }); pflichtOk = false; } }
        }
        if (key === 'stock_amount' && !/^\d+$/.test(val)) { pflichtErrors.push({ row: rn, ean, field: key, type: 'invalid', value: val }); pflichtOk = false; }
        if (key === 'shipping_mode' && val.toLowerCase() !== 'paket' && val.toLowerCase() !== 'spedition') { pflichtErrors.push({ row: rn, ean, field: key, type: 'invalid', value: val }); pflichtOk = false; }
      }

      if (mcImageColumns.length > 0) {
        const imgCount = mcImageColumns.reduce((c, col) => c + (String(row[col] ?? '').trim() ? 1 : 0), 0);
        if (imgCount === 0) { pflichtErrors.push({ row: rn, ean, field: 'image_url', type: 'missing' }); pflichtOk = false; }
        else {
          const firstImgVal = String(row[mcImageColumns[0]] ?? '').trim();
          if (firstImgVal && !/^https?:\/\//i.test(firstImgVal)) { pflichtErrors.push({ row: rn, ean, field: 'image_url', type: 'invalid_url', value: firstImgVal }); pflichtOk = false; }
        }
      }

      for (const key of MC_OPTIONAL_COLS) {
        const col = mcMapping[key];
        if (!col) continue;
        if (!String(row[col] ?? '').trim()) { optionalHints.push({ row: rn, ean, field: key }); }
        else { optionalFieldsPresent++; }
      }
      const extraImageCols = mcImageColumns.slice(1, 10);
      optionalFieldsPresent += extraImageCols.filter(col => String(row[col] ?? '').trim()).length;

      if (ean) { if (!duplicateEans[ean]) duplicateEans[ean] = []; duplicateEans[ean].push(rn); }
      if (name && ean) { const k = `${name}|||${ean}`; if (!duplicateNameEans[k]) duplicateNameEans[k] = []; duplicateNameEans[k].push(rn); }

      if (pflichtOk) { pflichtOkCount++; } else { pflichtErrorRowNums.add(rn); }
      totalOptionalFieldsPresent += optionalFieldsPresent;
    });

    const UNIT_EXTRACT_RE = /\b\d+(?:[.,]\d+)?\s*(mm|cm)\b/gi;
    const mixedUnitErrors = [];
    for (const key of ['size', 'size_height', 'size_depth', 'size_diameter']) {
      const col = mcMapping[key];
      if (!col) continue;
      const unitsFound = new Set();
      for (const r of rows) {
        UNIT_EXTRACT_RE.lastIndex = 0;
        let m;
        while ((m = UNIT_EXTRACT_RE.exec(String(r[col] ?? ''))) !== null) unitsFound.add(m[1].toLowerCase());
        if (unitsFound.size > 1) break;
      }
      if (unitsFound.size > 1) mixedUnitErrors.push({ col, units: [...unitsFound] });
    }

    const dupEanCount = Object.values(duplicateEans).filter(r => r.length > 1).reduce((s, r) => s + r.length, 0);
    const eanDupRows = new Set(Object.values(duplicateEans).filter(r => r.length > 1).flat());
    const livefaehigCount = rows.filter((_, i) => !pflichtErrorRowNums.has(i + 1) && !eanDupRows.has(i + 1)).length;
    const dupNameEanCount = Object.values(duplicateNameEans).filter(r => r.length > 1).reduce((s, r) => s + r.length, 0);

    const pflichtScore = rows.length ? Math.round((pflichtOkCount / rows.length) * 70) : 0;
    const optionalFillRatio = rows.length && optionalFieldCount > 0 ? (totalOptionalFieldsPresent / (rows.length * optionalFieldCount)) : 0;
    const optionalScore = Math.round(optionalFillRatio * 30);
    const totalScore = Math.max(0, Math.min(100, pflichtScore + optionalScore));

    return {
      totalRows: rows.length,
      pflichtMapping: MC_PFLICHT_COLS.reduce((m, k) => { m[k] = k === 'image_url' ? (mcImageColumns[0] || null) : (mcMapping[k] || null); return m; }, {}),
      optionalMapping: MC_OPTIONAL_COLS.reduce((m, k) => { m[k] = mcMapping[k] || null; return m; }, {}),
      imageColumns: mcImageColumns,
      missingPflichtCols, missingOptionalCols,
      pflichtErrors, optionalHints,
      pflichtOkCount, livefaehigCount, blockiertCount: rows.length - livefaehigCount,
      totalOptionalFieldsPresent, optionalFieldCount,
      dupEanCount, dupNameEanCount,
      mixedUnitErrors,
      pflichtScore, optionalScore, optionalFillRatio, totalScore,
    };
  }, [rows, headers, mcMapping, mcImageColumns]);

  // ── Step 5 computed values ──
  const pflichtPct = issues ? Math.round((issues.pflichtOkCount / issues.totalRows) * 100) : 0;
  const optPct = issues ? Math.round(issues.optionalFillRatio * 100) : 0;
  const pflichtComplete = issues ? issues.pflichtOkCount : 0;
  const pflichtIncomplete = issues ? issues.blockiertCount : 0;
  const optComplete = issues ? Math.round(issues.optionalFillRatio * issues.totalRows) : 0;
  const optGaps = issues ? (issues.totalRows - optComplete) : 0;

  // ── Short descriptions ──
  const shortDescDE = {
    'name::missing': 'Eindeutiger und aussagekräftiger Titel ist erforderlich',
    'image_url::missing': 'Mindestens ein Produktbild ist erforderlich',
    'description::missing': 'Detaillierte Beschreibung des Artikels ist erforderlich',
    'ean::missing': 'Gültige EAN zur eindeutigen Identifikation ist erforderlich',
    'brand::missing': 'Angabe der Marke ist erforderlich',
    'shipping_mode::missing': 'Versandart und -kosten müssen angegeben werden',
    'shipping_mode::invalid': 'Versandart muss "Paket" oder "Spedition" sein',
    'ean::invalid': 'EAN entspricht nicht der erforderlichen Länge',
    'description::too_short': 'Beschreibung enthält zu wenig Informationen',
    'name::dup': 'Doppelte Artikelnamen gefunden',
    'ean::dup': 'Doppelte EANs gefunden',
    'price::missing': 'Preis fehlt',
    'price::invalid': 'Preis hat ein ungültiges Format',
    'availability::missing': 'Verfügbarkeit fehlt',
    'stock_amount::missing': 'Bestand fehlt',
    'delivery_time::missing': 'Lieferzeit fehlt',
    'delivery_includes::missing': 'Lieferumfang fehlt',
    'color::missing': 'Farbangabe erhöht die Auffindbarkeit',
    'material::missing': 'Materialangabe verbessert die Filterbarkeit',
    'category_path::missing': 'Kategoriepfad ist erforderlich',
    'seller_offer_id::missing': 'Eigene Artikel-ID fehlt',
    'manufacturer_name::missing': 'Herstellername ist erforderlich',
    'manufacturer_email::missing': 'Hersteller-E-Mail ist erforderlich',
  };
  const shortDescEN = {
    'name::missing': 'A unique and descriptive product name is required',
    'image_url::missing': 'At least one product image is required',
    'description::missing': 'A detailed product description is required',
    'ean::missing': 'A valid EAN for unique identification is required',
    'brand::missing': 'Brand information is required',
    'shipping_mode::missing': 'Shipping method and cost must be specified',
    'shipping_mode::invalid': 'Shipping mode must be "Paket" or "Spedition"',
    'ean::invalid': 'EAN does not match the required length',
    'description::too_short': 'Description contains too little information',
    'name::dup': 'Duplicate product names found',
    'ean::dup': 'Duplicate EANs found',
    'price::missing': 'Price is missing',
    'price::invalid': 'Price has an invalid format',
    'availability::missing': 'Availability is missing',
    'stock_amount::missing': 'Stock is missing',
    'delivery_time::missing': 'Delivery time is missing',
    'delivery_includes::missing': 'Delivery includes is missing',
    'color::missing': 'Color information improves findability',
    'material::missing': 'Material information improves filterability',
    'category_path::missing': 'Category path is required',
    'seller_offer_id::missing': 'Seller offer ID is missing',
    'manufacturer_name::missing': 'Manufacturer name is required',
    'manufacturer_email::missing': 'Manufacturer email is required',
  };
  const shortDescMap = lang === 'de' ? shortDescDE : shortDescEN;

  // ── Recommendation data ──
  const pflichtRecs = useMemo(() => {
    if (!issues) return [];
    const grouped = {};
    issues.pflichtErrors.forEach(e => {
      const key = `${e.field}::${e.type}`;
      if (!grouped[key]) grouped[key] = { field: e.field, type: e.type, examples: [], rows: new Set() };
      if (!grouped[key].rows.has(e.row)) {
        grouped[key].rows.add(e.row);
        const r = rows[e.row - 1];
        const ean = e.ean || '';
        const name = mcMapping.name ? String(r?.[mcMapping.name] ?? '').trim().slice(0, 30) : '';
        grouped[key].examples.push({ ean, name });
      }
    });
    if (issues.dupEanCount > 0) {
      const key = 'ean::dup';
      if (!grouped[key]) grouped[key] = { field: 'ean', type: 'dup', examples: [], rows: new Set() };
      issues.pflichtErrors.filter(e => e.field === 'ean' && e.type === 'invalid').forEach(e => {
        grouped[key].examples.push({ ean: e.ean || '', name: '' });
      });
    }
    return Object.entries(grouped).map(([key, v]) => ({
      id: key,
      field: v.field, type: v.type,
      count: v.rows.size,
      examples: v.examples,
      shortDesc: shortDescMap[key] || key,
    })).filter(r => r.count > 0);
  }, [issues, rows, mcMapping, lang]);

  const optionalRecs = useMemo(() => {
    if (!issues) return [];
    const grouped = {};
    issues.optionalHints.forEach(e => {
      const key = `${e.field}::missing`;
      if (!grouped[key]) grouped[key] = { field: e.field, examples: [], rows: new Set() };
      if (!grouped[key].rows.has(e.row)) {
        grouped[key].rows.add(e.row);
        const r = rows[e.row - 1];
        const name = mcMapping.name ? String(r?.[mcMapping.name] ?? '').trim().slice(0, 30) : '';
        grouped[key].examples.push({ ean: e.ean || '', name });
      }
    });
    return Object.entries(grouped).map(([key, v]) => ({
      id: key, field: v.field, type: 'missing',
      count: v.rows.size,
      examples: v.examples,
      shortDesc: shortDescMap[key] || FL[lang][v.field] || v.field,
    })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
  }, [issues, rows, mcMapping, lang]);

  const hintRecs = useMemo(() => {
    if (!issues) return [];
    const recs = [];
    const singleImgCount = rows.filter(r => {
      const c = mcImageColumns.filter(col => String(r[col] ?? '').trim()).length;
      return c === 1;
    }).length;
    if (singleImgCount > 0) recs.push({
      id: 'image_url::single', field: 'image_url', type: 'single',
      count: singleImgCount, examples: [],
      shortDesc: lang === 'de' ? 'Weitere Produktbilder können die Conversion steigern' : 'Additional product images can increase conversion',
    });
    const sizeMissingCount = (mcMapping.size || mcMapping.size_height || mcMapping.size_depth) ?
      rows.filter(r => {
        const dimCols = ['size', 'size_height', 'size_depth', 'size_diameter'].map(k => mcMapping[k]).filter(Boolean);
        return dimCols.every(col => !String(r[col] ?? '').trim());
      }).length : 0;
    if (sizeMissingCount > 0) recs.push({
      id: 'size::missing', field: 'size', type: 'missing',
      count: sizeMissingCount, examples: [],
      shortDesc: lang === 'de' ? 'Maße (z. B. Länge, Breite, Höhe) ergänzen' : 'Add dimensions (e.g. length, width, height)',
    });
    const lampRe = /\b(lampe|leuchte[n]?|licht|beleuchtung|led)\b/i;
    const lightingCount = mcMapping.name ? rows.filter(r => lampRe.test(String(r[mcMapping.name] ?? ''))).length : 0;
    if (lightingCount > 0) recs.push({
      id: 'energy::missing', field: 'energy_efficiency_category', type: 'missing',
      count: lightingCount, examples: [],
      shortDesc: lang === 'de' ? 'Energieeffizienzklasse hinzufügen' : 'Add energy efficiency class',
    });
    recs.push({
      id: 'quality::title', field: 'name', type: 'quality',
      count: null, examples: [],
      shortDesc: lang === 'de' ? 'Titel noch aussagekräftiger gestalten' : 'Make titles more descriptive',
    });
    recs.push({
      id: 'quality::desc', field: 'description', type: 'quality',
      count: null, examples: [],
      shortDesc: lang === 'de' ? 'Beschreibung noch informativer gestalten' : 'Make descriptions more informative',
    });
    return recs;
  }, [issues, rows, mcMapping, mcImageColumns, lang]);

  // ── CSV download ──
  function downloadCSV() {
    if (!issues) return;
    const pflichtByRow = {}, optionalByRow = {};
    issues.pflichtErrors.forEach(e => {
      if (!pflichtByRow[e.row]) pflichtByRow[e.row] = [];
      const msg = e.type === 'invalid_currency' ? `${e.field} enthält Währungssymbol` : e.type === 'invalid' ? `${e.field} ungültig` : `${e.field} fehlt`;
      pflichtByRow[e.row].push(msg);
    });
    issues.optionalHints.forEach(e => {
      if (!optionalByRow[e.row]) optionalByRow[e.row] = [];
      optionalByRow[e.row].push(e.field + ' fehlt');
    });
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const sep = ';';
    const headerRow = ['Fehler Pflichtfelder', 'Fehler Optionale Felder', ...headers].map(esc).join(sep);
    const lines = rows.map((r, i) => {
      const rn = i + 1;
      const p = pflichtByRow[rn] ? [...new Set(pflichtByRow[rn])].join('; ') : '';
      const o = optionalByRow[rn] ? [...new Set(optionalByRow[rn])].join('; ') : '';
      return [esc(p), esc(o), ...headers.map(h => esc(r[h]))].join(sep);
    });
    const csv = [headerRow, ...lines].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feed-fehlerliste-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Step wizard header ──
  const stepLabels = [t.step1, t.step2, t.step3, t.step4, t.step5];

  function WizardHeader() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24, background: PALETTE.cardBg, borderRadius: 12, padding: '12px 16px', border: `1px solid ${PALETTE.border}` }}>
        {stepLabels.map((label, idx) => {
          const s = idx + 1;
          const isActive = s === step;
          const isDone = s < step;
          return (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
                  background: isActive ? MC_BLUE : isDone ? PALETTE.greenAccent : PALETTE.surface,
                  color: isActive || isDone ? '#FFF' : PALETTE.textMuted,
                  border: `2px solid ${isActive ? MC_BLUE : isDone ? PALETTE.greenAccent : PALETTE.border}`,
                }}>
                  {isDone ? '✓' : s}
                </div>
                <span style={{
                  fontSize: 13, fontWeight: isActive ? 700 : 400,
                  color: isActive ? PALETTE.textPrimary : PALETTE.textMuted,
                  whiteSpace: 'nowrap',
                }}>{label}</span>
              </div>
              {idx < stepLabels.length - 1 && (
                <div style={{ flex: 1, height: 1, background: PALETTE.border, margin: '0 8px', minWidth: 8 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Nav buttons ──
  function NavButtons({ canNext = true, onNext }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
        {step > 1 ? (
          <button onClick={() => setStep(s => s - 1)}
            style={{ padding: '10px 20px', borderRadius: 8, border: `1px solid ${PALETTE.border}`, background: PALETTE.cardBg, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: PALETTE.textPrimary }}>
            {t.back}
          </button>
        ) : <div />}
        {step < 5 && (
          <button
            onClick={onNext || (() => setStep(s => s + 1))}
            disabled={!canNext}
            style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: canNext ? MC_BLUE : PALETTE.border, color: '#FFF', fontSize: 14, fontWeight: 700, cursor: canNext ? 'pointer' : 'not-allowed', opacity: canNext ? 1 : 0.6 }}>
            {t.next}
          </button>
        )}
      </div>
    );
  }

  // ── STEP 1: Upload ──
  function Step1() {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ background: PALETTE.cardBg, borderRadius: 16, padding: 32, border: `1px solid ${PALETTE.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: PALETTE.textPrimary, margin: '0 0 8px' }}>{t.title}</h2>
          <p style={{ fontSize: 14, color: PALETTE.textMuted, margin: '0 0 24px' }}>{t.uploadSub}</p>
          {file && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, border: `1px solid ${PALETTE.border}`, background: PALETTE.surface, fontSize: 13, color: PALETTE.textPrimary }}>
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) parseFile(f); }}
            onClick={() => fileRef.current?.click()}
            style={{
              background: dragging ? PALETTE.blueBg : PALETTE.surface,
              border: `2px dashed ${dragging ? PALETTE.blueAccent : PALETTE.border}`,
              borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: PALETTE.textPrimary, marginBottom: 6 }}>{t.uploadPrompt}</div>
            <div style={{ fontSize: 13, color: PALETTE.textMuted }}>{t.uploadSub}</div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => parseFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <NavButtons canNext={rows.length > 0} />
      </div>
    );
  }

  // ── STEP 2: Mapping ──
  function Step2() {
    const allFields = [...MC_PFLICHT_COLS.filter(f => f !== 'image_url'), ...MC_OPTIONAL_COLS];
    const totalFields = allFields.length + 1;
    const foundFields = allFields.filter(f => mcMapping[f]).length + (mcImageColumns.length > 0 ? 1 : 0);

    return (
      <div>
        <div style={{ background: PALETTE.cardBg, borderRadius: 16, padding: 24, border: `1px solid ${PALETTE.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: PALETTE.textPrimary, margin: 0 }}>
                {lang === 'de' ? 'Spalten-Zuordnung' : 'Column Mapping'}
              </h3>
              <div style={{ fontSize: 13, color: PALETTE.textMuted, marginTop: 4 }}>
                {foundFields}/{totalFields} {lang === 'de' ? 'erkannt' : 'detected'}
              </div>
            </div>
            {file && (
              <div style={{ fontSize: 12, color: PALETTE.textMuted, background: PALETTE.surface, padding: '6px 10px', borderRadius: 6, border: `1px solid ${PALETTE.border}` }}>
                {file.name}
              </div>
            )}
          </div>

          {/* Image columns */}
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: PALETTE.surface, borderRadius: 8, border: `1px solid ${PALETTE.border}` }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.textMuted, width: 180, flexShrink: 0 }}>
              {lang === 'de' ? 'Bild-Spalten' : 'Image columns'} *
            </span>
            <span style={{ fontSize: 12, color: mcImageColumns.length > 0 ? PALETTE.greenText : PALETTE.redText, fontWeight: 600 }}>
              {mcImageColumns.length > 0 ? mcImageColumns.join(', ') : '–'}
            </span>
          </div>

          <div style={{ display: 'grid', gap: 4, maxHeight: 480, overflowY: 'auto' }}>
            {allFields.filter(f => mcMapping[f] || MC_PFLICHT_COLS.includes(f)).map(f => {
              const isPflicht = MC_PFLICHT_COLS.includes(f);
              const col = mcMapping[f];
              const missing = !col && isPflicht;
              const isManual = f in manualMapping;
              return (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: PALETTE.textPrimary, width: 180, flexShrink: 0 }}>
                    {FL[lang][f] || f}{isPflicht && <span style={{ color: PALETTE.redText, marginLeft: 2 }}>*</span>}
                  </span>
                  <select
                    value={col || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setManualMapping(prev => {
                        const next = { ...prev };
                        if (val === '') delete next[f]; else next[f] = val;
                        return next;
                      });
                    }}
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: `1px solid ${missing ? PALETTE.redAccent : PALETTE.border}`, background: PALETTE.cardBg, cursor: 'pointer' }}
                  >
                    <option value="">{lang === 'de' ? '-- Nicht zugeordnet --' : '-- Not mapped --'}</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  {isManual && (
                    <button type="button" onClick={() => setManualMapping(prev => { const next = { ...prev }; delete next[f]; return next; })}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${PALETTE.border}`, background: PALETTE.surface, color: PALETTE.textMuted, cursor: 'pointer' }}>↩</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <NavButtons canNext={true} />
      </div>
    );
  }

  // ── STEP 3: Pflichtfelder ──
  function Step3() {
    if (!issues) return <div style={{ color: PALETTE.textMuted, padding: 24 }}>{lang === 'de' ? 'Keine Daten geladen.' : 'No data loaded.'}</div>;

    // Build per-field stats
    const fieldStats = MC_PFLICHT_COLS.map(field => {
      const notMapped = field === 'image_url' ? mcImageColumns.length === 0 : !mcMapping[field];
      const errRows = notMapped ? [] :
        [...new Set(issues.pflichtErrors.filter(e => e.field === field).map(e => e.row))];
      const total = issues.totalRows;
      const errs = errRows.length;
      const pct = total > 0 ? Math.round(((total - errs) / total) * 100) : 100;
      const examples = issues.pflichtErrors
        .filter(e => e.field === field)
        .reduce((acc, e) => {
          if (!acc.find(x => x.ean === e.ean)) {
            const r = rows[e.row - 1];
            const name = mcMapping.name ? String(r?.[mcMapping.name] ?? '').trim().slice(0, 30) : '';
            acc.push({ ean: e.ean || '', name });
          }
          return acc;
        }, []);
      return { field, notMapped, errs, pct, total, examples };
    });

    // Sort: notMapped → 3000, errs > 0 → pct (lowest first), 100% → 2000+pct
    const sortKey = f => {
      if (f.notMapped) return 3000;
      if (f.errs > 0) return f.pct;
      return 2000 + f.pct;
    };
    fieldStats.sort((a, b) => sortKey(a) - sortKey(b));

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: PALETTE.textPrimary, margin: '0 0 4px' }}>{t.pflichtfelder}</h2>
          <div style={{ fontSize: 13, color: PALETTE.textMuted }}>
            {issues.pflichtOkCount.toLocaleString('de-DE')} / {issues.totalRows.toLocaleString('de-DE')} {t.listbar} ({pflichtPct} %)
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {fieldStats.map(({ field, notMapped, errs, pct, total, examples }) => {
            const statusBg = errs > 0 ? PALETTE.redBg : pct === 100 ? PALETTE.greenBg : PALETTE.yellowBg;
            const statusText = errs > 0 ? PALETTE.redText : pct === 100 ? PALETTE.greenText : PALETTE.yellowText;
            const exKey = `${field}::pflicht`;
            const isExpanded = expandedFieldExamples.has(exKey);
            const visibleExamples = isExpanded ? examples : examples.slice(0, 2);

            return (
              <div key={field} style={{ background: PALETTE.cardBg, borderRadius: 10, border: `1px solid ${PALETTE.border}`, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: errs > 0 ? 8 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: PALETTE.textPrimary }}>{FL[lang][field] || field}</span>
                      {notMapped && (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: PALETTE.surface, color: PALETTE.textMuted, border: `1px solid ${PALETTE.border}` }}>
                          {lang === 'de' ? 'nicht zugeordnet' : 'not mapped'}
                        </span>
                      )}
                    </div>
                    {!notMapped && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: PALETTE.surface, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? PALETTE.greenAccent : errs > 0 ? PALETTE.redAccent : PALETTE.yellowAccent, borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: statusText, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: statusBg, color: statusText }}>
                      {notMapped ? '–' : errs > 0 ? `${errs.toLocaleString('de-DE')} ${lang === 'de' ? 'Fehler' : 'errors'}` : '✓'}
                    </span>
                  </div>
                </div>

                {errs > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {visibleExamples.map((ex, i) => (
                        <span key={i} style={{
                          background: PALETTE.surface, border: `1px solid ${PALETTE.border}`,
                          borderRadius: 6, padding: '2px 8px', fontSize: 10,
                          maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: PALETTE.textPrimary,
                        }}>
                          {ex.ean && <strong>{ex.ean}</strong>}{ex.name ? ` · ${ex.name}` : ''}
                        </span>
                      ))}
                      {examples.length > 2 && (
                        <button onClick={() => {
                          setExpandedFieldExamples(prev => {
                            const next = new Set(prev);
                            if (next.has(exKey)) next.delete(exKey); else next.add(exKey);
                            return next;
                          });
                        }} style={{ fontSize: 10, color: PALETTE.blueText, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', marginLeft: 4 }}>
                          {isExpanded ? (lang === 'de' ? 'weniger anzeigen' : 'show less') : `+ ${examples.length - 2} ${lang === 'de' ? 'weitere anzeigen' : 'more'}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <NavButtons canNext={true} />
      </div>
    );
  }

  // ── STEP 4: Optionale Felder + Image Analysis ──
  function Step4() {
    if (!issues) return <div style={{ color: PALETTE.textMuted, padding: 24 }}>{lang === 'de' ? 'Keine Daten geladen.' : 'No data loaded.'}</div>;

    const fieldStats = MC_OPTIONAL_COLS.map(field => {
      const notMapped = !mcMapping[field];
      const errRows = notMapped ? [] :
        [...new Set(issues.optionalHints.filter(e => e.field === field).map(e => e.row))];
      const total = issues.totalRows;
      const errs = errRows.length;
      const pct = total > 0 ? Math.round(((total - errs) / total) * 100) : 100;
      const examples = issues.optionalHints
        .filter(e => e.field === field)
        .reduce((acc, e) => {
          if (!acc.find(x => x.ean === e.ean)) {
            const r = rows[e.row - 1];
            const name = mcMapping.name ? String(r?.[mcMapping.name] ?? '').trim().slice(0, 30) : '';
            acc.push({ ean: e.ean || '', name });
          }
          return acc;
        }, []);
      return { field, notMapped, errs, pct, total, examples };
    });

    const sortKey = f => {
      if (f.notMapped) return 3000;
      if (f.errs > 0) return f.pct;
      return 2000 + f.pct;
    };
    fieldStats.sort((a, b) => sortKey(a) - sortKey(b));

    // Image distribution
    const imgDist = {};
    rows.forEach(r => {
      const c = mcImageColumns.filter(col => String(r[col] ?? '').trim()).length;
      imgDist[c] = (imgDist[c] || 0) + 1;
    });

    const sampleRows = rows
      .filter(r => {
        const c = mcImageColumns.filter(col => String(r[col] ?? '').trim()).length;
        return selectedImageBucket === null || c === selectedImageBucket;
      }).slice(0, 3);

    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: PALETTE.textPrimary, margin: '0 0 4px' }}>{t.optionaleFelder}</h2>
          <div style={{ fontSize: 13, color: PALETTE.textMuted }}>
            {optPct} % {lang === 'de' ? 'Abdeckung' : 'coverage'}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6, marginBottom: 24 }}>
          {fieldStats.map(({ field, notMapped, errs, pct, total, examples }) => {
            const statusBg = notMapped ? PALETTE.surface : errs === 0 ? PALETTE.greenBg : PALETTE.orangeBg;
            const statusText = notMapped ? PALETTE.textMuted : errs === 0 ? PALETTE.greenText : PALETTE.orangeText;
            const exKey = `${field}::optional`;
            const isExpanded = expandedFieldExamples.has(exKey);
            const visibleExamples = isExpanded ? examples : examples.slice(0, 2);

            return (
              <div key={field} style={{ background: PALETTE.cardBg, borderRadius: 10, border: `1px solid ${PALETTE.border}`, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: errs > 0 && !notMapped ? 8 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: PALETTE.textPrimary }}>{FL[lang][field] || field}</span>
                      {notMapped && (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: PALETTE.surface, color: PALETTE.textMuted, border: `1px solid ${PALETTE.border}` }}>
                          {lang === 'de' ? 'nicht im Feed' : 'not in feed'}
                        </span>
                      )}
                    </div>
                    {!notMapped && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: PALETTE.surface, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? PALETTE.greenAccent : PALETTE.orangeAccent, borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: statusText, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: statusBg, color: statusText }}>
                      {notMapped ? '–' : errs > 0 ? `${errs.toLocaleString('de-DE')} ${lang === 'de' ? 'leer' : 'empty'}` : '✓'}
                    </span>
                  </div>
                </div>

                {errs > 0 && !notMapped && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {visibleExamples.map((ex, i) => (
                        <span key={i} style={{
                          background: PALETTE.surface, border: `1px solid ${PALETTE.border}`,
                          borderRadius: 6, padding: '2px 8px', fontSize: 10,
                          maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: PALETTE.textPrimary,
                        }}>
                          {ex.ean && <strong>{ex.ean}</strong>}{ex.name ? ` · ${ex.name}` : ''}
                        </span>
                      ))}
                      {examples.length > 2 && (
                        <button onClick={() => {
                          setExpandedFieldExamples(prev => {
                            const next = new Set(prev);
                            if (next.has(exKey)) next.delete(exKey); else next.add(exKey);
                            return next;
                          });
                        }} style={{ fontSize: 10, color: PALETTE.blueText, background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', marginLeft: 4 }}>
                          {isExpanded ? (lang === 'de' ? 'weniger anzeigen' : 'show less') : `+ ${examples.length - 2} ${lang === 'de' ? 'weitere anzeigen' : 'more'}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Image Analysis */}
        {mcImageColumns.length > 0 && (
          <div style={{ background: PALETTE.cardBg, borderRadius: 16, border: `1px solid ${PALETTE.border}`, padding: 20, marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: PALETTE.textPrimary, margin: '0 0 12px' }}>
              {lang === 'de' ? 'Bildanalyse' : 'Image Analysis'}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <button onClick={() => setSelectedImageBucket(null)}
                style={{
                  padding: '4px 10px', borderRadius: 999,
                  border: selectedImageBucket === null ? `2px solid ${PALETTE.blueAccent}` : `1px solid ${PALETTE.border}`,
                  background: selectedImageBucket === null ? PALETTE.blueBg : PALETTE.surface,
                  fontSize: 12, cursor: 'pointer', color: PALETTE.blueText,
                }}>
                {t.weitereBuckets}: {rows.length}
              </button>
              {Object.entries(imgDist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([cnt, num]) => (
                <button key={cnt} onClick={() => setSelectedImageBucket(Number(cnt))}
                  style={{
                    padding: '4px 10px', borderRadius: 999,
                    border: selectedImageBucket === Number(cnt) ? `2px solid ${PALETTE.blueAccent}` : `1px solid ${PALETTE.border}`,
                    background: selectedImageBucket === Number(cnt) ? PALETTE.blueBg : PALETTE.surface,
                    fontSize: 12, cursor: 'pointer', color: PALETTE.blueText,
                  }}>
                  {cnt} {cnt === '1' ? (lang === 'de' ? 'Bild' : 'Image') : (lang === 'de' ? 'Bilder' : 'Images')}: {num}
                </button>
              ))}
            </div>

            <div>
              {sampleRows.map((r, i) => {
                const imgUrl = mcImageColumns.map(col => String(r[col] ?? '').trim()).find(Boolean) || '';
                const name = mcMapping.name ? String(r[mcMapping.name] ?? '').trim().slice(0, 40) : '';
                const imgCount = mcImageColumns.filter(col => String(r[col] ?? '').trim()).length;
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px', background: PALETTE.surface, borderRadius: 8,
                    border: `1px solid ${PALETTE.border}`, marginBottom: 6,
                  }}>
                    <div style={{ flex: 1, fontSize: 13, color: PALETTE.textPrimary }}>{name || '–'}</div>
                    <span style={{ fontSize: 11, color: PALETTE.textMuted }}>{imgCount} {lang === 'de' ? 'Bilder' : 'images'}</span>
                    {imgUrl && (
                      <img src={imgUrl} alt="" onClick={() => {
                        const urls = mcImageColumns.map(col => String(r[col] ?? '').trim()).filter(Boolean);
                        setLightboxImages(urls); setLightboxIndex(0); setLightboxOpen(true);
                      }}
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', marginLeft: 'auto', border: `1px solid ${PALETTE.border}` }}
                        onMouseOver={e => e.currentTarget.style.outline = `2px solid ${PALETTE.blueAccent}`}
                        onMouseOut={e => e.currentTarget.style.outline = 'none'}
                      />
                    )}
                  </div>
                );
              })}
              {sampleRows.length === 0 && (
                <div style={{ fontSize: 13, color: PALETTE.textMuted, padding: '8px 0' }}>
                  {lang === 'de' ? 'Keine Artikel in diesem Filter.' : 'No items in this filter.'}
                </div>
              )}
            </div>
          </div>
        )}

        <NavButtons canNext={true} />
      </div>
    );
  }

  // ── STEP 5: Results ──
  function Step5() {
    if (!issues) return <div style={{ color: PALETTE.textMuted, padding: 24 }}>{lang === 'de' ? 'Keine Daten geladen.' : 'No data loaded.'}</div>;

    return (
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Left: Recommendations */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: PALETTE.textPrimary, margin: 0 }}>
                {t.handlungsempfehlungen}
              </h2>
              <div style={{ fontSize: 13, color: PALETTE.textMuted, marginTop: 4 }}>
                {pflichtRecs.length} {t.pflichtfelder} · {optionalRecs.length} {t.optionaleFelder} · {hintRecs.length} {t.hinweise}
              </div>
            </div>
            <button onClick={() => {
              const next = !allSectionsCollapsed;
              setAllSectionsCollapsed(next);
              setPflichtOpen(!next); setOptionalOpen(!next); setHinweiseOpen(!next);
            }} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: `1px solid ${PALETTE.border}`, background: PALETTE.cardBg,
              fontSize: 13, cursor: 'pointer', color: PALETTE.textPrimary,
            }}>
              <span style={{ fontSize: 14 }}>{allSectionsCollapsed ? '›' : '⌄'}</span>
              {allSectionsCollapsed ? t.allAusklappen : t.allEinklappen}
            </button>
          </div>

          {/* Pflichtfelder section */}
          <SectionHeader
            label={t.pflichtfelder} count={pflichtRecs.length}
            subtitle={t.verhindern} color={PALETTE.redText} bg={PALETTE.redBg}
            accent={PALETTE.redAccent} open={pflichtOpen} onToggle={() => setPflichtOpen(v => !v)}
          />
          {pflichtOpen && (
            <div style={{ marginBottom: 16, marginTop: 4 }}>
              {pflichtRecs.length === 0 ? (
                <div style={{ fontSize: 13, color: PALETTE.greenText, padding: '12px 16px', background: PALETTE.greenBg, borderRadius: 8 }}>
                  {lang === 'de' ? '✓ Keine Pflichtfeld-Fehler gefunden.' : '✓ No required field errors found.'}
                </div>
              ) : pflichtRecs.map(rec => (
                <RecCard key={rec.id} rec={rec} t={t} lang={lang}
                  sectionColor={PALETTE.redText} sectionBg={PALETTE.redBg} sectionAccent={PALETTE.redAccent} />
              ))}
            </div>
          )}

          {/* Optionale Felder section */}
          <SectionHeader
            label={t.optionaleFelder} count={optionalRecs.length}
            subtitle={t.verbessern} color={PALETTE.orangeText} bg={PALETTE.orangeBg}
            accent={PALETTE.orangeAccent} open={optionalOpen} onToggle={() => setOptionalOpen(v => !v)}
          />
          {optionalOpen && (
            <div style={{ marginBottom: 16, marginTop: 4 }}>
              {optionalRecs.length === 0 ? (
                <div style={{ fontSize: 13, color: PALETTE.greenText, padding: '12px 16px', background: PALETTE.greenBg, borderRadius: 8 }}>
                  {lang === 'de' ? '✓ Alle optionalen Felder sind befüllt.' : '✓ All optional fields are filled.'}
                </div>
              ) : optionalRecs.map(rec => (
                <RecCard key={rec.id} rec={rec} t={t} lang={lang}
                  sectionColor={PALETTE.orangeText} sectionBg={PALETTE.orangeBg} sectionAccent={PALETTE.orangeAccent} />
              ))}
            </div>
          )}

          {/* Hinweise section */}
          <SectionHeader
            label={t.hinweise} count={hintRecs.length}
            subtitle={t.qualitaet} color={PALETTE.blueText} bg={PALETTE.blueBg}
            accent={PALETTE.blueAccent} open={hinweiseOpen} onToggle={() => setHinweiseOpen(v => !v)}
          />
          {hinweiseOpen && (
            <div style={{ marginBottom: 16, marginTop: 4 }}>
              {hintRecs.map(rec => (
                <RecCard key={rec.id} rec={rec} t={t} lang={lang}
                  sectionColor={PALETTE.blueText} sectionBg={PALETTE.blueBg} sectionAccent={PALETTE.blueAccent} />
              ))}
            </div>
          )}
        </div>

        {/* Right: Sidebar */}
        <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 1. Feed-Übersicht */}
          <div style={{ background: PALETTE.cardBg, borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: PALETTE.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t.feedUebersicht}</span>
              <button onClick={() => setStep(3)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', borderRadius: 8, border: `1px solid ${PALETTE.border}`, background: PALETTE.cardBg, fontSize: 12, cursor: 'pointer', color: PALETTE.textPrimary }}>
                {t.detailsAnsehen} <span>›</span>
              </button>
            </div>
            <div style={{ borderTop: `1px solid ${PALETTE.border}` }} />

            {/* Pflichtfeldabdeckung */}
            <div style={{ marginTop: 20, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: PALETTE.textPrimary }}>{t.pflichtfeldabdeckung}</span>
                <span style={{ fontSize: 12, color: PALETTE.textMuted, cursor: 'help' }} title={lang === 'de' ? 'Anteil der Artikel mit vollständigen Pflichtfeldern' : 'Share of items with complete required fields'}>ⓘ</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 12, borderRadius: 6, background: PALETTE.surface, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pflichtPct}%`, background: barColor(pflichtPct), transition: 'width 0.4s', borderRadius: 6 }} />
                </div>
                <span style={{ fontSize: 28, fontWeight: 800, color: textColorForPct(pflichtPct), minWidth: 60, textAlign: 'right' }}>{pflichtPct}%</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: PALETTE.textMuted, flexWrap: 'wrap' }}>
                <span><span style={{ color: PALETTE.greenText, fontWeight: 700 }}>{pflichtComplete.toLocaleString('de-DE')}</span> {t.vollstaendig}</span>
                <span><span style={{ color: PALETTE.orangeText, fontWeight: 700 }}>{pflichtIncomplete.toLocaleString('de-DE')}</span> {t.unvollstaendig}</span>
                <span><span style={{ fontWeight: 700 }}>{(issues?.totalRows || 0).toLocaleString('de-DE')}</span> {t.gesamt}</span>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${PALETTE.border}`, margin: '0 0 20px' }} />

            {/* Optionale Feldabdeckung */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: PALETTE.textPrimary }}>{t.optionaleFeldabdeckung}</span>
                <span style={{ fontSize: 12, color: PALETTE.textMuted, cursor: 'help' }} title={lang === 'de' ? 'Anteil der optionalen Felder die befüllt sind' : 'Share of optional fields that are filled'}>ⓘ</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 12, borderRadius: 6, background: PALETTE.surface, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${optPct}%`, background: barColor(optPct), transition: 'width 0.4s', borderRadius: 6 }} />
                </div>
                <span style={{ fontSize: 28, fontWeight: 800, color: textColorForPct(optPct), minWidth: 60, textAlign: 'right' }}>{optPct}%</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: PALETTE.textMuted, flexWrap: 'wrap' }}>
                <span><span style={{ color: PALETTE.greenText, fontWeight: 700 }}>{optComplete.toLocaleString('de-DE')}</span> {t.vollstaendig}</span>
                <span><span style={{ color: PALETTE.orangeText, fontWeight: 700 }}>{optGaps.toLocaleString('de-DE')}</span> {t.luecken}</span>
                <span><span style={{ fontWeight: 700 }}>{(issues?.totalRows || 0).toLocaleString('de-DE')}</span> {t.gesamt}</span>
              </div>
            </div>
          </div>

          {/* 2. Summary card */}
          <div style={{ background: PALETTE.blueBg, borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: PALETTE.cardBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 22, color: PALETTE.blueAccent }}>↗</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: PALETTE.textPrimary, margin: 0 }}>
                {lang === 'de'
                  ? <>Von <strong>{(issues?.totalRows || 0).toLocaleString('de-DE')}</strong> Artikeln im Feed sind <strong>{pflichtComplete.toLocaleString('de-DE')}</strong> listbar (<strong>{pflichtPct}&nbsp;%</strong>). <strong>{pflichtIncomplete.toLocaleString('de-DE')}</strong> Artikel weisen Fehler in den Pflichtfeldern auf. Mit den Handlungsempfehlungen können Sie die Abdeckung auf bis zu 100&nbsp;% steigern.</>
                  : <>Of <strong>{(issues?.totalRows || 0).toLocaleString('de-DE')}</strong> items in the feed, <strong>{pflichtComplete.toLocaleString('de-DE')}</strong> are listable (<strong>{pflichtPct}&nbsp;%</strong>). <strong>{pflichtIncomplete.toLocaleString('de-DE')}</strong> items have errors in the required fields. With the recommendations below, you can raise coverage up to 100&nbsp;%.</>
                }
              </p>
            </div>
          </div>

          {/* 3. So geht es weiter */}
          <div style={{ background: PALETTE.cardBg, borderRadius: 16, padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PALETTE.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>{t.soGehtEsWeiter}</div>
            <div style={{ borderTop: `1px solid ${PALETTE.border}`, marginBottom: 16 }} />
            {[
              { num: 1, label: t.step1Label, sub: t.step1Sub, icon: '↓' },
              { num: 2, label: t.step2Label, sub: t.step2Sub, icon: '✎' },
              { num: 3, label: t.step3Label, sub: t.step3Sub, icon: '↑' },
            ].map((s, i) => (
              <div key={s.num} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i < 2 ? 16 : 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: PALETTE.blueAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                  {s.num}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: PALETTE.textPrimary }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 2 }}>{s.sub}</div>
                </div>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: PALETTE.blueBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 20, color: PALETTE.blueAccent }}>{s.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 4. CSV card */}
          <div style={{ background: PALETTE.blueBg, borderRadius: 16, padding: '24px', border: `1px solid #BFDBFE` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: PALETTE.blueText, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t.fehlerberichtCsv}</span>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: PALETTE.cardBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 24, color: PALETTE.blueAccent }}>📄</span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: PALETTE.textPrimary, lineHeight: 1.5, margin: '0 0 16px' }}>
              {t.fehlerberichtDesc}
            </p>
            <button onClick={downloadCSV}
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: '#2563EB', color: '#FFF', fontSize: 15, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span>↓</span> {t.fehlerberichtBtn}
            </button>
          </div>

          {/* 5. Footer buttons */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setStep(4)}
              style={{ flex: 1, padding: '14px 24px', borderRadius: 12, border: `1px solid ${PALETTE.border}`, background: PALETTE.cardBg, fontSize: 14, fontWeight: 700, cursor: 'pointer', color: PALETTE.textPrimary }}>
              ← {lang === 'de' ? 'Zurück' : 'Back'}
            </button>
            <button onClick={() => { setFile(null); setRows([]); setHeaders([]); setStep(1); }}
              style={{ flex: 1, padding: '14px 24px', borderRadius: 12, border: 'none', background: PALETTE.blueAccent, color: '#FFF', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {t.neuHochladen}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── LIGHTBOX ──
  function Lightbox() {
    if (!lightboxOpen) return null;
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setLightboxOpen(false)}
      >
        <button onClick={e => { e.stopPropagation(); setLightboxOpen(false); }}
          style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#FFF', fontSize: 18, border: 'none', cursor: 'pointer', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ×
        </button>
        {lightboxImages.length > 1 && (
          <button onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + lightboxImages.length) % lightboxImages.length); }}
            style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#FFF', fontSize: 20, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        )}
        <div style={{ maxWidth: '80vw', maxHeight: '80vh', paddingTop: 64 }} onClick={e => e.stopPropagation()}>
          <img src={lightboxImages[lightboxIndex]} alt=""
            style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }} />
        </div>
        {lightboxImages.length > 1 && (
          <button onClick={e => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % lightboxImages.length); }}
            style={{ position: 'absolute', right: 64, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#FFF', fontSize: 20, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        )}
      </div>
    );
  }

  // ── RENDER ──
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header: title + lang switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: PALETTE.textPrimary, margin: 0 }}>{t.title}</h1>

        {/* PUNKT 1 – Language Dropdown */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button
            onClick={() => setLangOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1px solid ${PALETTE.border}`, background: PALETTE.cardBg, fontSize: 13, cursor: 'pointer', color: PALETTE.textPrimary, whiteSpace: 'nowrap' }}
          >
            <span>{lang === 'de' ? '🇩🇪' : '🇬🇧'}</span>
            <span>{lang === 'de' ? 'Deutsch' : 'English'}</span>
            <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {langOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, width: 'auto', boxSizing: 'border-box', background: PALETTE.cardBg, border: `1px solid ${PALETTE.border}`, borderRadius: 8, zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 4 }}>
              {['de', 'en'].map(l => (
                <button key={l} onClick={() => { setLang(l); setLangOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: l === lang ? PALETTE.textPrimary : PALETTE.textMuted, fontWeight: l === lang ? 700 : 400 }}>
                  <span>{l === 'de' ? '🇩🇪' : '🇬🇧'}</span>
                  <span>{l === 'de' ? 'Deutsch' : 'English'}</span>
                  {l === lang && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Wizard step indicator */}
      <WizardHeader />

      {/* Step content */}
      {step === 1 && <Step1 />}
      {step === 2 && <Step2 />}
      {step === 3 && <Step3 />}
      {step === 4 && <Step4 />}
      {step === 5 && <Step5 />}

      {/* Lightbox */}
      <Lightbox />
    </div>
  );
}

export default McAngebotsfeed;

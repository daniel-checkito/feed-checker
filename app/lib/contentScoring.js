// contentScoring.js — All rules, thresholds, and scoring logic for Content Scoring.
// Edit this file to change how scores are calculated and displayed.

// ─── Column synonyms ──────────────────────────────────────────────────────────
// First match in the feed header wins. Order = priority.

export const COLUMN_SYNONYMS = {
  titel:          ["name", "product_name", "titel", "title"],
  beschreibung:   ["description", "beschreibung", "desc"],
  abmessungen:    ["abmessungen", "size", "dimensions"],
  lieferumfang:   ["lieferumfang", "delivery_includes"],
  herstellerfeed: ["herstellerfeed", "manufacturer", "brand", "marke"],
  ean:            ["ean", "gtin", "gtin14", "ean13", "barcode"],
  material:       ["material", "materials"],
  farbe:          ["color", "farbe"],
};

// Image columns: all headers whose normalised name starts with one of these.
export const IMAGE_COL_PREFIXES = ["image_url", "image", "img_url"];

// ─── Regex patterns ───────────────────────────────────────────────────────────

// Matches dimension values such as "90x200 cm", "1.5m", "30×40", "200 mm"
export const DIM_RE = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m|x|×)/i;

// Matches delivery scope format: "2x Kissen", "1x Matratze" etc.
export const DELIVERY_RE = /^\s*(\d+)\s*[xX]\s+.+/;

// ─── Shop text patterns (checked in description column) ───────────────────────
// Any match → shopbezogene Texte detected → 0 P

export const SHOP_TEXT_PATTERNS = [
  /in unserem (online[- ]?)?shop/i,
  /auf unserer (web[- ]?site|webseite)/i,
  /besuchen sie (uns|unsere)/i,
  /in unserem sortiment/i,
  /andere (farben|varianten|größen|ausführungen|produkte)/i,
  /weitere (farben|varianten|größen|ausführungen)/i,
  /auch erhältlich in/i,
  /klicken sie (hier|auf)/i,
  /finden sie (weitere|mehr|uns|unser|hier)/i,
  /in verschiedenen (farben|größen|varianten)/i,
  /passend dazu|dazu passend/i,
  /passende (produkte|artikel|zubehör|schutzhülle|hülle|unterlage|bezug)/i,
];

// ─── B-Ware / Gebraucht patterns (checked in title + description) ─────────────
// Any match → B-Ware detected → 0 P

export const BWARE_PATTERNS = [
  /\bb[- ]?ware\b/i,
  /\bgebraucht(es?|em|en|er)?\b/i,
  /\brefurbished\b/i,
  /\bgeneralüberholt\b/i,
  /\bgebrauchtware\b/i,
];

// ─── Colour validity ──────────────────────────────────────────────────────────

// Values treated as invalid placeholders (checked after .toLowerCase()).
export const COLOR_BLACKLIST = new Set(["-", "na", "n/a", "none", "kein", "keine", "k.a.", "ka"]);

// Values longer than this are also treated as invalid.
export const COLOR_MAX_LENGTH = 50;

// ─── Scoring thresholds ───────────────────────────────────────────────────────

export const THRESHOLDS = {
  herstellerfeed: {
    full:    { fillRate: 0.8 },                    // → 20 P
  },
  titel: {
    full:    { fillRate: 0.9, avgLen: 40, maxDupRate: 0.08 }, // → 20 P
    partial: { fillRate: 0.8, avgLen: 25 },                   // → 10 P
  },
  beschreibung: {
    full:    { fillRate: 0.85, avgLen: 80 },        // → 10 P
    partial: { fillRate: 0.75, avgLen: 40 },        // → 5 P
  },
  abmessungen: {
    full:    0.6,   // share of non-empty rows matching DIM_RE → 10 P
    partial: 0.3,   //                                         → 5 P
  },
  lieferumfang: {
    full:    { fillRate: 0.7,  fmtRate: 0.7  },    // → 20 P
    partial: { fillRate: 0.4,  fmtRate: 0.35 },    // → 10 P
  },
  material: {
    full:    0.9,   // fill-rate → 10 P; any > 0 → 5 P
  },
  farbe: {
    full:    { fillRate: 0.9, validRate: 0.9 },     // → 10 P
    partial: { fillRate: 0.6, validRate: 0.6 },     // → 5 P
  },
  bildmatch: {
    maxDupRate: 0.15,  // duplicate share of first images; above → 0 P
  },
  freisteller: {
    full:    0.7,   // share of products with white-bg first image → 10 P
    partial: 0.3,   //                                             → 5 P
  },
  millieu: {
    full:    0.6,   // share of products with non-white bg in image 2+ → 10 P
    partial: 0.25,  //                                                  → 5 P
  },
  anzahlbilder: {
    full:    5,     // avg images per product → 10 P
    partial: 2,     //                        → 5 P
  },
};

// ─── Points per tier ──────────────────────────────────────────────────────────

export const POINTS = {
  herstellerfeed: { full: 5,   none: 0  },
  titel:          { full: 20,  partial: 10, none: 0 },
  beschreibung:   { full: 10,  partial: 5,  none: 0 },
  abmessungen:    { full: 10,  partial: 5,  none: 0 },
  lieferumfang:   { full: 20,  partial: 10, none: 0 },
  material:       { full: 10,  partial: 5,  none: 0 },
  farbe:          { full: 10,  partial: 5,  none: 0 },
  shoptexte:      { clean: 10, dirty: 0  },
  bware:          { ok: 10,    found: 0  },
  bildmatch:      { ok: 20,    dup: 0    },
  freisteller:    { full: 10,  partial: 5,  none: 0 },
  millieu:        { full: 10,  partial: 5,  none: 0 },
  anzahlbilder:   { full: 10,  partial: 5,  none: 0 },
};

// ─── Score normalisation ──────────────────────────────────────────────────────
// attributeScore = Math.round((attributeRaw / 105) * 90)  → capped at 90
// imageScore     = Math.ceil((imageRaw / 50) * 90)        → capped at 90
// Guard: attributeScore = 0 when titel = 0; imageScore = 0 when bildmatch = 0

export const NORMALIZATION = {
  attributeMaxRaw: 105,  // 95 base + 10 bware
  imageMaxRaw:     50,
  maxOut:          90,
};

// ─── APA eligibility minimums ─────────────────────────────────────────────────
// ALL conditions must be met simultaneously.

export const APA_MINIMUMS = {
  attributeScore:  70,   // computed score
  imageScore:      60,   // computed score
  titel:           10,
  beschreibung:     5,
  abmessungen:      5,
  lieferumfang:    10,
  material:         5,
  farbe:            5,
  shoptexte:        5,   // in practice requires 10 (no shop texts found)
  bware:           10,   // must be exactly 10 (no B-Ware / Gebraucht found)
  bildmatch:       20,   // must be exactly 20
  freisteller:      5,
  millieu:          5,
  anzahlbilder:     5,
};

// ─── Criteria display (Kriterien dropdown) ────────────────────────────────────

export const ATTRIBUTE_CRITERIA = {
  herstellerfeed: {
    synonyms: COLUMN_SYNONYMS.herstellerfeed,
    tiers: [
      "5 P: Fill-Rate ≥ 80%",
      "0 P: Fill-Rate < 80%",
    ],
  },
  titel: {
    synonyms: COLUMN_SYNONYMS.titel,
    tiers: [
      "20 P: Fill-Rate ≥ 90% · Ø Länge ≥ 40 Zeichen · Duplikat-Rate ≤ 8%",
      "10 P: Fill-Rate ≥ 80% · Ø Länge ≥ 25 Zeichen",
      "0 P: Schwellenwerte nicht erreicht",
    ],
  },
  beschreibung: {
    synonyms: COLUMN_SYNONYMS.beschreibung,
    tiers: [
      "10 P: Fill-Rate ≥ 85% · Ø Länge ≥ 80 Zeichen",
      "5 P: Fill-Rate ≥ 75% · Ø Länge ≥ 40 Zeichen",
      "0 P: Schwellenwerte nicht erreicht",
    ],
  },
  abmessungen: {
    synonyms: COLUMN_SYNONYMS.abmessungen,
    note: 'Regex: Zahl + Einheit/Operator — z.B. "90x200 cm", "1.5m", "30×40", "200 mm"',
    tiers: [
      "10 P: Regex-Treffer in ≥ 60% der befüllten Zeilen",
      "5 P: Regex-Treffer in ≥ 30% der befüllten Zeilen",
      "0 P: Regex-Treffer < 30%",
    ],
  },
  lieferumfang: {
    synonyms: COLUMN_SYNONYMS.lieferumfang,
    note: 'Format "Nx Produkt": Zahl + x/X + Leerzeichen + Text — z.B. "2x Kissen", "1x Matratze"',
    tiers: [
      "20 P: Fill-Rate ≥ 70% · Format-Rate ≥ 70%",
      "10 P: Fill-Rate ≥ 40% · Format-Rate ≥ 35%",
      "0 P: Schwellenwerte nicht erreicht",
    ],
  },
  material: {
    synonyms: COLUMN_SYNONYMS.material,
    tiers: [
      "10 P: Fill-Rate ≥ 90%",
      "5 P: Fill-Rate > 0%",
      "0 P: Spalte leer oder nicht vorhanden",
    ],
  },
  farbe: {
    synonyms: COLUMN_SYNONYMS.farbe,
    note: "Ungültige Werte (zählen nicht): -, na, n/a, none, kein, keine, k.a., ka · oder Länge > 50 Zeichen",
    tiers: [
      "10 P: Fill-Rate ≥ 90% · davon ≥ 90% gültige Werte",
      "5 P: Fill-Rate ≥ 60% · davon ≥ 60% gültig",
      "0 P: Schwellenwerte nicht erreicht",
    ],
  },
  shoptexte: {
    note: 'Scannt die Beschreibungs-Spalte nach Phrasen wie "in unserem Shop", "auf unserer Website", "andere Farben", "passend dazu", "finden Sie weitere" etc.',
    tiers: [
      "10 P: Keine shopbezogenen Phrasen in Beschreibungen gefunden",
      "0 P: Mindestens eine shopbezogene Phrase erkannt",
    ],
  },
  bware: {
    note: 'Scannt Titel und Beschreibung nach "B-Ware", "gebraucht", "refurbished", "generalüberholt"',
    tiers: [
      "10 P: Keine B-Ware / Gebraucht-Hinweise gefunden",
      "0 P: B-Ware oder Gebraucht-Hinweis erkannt",
    ],
  },
};

export const IMAGE_CRITERIA = {
  bildmatch: {
    note: "Geprüft: URL des ersten Bildes — jede URL die > 1× vorkommt zählt als Duplikat · Stichprobe: alle Produkte mit Bild-URL",
    tiers: [
      "20 P: Doppelte Erstbilder ≤ 15% der Stichprobe",
      "0 P: Doppelte Erstbilder > 15%",
    ],
  },
  freisteller: {
    note: "Erkennung: Ø Helligkeit des Randbereichs (10 px) > 240/255 — Stichprobe: erste 20 Produkte",
    tiers: [
      "10 P: ≥ 70% der Stichprobe hat Freisteller (weißer Hintergrund, Bild 1)",
      "5 P: ≥ 30% mit Freisteller",
      "0 P: < 30% Freisteller erkannt",
    ],
  },
  millieu: {
    note: "Erkennung: Bild 2+ mit Ø Randbereich-Helligkeit < 240 (nicht weiß) — Stichprobe: erste 20 Produkte",
    tiers: [
      "10 P: ≥ 60% der Stichprobe hat Milieu-Bild (Bild 2+, farbiger Hintergrund)",
      "5 P: ≥ 25% mit Milieu-Bild",
      "0 P: < 25% Milieu-Bilder erkannt",
    ],
  },
  anzahlbilder: {
    note: "Gezählte Spalten: Spaltenname enthält image_url, image, img_url, bild oder image (z.B. Bildlink_1, image_url_1)",
    tiers: [
      "10 P: Ø ≥ 5 Bilder pro Produkt",
      "5 P: Ø ≥ 2 Bilder pro Produkt",
      "0 P: Ø < 2 Bilder",
    ],
  },
};

// ─── Pure functions ───────────────────────────────────────────────────────────

function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function colByName(headers, candidates) {
  const set = new Set(headers.map((h) => String(h).toLowerCase().trim()));
  for (const cand of candidates) {
    const key = String(cand).toLowerCase().trim();
    if (set.has(key)) return headers.find((h) => String(h).toLowerCase().trim() === key) || "";
  }
  return "";
}

// Detect which feed columns map to each scoring criterion.
// Returns an object of { titleCol, descCol, dimCol, deliveryCol, brandCol, eanCol, materialCol, colorCol, shopCol }.
export function detectColumns(headers) {
  const pick = (key) => colByName(headers, COLUMN_SYNONYMS[key]);
  return {
    titleCol:    pick("titel"),
    descCol:     pick("beschreibung"),
    dimCol:      pick("abmessungen"),
    deliveryCol: pick("lieferumfang"),
    brandCol:    pick("herstellerfeed"),
    eanCol:      pick("ean"),
    materialCol: pick("material"),
    colorCol:    pick("farbe"),
  };
}

// Compute raw score suggestions from feed data (pure — no React).
// qsImageSamples: [{ id, urls: string[] }]
// freistellerChecks: { [id]: { hasFreisteller, hasMilieu, checkedCount } }
export function computeAutoScores({ headers, rows, qsImageSamples = [], freistellerChecks = {}, imageColumns }) {
  if (!headers.length || !rows.length) return null;

  const n = rows.length;

  const cols = detectColumns(headers);
  const { titleCol, descCol, dimCol, deliveryCol, brandCol, materialCol, colorCol, shopCol } = cols;

  function filledRate(col) {
    if (!col) return 0;
    let filled = 0;
    for (const r of rows) { if (safeStr(r?.[col]).trim()) filled += 1; }
    return filled / n;
  }

  function avgLen(col) {
    if (!col) return 0;
    let sum = 0, count = 0;
    for (const r of rows) {
      const v = safeStr(r?.[col]).trim();
      if (!v) continue;
      sum += v.length; count += 1;
    }
    return count ? sum / count : 0;
  }

  // Herstellerfeed
  const herstellerfeed =
    filledRate(brandCol) >= THRESHOLDS.herstellerfeed.full.fillRate
      ? POINTS.herstellerfeed.full
      : POINTS.herstellerfeed.none;

  // Titel
  let titel = POINTS.titel.none;
  if (titleCol) {
    const vals = rows.map((r) => safeStr(r[titleCol]).trim().toLowerCase());
    const filled = vals.filter(Boolean).length;
    const fillRate = filled / n;
    const uniq = new Set(vals.filter(Boolean));
    const dupRate = filled ? 1 - uniq.size / filled : 0;
    const avg = avgLen(titleCol);
    const t = THRESHOLDS.titel;
    if (fillRate >= t.full.fillRate && avg >= t.full.avgLen && dupRate <= t.full.maxDupRate)
      titel = POINTS.titel.full;
    else if (fillRate >= t.partial.fillRate && avg >= t.partial.avgLen)
      titel = POINTS.titel.partial;
  }

  // Beschreibung
  let beschreibung = POINTS.beschreibung.none;
  if (descCol) {
    const t = THRESHOLDS.beschreibung;
    const fillRate = filledRate(descCol);
    const avg = avgLen(descCol);
    if (fillRate >= t.full.fillRate && avg >= t.full.avgLen)       beschreibung = POINTS.beschreibung.full;
    else if (fillRate >= t.partial.fillRate && avg >= t.partial.avgLen) beschreibung = POINTS.beschreibung.partial;
  }

  // Abmessungen — search dimension col + title + desc
  let abmessungen = POINTS.abmessungen.none;
  const dimCandidates = [dimCol, titleCol, descCol].filter(Boolean);
  if (dimCandidates.length) {
    let hits = 0, meaningful = 0;
    for (const r of rows) {
      const blob = dimCandidates.map((c) => safeStr(r[c])).join(" ").trim();
      if (!blob) continue;
      meaningful += 1;
      if (DIM_RE.test(blob)) hits += 1;
    }
    const rate = meaningful ? hits / meaningful : 0;
    if (rate >= THRESHOLDS.abmessungen.full)         abmessungen = POINTS.abmessungen.full;
    else if (rate >= THRESHOLDS.abmessungen.partial) abmessungen = POINTS.abmessungen.partial;
  }

  // Lieferumfang
  let lieferumfang = POINTS.lieferumfang.none;
  if (deliveryCol) {
    let nonEmpty = 0, formatOk = 0;
    for (const r of rows) {
      const v = safeStr(r[deliveryCol]).trim();
      if (!v) continue;
      nonEmpty += 1;
      if (DELIVERY_RE.test(v)) formatOk += 1;
    }
    const fillRate = nonEmpty / n;
    const fmtRate = nonEmpty ? formatOk / nonEmpty : 0;
    const t = THRESHOLDS.lieferumfang;
    if (fillRate >= t.full.fillRate && fmtRate >= t.full.fmtRate)         lieferumfang = POINTS.lieferumfang.full;
    else if (fillRate >= t.partial.fillRate && fmtRate >= t.partial.fmtRate) lieferumfang = POINTS.lieferumfang.partial;
  }

  // Material
  let material = POINTS.material.none;
  if (materialCol) {
    const rate = filledRate(materialCol);
    if (rate >= THRESHOLDS.material.full) material = POINTS.material.full;
    else if (rate > 0)                    material = POINTS.material.partial;
  }

  // Farbe
  let farbe = POINTS.farbe.none;
  if (colorCol) {
    let nonEmpty = 0, valid = 0;
    for (const r of rows) {
      const raw = safeStr(r[colorCol]).trim();
      if (!raw) continue;
      nonEmpty += 1;
      if (!COLOR_BLACKLIST.has(raw.toLowerCase()) && raw.length <= COLOR_MAX_LENGTH) valid += 1;
    }
    const fillRate = n ? nonEmpty / n : 0;
    const validRate = nonEmpty ? valid / nonEmpty : 0;
    const t = THRESHOLDS.farbe;
    if (fillRate >= t.full.fillRate && validRate >= t.full.validRate)         farbe = POINTS.farbe.full;
    else if (fillRate >= t.partial.fillRate && validRate >= t.partial.validRate) farbe = POINTS.farbe.partial;
  }

  // Shoptexte — scan description for cross-selling / shop-reference phrases
  let shoptexte = POINTS.shoptexte.clean;
  if (descCol) {
    for (const r of rows) {
      if (SHOP_TEXT_PATTERNS.some((re) => re.test(safeStr(r[descCol])))) {
        shoptexte = POINTS.shoptexte.dirty;
        break;
      }
    }
  }

  // B-Ware — scan title + description for second-hand / used-goods indicators
  let bware = POINTS.bware.ok;
  const bwareCols = [titleCol, descCol].filter(Boolean);
  outer: for (const r of rows) {
    for (const col of bwareCols) {
      if (BWARE_PATTERNS.some((re) => re.test(safeStr(r[col])))) {
        bware = POINTS.bware.found;
        break outer;
      }
    }
  }

  // Anzahl Bilder — use imageColumns passed from the component (same detection as Feed Checker)
  // Falls back to prefix detection if not provided.
  let anzahlbilder = POINTS.anzahlbilder.none;
  const imgCols = imageColumns ?? headers.filter((h) => {
    const norm = String(h).toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    return IMAGE_COL_PREFIXES.some((p) => norm.startsWith(p)) || norm.includes("bild") || norm.includes("image");
  });
  if (imgCols.length) {
    let totalImgs = 0, rn = 0;
    for (const r of rows) {
      let c = 0;
      for (const col of imgCols) { if (safeStr(r[col]).trim()) c += 1; }
      totalImgs += c; rn += 1;
    }
    const avg = rn ? totalImgs / rn : 0;
    if (avg >= THRESHOLDS.anzahlbilder.full)         anzahlbilder = POINTS.anzahlbilder.full;
    else if (avg >= THRESHOLDS.anzahlbilder.partial) anzahlbilder = POINTS.anzahlbilder.partial;
  }

  // Freisteller + Milieu (results from canvas pixel analysis)
  let freisteller = POINTS.freisteller.none;
  let millieu     = POINTS.millieu.none;
  let bildmatch   = POINTS.bildmatch.ok;

  if (qsImageSamples.length && Object.keys(freistellerChecks).length) {
    const samples = qsImageSamples.slice(0, 20);
    let checkedProducts = 0, withFreisteller = 0, withMilieu = 0;
    samples.forEach((s) => {
      const r = freistellerChecks[s.id];
      if (!r || !r.checkedCount) return;
      checkedProducts += 1;
      if (r.hasFreisteller) withFreisteller += 1;
      if (r.hasMilieu)      withMilieu += 1;
    });
    if (checkedProducts > 0) {
      const freiShare   = withFreisteller / checkedProducts;
      const milieuShare = withMilieu / checkedProducts;
      if (freiShare >= THRESHOLDS.freisteller.full)         freisteller = POINTS.freisteller.full;
      else if (freiShare >= THRESHOLDS.freisteller.partial) freisteller = POINTS.freisteller.partial;
      if (milieuShare >= THRESHOLDS.millieu.full)           millieu = POINTS.millieu.full;
      else if (milieuShare >= THRESHOLDS.millieu.partial)   millieu = POINTS.millieu.partial;
    }

    // Bildmatch — duplicate first-image check
    const firstUrls = qsImageSamples.map((s) => (s.urls && s.urls[0]) || "").filter(Boolean);
    if (firstUrls.length >= 5) {
      const urlCounts = {};
      firstUrls.forEach((u) => { urlCounts[u] = (urlCounts[u] || 0) + 1; });
      const dupCount = Object.values(urlCounts).filter((c) => c > 1).reduce((sum, c) => sum + c, 0);
      if (dupCount / firstUrls.length > THRESHOLDS.bildmatch.maxDupRate) bildmatch = POINTS.bildmatch.dup;
    }
  }

  return { herstellerfeed, titel, beschreibung, abmessungen, lieferumfang, material, farbe, shoptexte, bware, bildmatch, freisteller, millieu, anzahlbilder };
}

// Derive attributeScore and imageScore from raw per-criterion scores.
export function calcScores(scores) {
  const attributeRaw =
    scores.herstellerfeed + scores.titel + scores.beschreibung +
    scores.abmessungen + scores.lieferumfang + scores.material +
    scores.farbe + scores.shoptexte + scores.bware;
  const imageRaw =
    scores.bildmatch + scores.freisteller + scores.millieu + scores.anzahlbilder;
  const { attributeMaxRaw, imageMaxRaw, maxOut } = NORMALIZATION;
  const attributeScore = scores.titel    === 0 ? 0 : Math.round((attributeRaw / attributeMaxRaw) * maxOut);
  const imageScore     = scores.bildmatch === 0 ? 0 : Math.ceil((imageRaw     / imageMaxRaw)     * maxOut);
  return { attributeScore, imageScore };
}

// Returns true when the feed meets every APA minimum.
export function checkApaEligibility(scores, attributeScore, imageScore) {
  const m = APA_MINIMUMS;
  return (
    attributeScore          >= m.attributeScore  &&
    imageScore              >= m.imageScore       &&
    scores.titel            >= m.titel            &&
    scores.beschreibung     >= m.beschreibung     &&
    scores.abmessungen      >= m.abmessungen      &&
    scores.lieferumfang     >= m.lieferumfang     &&
    scores.material         >= m.material         &&
    scores.farbe            >= m.farbe            &&
    scores.shoptexte        >= m.shoptexte        &&
    scores.bware            >= m.bware            &&
    scores.bildmatch        === m.bildmatch        &&
    scores.freisteller      >= m.freisteller      &&
    scores.millieu          >= m.millieu          &&
    scores.anzahlbilder     >= m.anzahlbilder
  );
}

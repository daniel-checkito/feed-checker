/**
 * CHECK24 Feed Checker – Standalone Production Component
 *
 * Self-contained React component that validates CSV product feeds.
 * Drop into any React project with PapaParse installed.
 *
 * Dependencies:
 *   - react (useState, useRef)
 *   - papaparse
 *
 * Usage:
 *   import { FeedChecker } from './FeedChecker';
 *   <FeedChecker />
 */

import React, { useState, useRef } from 'react';
import Papa from 'papaparse';

const BRAND_COLOR = '#1553B6';
const REQUIRED_COLS = ['ean', 'name', 'price', 'brand', 'description', 'image_url'];

// ─── Issue Card ──────────────────────────────────────────────────────────────

interface IssueItem {
    label: string;
    hint: string;
}

interface IssueCardProps {
    title: string;
    severity: 'error' | 'warning';
    description: string;
    items: IssueItem[];
    more?: number;
}

function IssueCard({ title, severity, description, items, more = 0 }: IssueCardProps) {
    const [expanded, setExpanded] = useState(true);
    const isError = severity === 'error';
    const accent = isError ? '#B91C1C' : '#92400E';
    const bg = isError ? '#FEF2F2' : '#FFFBEB';
    const border = isError ? '#FECACA' : '#FCD34D';
    const badgeBg = isError ? '#FEE2E2' : '#FEF3C7';
    const icon = isError ? '❌' : '⚠️';

    return (
        <div style={{ background: '#FFFFFF', borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            <div
                onClick={() => setExpanded((v) => !v)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    borderLeft: `4px solid ${accent}`,
                    background: bg,
                    borderBottom: expanded ? `1px solid ${border}` : 'none',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{title}</span>
                    <span
                        style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: badgeBg,
                            color: accent,
                            fontWeight: 600,
                        }}
                    >
                        {items.length + more} Artikel
                    </span>
                </div>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>{expanded ? '▲' : '▼'}</span>
            </div>
            {expanded ? (
                <div style={{ padding: '12px 16px' }}>
                    <p style={{ fontSize: 13, color: '#374151', margin: '0 0 10px' }}>{description}</p>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {items.map((item, i) => (
                            <div
                                key={i}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '6px 10px',
                                    borderRadius: 6,
                                    background: '#F9FAFB',
                                    border: '1px solid #F3F4F6',
                                }}
                            >
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{item.label}</span>
                                <span style={{ fontSize: 11, color: '#6B7280' }}>{item.hint}</span>
                            </div>
                        ))}
                        {more > 0 ? (
                            <div style={{ fontSize: 12, color: '#6B7280', padding: '4px 10px' }}>
                                … und {more} weitere Artikel
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// ─── Feed Analysis Logic ─────────────────────────────────────────────────────

interface AnalysisIssues {
    totalRows: number;
    missingCols: string[];
    missingEan: number[];
    invalidPrice: { row: number; ean: string; value: string }[];
    shortName: { row: number; ean: string; value: string }[];
    shortDesc: { row: number; ean: string; value: string }[];
    missingImage: { row: number; ean: string }[];
    emptyRequired: { row: number; ean: string; field: string }[];
}

function analyzeFile(rows: Record<string, string>[], headers: string[]): AnalysisIssues {
    const hl = headers.map((h) => h.toLowerCase().trim());
    const missingCols = REQUIRED_COLS.filter((c) => !hl.some((h) => h === c || h.includes(c)));

    const findCol = (key: string) =>
        headers.find((h) => h.toLowerCase().trim() === key || h.toLowerCase().includes(key));

    const colEan = findCol('ean');
    const colName = findCol('name');
    const colPrice = findCol('price');
    const colDesc = findCol('description') || findCol('desc');
    const colImage = findCol('image_url') || findCol('image');
    const colBrand = findCol('brand');

    const missingEan: number[] = [];
    const invalidPrice: { row: number; ean: string; value: string }[] = [];
    const shortName: { row: number; ean: string; value: string }[] = [];
    const shortDesc: { row: number; ean: string; value: string }[] = [];
    const missingImage: { row: number; ean: string }[] = [];
    const emptyRequired: { row: number; ean: string; field: string }[] = [];

    rows.forEach((row, i) => {
        const rn = i + 1;
        const ean = colEan ? String(row[colEan] ?? '').trim() : '';
        const name = colName ? String(row[colName] ?? '').trim() : '';
        const price = colPrice ? String(row[colPrice] ?? '').trim() : '';
        const desc = colDesc ? String(row[colDesc] ?? '').trim() : '';
        const image = colImage ? String(row[colImage] ?? '').trim() : '';
        const brand = colBrand ? String(row[colBrand] ?? '').trim() : '';

        if (colEan && !ean) missingEan.push(rn);
        if (colPrice && price) {
            const n = Number.parseFloat(price.replace(',', '.'));
            if (Number.isNaN(n) || n <= 0) invalidPrice.push({ row: rn, ean, value: price });
        }
        if (colName && name && name.length < 10) shortName.push({ row: rn, ean, value: name });
        if (colDesc && desc && desc.length < 30) shortDesc.push({ row: rn, ean, value: desc.slice(0, 60) });
        if (colImage && !image) missingImage.push({ row: rn, ean });
        if (colBrand && !brand) emptyRequired.push({ row: rn, ean, field: 'brand' });
    });

    return { totalRows: rows.length, missingCols, missingEan, invalidPrice, shortName, shortDesc, missingImage, emptyRequired };
}

// ─── CSV Parsing with Encoding Detection ─────────────────────────────────────

function parseCSVFile(
    file: File,
    onResult: (rows: Record<string, string>[], headers: string[]) => void,
): void {
    const GARBLED_UMLAUT_RE = /\u00c3\u00a4|\u00c3\u00b6|\u00c3\u00bc|\u00c3\u0084|\u00c3\u0096|\u00c3\u009c|\u00c3\u009f/;

    const tryParse = (encoding: string) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target?.result;
            if (typeof text !== 'string') return;
            if (encoding === 'UTF-8' && GARBLED_UMLAUT_RE.test(text)) {
                tryParse('windows-1252');
                return;
            }
            Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                complete: (res) => {
                    const data = Array.isArray(res.data) ? (res.data as Record<string, string>[]) : [];
                    const headers = res.meta?.fields || Object.keys(data[0] || {});
                    onResult(data, headers);
                },
            });
        };
        reader.readAsText(file, encoding);
    };

    tryParse('UTF-8');
}

// ─── Main FeedChecker Component ──────────────────────────────────────────────

export function FeedChecker() {
    const [issues, setIssues] = useState<AnalysisIssues | null>(null);
    const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFile = (f: File | null | undefined) => {
        if (!f) return;
        setIssues(null);
        setParsedRows([]);
        parseCSVFile(f, (rows, headers) => {
            setParsedRows(rows);
            setIssues(analyzeFile(rows, headers));
        });
    };

    const downloadCSV = () => {
        if (!issues || !parsedRows.length) return;
        const headers = Object.keys(parsedRows[0] || {});
        const findCol = (key: string) => headers.find((h) => h.toLowerCase().includes(key)) || '';
        const colEan = findCol('ean');
        const colName = findCol('name');
        const colOfferId = findCol('offer_id') || findCol('seller_offer_id') || findCol('eindeutige') || findCol('sku');

        const missingEanSet = new Set(issues.missingEan);
        const invalidPriceSet = new Set(issues.invalidPrice.map((x) => x.row));
        const shortNameSet = new Set(issues.shortName.map((x) => x.row));
        const shortDescSet = new Set(issues.shortDesc.map((x) => x.row));
        const missingImageSet = new Set(issues.missingImage.map((x) => x.row));
        const emptyReqSet = new Set(issues.emptyRequired.map((x) => x.row));

        const csvRows: { ean: string; offerId: string; name: string; reasons: string }[] = [];
        parsedRows.forEach((r, i) => {
            const rn = i + 1;
            const reasons: string[] = [];
            if (missingEanSet.has(rn)) reasons.push('EAN fehlt');
            if (invalidPriceSet.has(rn)) reasons.push('Ungültiger Preis');
            if (shortNameSet.has(rn)) reasons.push('Produktname zu kurz');
            if (shortDescSet.has(rn)) reasons.push('Beschreibung zu kurz');
            if (missingImageSet.has(rn)) reasons.push('Bild fehlt');
            if (emptyReqSet.has(rn)) reasons.push('Pflichtfeld fehlt');
            if (!reasons.length) return;
            const ean = colEan ? String(r[colEan] ?? '').trim() : '';
            const name = colName ? String(r[colName] ?? '').trim() : '';
            const offerId = colOfferId ? String(r[colOfferId] ?? '').trim() : '';
            csvRows.push({ ean, offerId, name, reasons: reasons.join('; ') });
        });

        const header = 'EAN;Offer_ID;Name;Grund';
        const lines = csvRows.map(
            (r) => `"${r.ean}";"${r.offerId}";"${r.name.replace(/"/g, '""')}";"${r.reasons}"`,
        );
        const csv = [header, ...lines].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `feed-ergebnisse-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const errorCount = issues
        ? issues.missingCols.length + issues.missingEan.length + issues.invalidPrice.length + issues.missingImage.length
        : 0;
    const warningCount = issues
        ? issues.shortName.length + issues.shortDesc.length + issues.emptyRequired.length
        : 0;

    return (
        <div style={{ maxWidth: 720, display: 'grid', gap: 20 }}>
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: '20px 24px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 4px' }}>
                    Feed-Datei prüfen
                </h3>
                <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px' }}>
                    Laden Sie Ihre CSV-Datei hoch — wir prüfen automatisch auf Fehler, fehlende Pflichtfelder und
                    Duplikate.
                </p>

                {!issues ? (
                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            handleFile(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => fileRef.current?.click()}
                        style={{
                            background: dragging ? '#EEF4FF' : '#F9FAFB',
                            border: `2px dashed ${dragging ? BRAND_COLOR : '#D1D5DB'}`,
                            borderRadius: 8,
                            padding: '36px 24px',
                            textAlign: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                            CSV-Datei ablegen oder klicken zum Auswählen
                        </div>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>
                            Unterstützt: .csv (Semikolon- oder Komma-getrennt)
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".csv,text/csv"
                            style={{ display: 'none' }}
                            onChange={(e) => handleFile(e.target.files?.[0])}
                        />
                    </div>
                ) : (
                    <div style={{ display: 'grid', gap: 14 }}>
                        {/* Summary KPIs */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                            {[
                                {
                                    label: 'Artikel gesamt',
                                    val: issues.totalRows,
                                    bg: '#F9FAFB',
                                    border: '#E5E7EB',
                                    color: '#111827',
                                },
                                {
                                    label: 'Fehler',
                                    val: errorCount,
                                    bg: errorCount > 0 ? '#FEF2F2' : '#F0FDF4',
                                    border: errorCount > 0 ? '#FECACA' : '#BBF7D0',
                                    color: errorCount > 0 ? '#B91C1C' : '#166534',
                                },
                                {
                                    label: 'Warnungen',
                                    val: warningCount,
                                    bg: warningCount > 0 ? '#FFFBEB' : '#F0FDF4',
                                    border: warningCount > 0 ? '#FCD34D' : '#BBF7D0',
                                    color: warningCount > 0 ? '#92400E' : '#166534',
                                },
                            ].map((c) => (
                                <div
                                    key={c.label}
                                    style={{
                                        background: c.bg,
                                        border: `1px solid ${c.border}`,
                                        borderRadius: 8,
                                        padding: '14px 16px',
                                    }}
                                >
                                    <div style={{ fontSize: 11, color: c.color, fontWeight: 500, marginBottom: 4 }}>
                                        {c.label}
                                    </div>
                                    <div style={{ fontSize: 26, fontWeight: 800, color: c.color }}>{c.val}</div>
                                </div>
                            ))}
                        </div>

                        {/* Status banner */}
                        {errorCount === 0 ? (
                            <div
                                style={{
                                    background: '#F0FDF4',
                                    border: '1px solid #BBF7D0',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                }}
                            >
                                <div
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        background: '#16A34A',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#FFF',
                                        fontSize: 18,
                                        flexShrink: 0,
                                    }}
                                >
                                    ✓
                                </div>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
                                        Feed ist startklar
                                    </div>
                                    <div style={{ fontSize: 12, color: '#15803D' }}>
                                        Keine kritischen Fehler gefunden.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div
                                style={{
                                    background: '#FEF2F2',
                                    border: '1px solid #FECACA',
                                    borderRadius: 8,
                                    padding: '14px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                }}
                            >
                                <div
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        background: '#DC2626',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#FFF',
                                        fontSize: 18,
                                        flexShrink: 0,
                                    }}
                                >
                                    !
                                </div>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: '#B91C1C' }}>
                                        Noch nicht startklar
                                    </div>
                                    <div style={{ fontSize: 12, color: '#DC2626' }}>
                                        {errorCount} Fehler und {warningCount} Warnungen gefunden.
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Issue cards */}
                        {issues.missingCols.length > 0 && (
                            <IssueCard
                                title="Fehlende Pflichtfelder"
                                severity="error"
                                description="Diese Spalten fehlen:"
                                items={issues.missingCols.map((c) => ({ label: c, hint: 'Spalte fehlt komplett' }))}
                            />
                        )}
                        {issues.missingEan.length > 0 && (
                            <IssueCard
                                title="Fehlende EAN"
                                severity="error"
                                description={`${issues.missingEan.length} Artikel ohne EAN.`}
                                items={issues.missingEan.slice(0, 8).map((r) => ({
                                    label: `Zeile ${r}`,
                                    hint: 'EAN fehlt',
                                }))}
                                more={Math.max(0, issues.missingEan.length - 8)}
                            />
                        )}
                        {issues.invalidPrice.length > 0 && (
                            <IssueCard
                                title="Ungültiger Preis"
                                severity="error"
                                description={`${issues.invalidPrice.length} Artikel mit ungültigem Preis.`}
                                items={issues.invalidPrice.slice(0, 8).map((x) => ({
                                    label: `Zeile ${x.row}${x.ean ? ` · EAN ${x.ean}` : ''}`,
                                    hint: `"${x.value}"`,
                                }))}
                                more={Math.max(0, issues.invalidPrice.length - 8)}
                            />
                        )}
                        {issues.missingImage.length > 0 && (
                            <IssueCard
                                title="Fehlende Bilder"
                                severity="error"
                                description={`${issues.missingImage.length} Artikel ohne Bild-URL.`}
                                items={issues.missingImage.slice(0, 8).map((x) => ({
                                    label: `Zeile ${x.row}${x.ean ? ` · EAN ${x.ean}` : ''}`,
                                    hint: 'image_url fehlt',
                                }))}
                                more={Math.max(0, issues.missingImage.length - 8)}
                            />
                        )}
                        {issues.shortName.length > 0 && (
                            <IssueCard
                                title="Produktname zu kurz"
                                severity="warning"
                                description={`${issues.shortName.length} Artikel mit zu kurzem Namen.`}
                                items={issues.shortName.slice(0, 8).map((x) => ({
                                    label: `Zeile ${x.row}`,
                                    hint: `"${x.value}"`,
                                }))}
                                more={Math.max(0, issues.shortName.length - 8)}
                            />
                        )}
                        {issues.shortDesc.length > 0 && (
                            <IssueCard
                                title="Beschreibung zu kurz"
                                severity="warning"
                                description={`${issues.shortDesc.length} Artikel mit zu kurzer Beschreibung.`}
                                items={issues.shortDesc.slice(0, 8).map((x) => ({
                                    label: `Zeile ${x.row}`,
                                    hint: `"${x.value}"`,
                                }))}
                                more={Math.max(0, issues.shortDesc.length - 8)}
                            />
                        )}
                        {issues.emptyRequired.length > 0 && (
                            <IssueCard
                                title="Fehlende Angaben"
                                severity="warning"
                                description={`${issues.emptyRequired.length} Artikel mit fehlenden Pflichtangaben.`}
                                items={issues.emptyRequired.slice(0, 8).map((x) => ({
                                    label: `Zeile ${x.row}`,
                                    hint: `Feld "${x.field}" fehlt`,
                                }))}
                                more={Math.max(0, issues.emptyRequired.length - 8)}
                            />
                        )}

                        {/* CSV Download */}
                        <div
                            style={{
                                padding: '12px 14px',
                                borderRadius: 8,
                                border: '1px solid #E5E7EB',
                                background: '#FFF',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                                    Ergebnisse exportieren
                                </div>
                                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                                    Alle Zeilen mit Fehlern als CSV herunterladen.
                                </div>
                            </div>
                            <button
                                onClick={downloadCSV}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: 6,
                                    border: 'none',
                                    background: '#16A34A',
                                    color: '#FFF',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                }}
                            >
                                CSV herunterladen
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                setIssues(null);
                                setParsedRows([]);
                            }}
                            style={{
                                padding: '9px 20px',
                                borderRadius: 6,
                                border: `1px solid ${BRAND_COLOR}`,
                                background: '#FFF',
                                color: BRAND_COLOR,
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                width: 'fit-content',
                            }}
                        >
                            Neue Datei prüfen
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default FeedChecker;

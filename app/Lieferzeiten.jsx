"use client";

import React from "react";

export default function Lieferzeiten() {
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
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>
        Lieferzeiten-Analyse
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, color: "#4B5563", lineHeight: "18px" }}>
        Hier kannst du später die Auswertung und Regeln rund um Lieferzeiten aufbauen.
      </p>
    </div>
  );
}


"use client";
import React, { useState, useRef } from "react";

export default function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  if (!text) return children;

  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 10px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#1F2937",
          color: "#FFFFFF",
          fontSize: 13,
          fontWeight: 400,
          lineHeight: "1.55",
          padding: "10px 14px",
          borderRadius: 10,
          maxWidth: 240,
          width: "max-content",
          whiteSpace: "normal",
          zIndex: 9999,
          pointerEvents: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

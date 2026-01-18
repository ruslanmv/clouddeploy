import React, { useState } from "react";
import { requestDiagramFromParent } from "../integration/requestDiagram.js";

export default function DiagramPromptBar() {
  const [prompt, setPrompt] = useState("");

  function onSubmit(e) {
    e.preventDefault();
    requestDiagramFromParent(prompt);
    setPrompt("");
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: 8,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
      }}
    >
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder='e.g. "generate a simple s3 bucket with versioning + SSE-S3"'
        style={{
          width: 420,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          outline: "none",
        }}
      />
      <button
        type="submit"
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid #111827",
          background: "#111827",
          color: "white",
          cursor: "pointer",
        }}
        title="Generate diagram in current session"
      >
        Generate diagram
      </button>
    </form>
  );
}

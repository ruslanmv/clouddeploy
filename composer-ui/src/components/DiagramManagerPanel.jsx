import React from "react";

/**
 * DiagramManagerPanel - Complete toolbar for Composer diagram management
 *
 * Features:
 * - Generate prompt input (AI generates new diagram)
 * - Edit prompt input (AI edits existing diagram)
 * - Blue "Generate" button (analyzes current manual diagram)
 * - Quick-add buttons for AWS services
 */
export default function DiagramManagerPanel({
  prompt,
  setPrompt,
  editInstruction,
  setEditInstruction,
  onGenerate,
  onEdit,
  onAnalyze,
  onAddAwsNode,
  onAddTextNode,
  graphMeta,
}) {
  const handleGenerateSubmit = (e) => {
    e.preventDefault();
    if (onGenerate) onGenerate();
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (onEdit) onEdit();
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 10,
        background: "rgba(255,255,255,0.95)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        maxWidth: 600,
      }}
    >
      {/* AI Generate Form */}
      <form onSubmit={handleGenerateSubmit} style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
          Generate with AI
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "S3 bucket with versioning + CloudFront CDN"'
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              outline: "none",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #111827",
              background: "#111827",
              color: "white",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Generate
          </button>
        </div>
      </form>

      {/* AI Edit Form */}
      <form onSubmit={handleEditSubmit} style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
          Edit with AI
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={editInstruction}
            onChange={(e) => setEditInstruction(e.target.value)}
            placeholder='e.g. "add Lambda function behind API Gateway"'
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              outline: "none",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "white",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Apply
          </button>
        </div>
      </form>

      {/* Blue Analyze Button */}
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={onAnalyze}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#0062ff",
            color: "white",
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
          title="Analyze current diagram and get AI recommendations"
        >
          🔍 Analyze Current Diagram
        </button>
      </div>

      {/* Quick Add Toolbar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
          Quick Add
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => onAddAwsNode?.("aws.s3")}
            style={quickButtonStyle}
            title="Add S3 Bucket"
          >
            S3
          </button>
          <button
            onClick={() => onAddAwsNode?.("aws.lambda")}
            style={quickButtonStyle}
            title="Add Lambda Function"
          >
            Lambda
          </button>
          <button
            onClick={() => onAddAwsNode?.("aws.apigateway")}
            style={quickButtonStyle}
            title="Add API Gateway"
          >
            API GW
          </button>
          <button
            onClick={() => onAddAwsNode?.("aws.cloudfront")}
            style={quickButtonStyle}
            title="Add CloudFront Distribution"
          >
            CloudFront
          </button>
          <button
            onClick={() => onAddAwsNode?.("aws.rds")}
            style={quickButtonStyle}
            title="Add RDS Database"
          >
            RDS
          </button>
          <button
            onClick={() => onAddAwsNode?.("aws.vpc")}
            style={quickButtonStyle}
            title="Add VPC"
          >
            VPC
          </button>
          <button
            onClick={() => onAddTextNode?.()}
            style={{
              ...quickButtonStyle,
              background: "#fef3c7",
              color: "#92400e",
            }}
            title="Add Text Note"
          >
            📝 Text
          </button>
        </div>
      </div>

      {/* Status Display */}
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
        Stage: <b>{graphMeta?.stage || "diagram"}</b>
      </div>
    </div>
  );
}

const quickButtonStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};

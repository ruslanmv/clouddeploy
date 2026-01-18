import React from "react";
import { Handle, Position } from "reactflow";
import { getAwsIcon } from "../icons/aws/index.js";

export default function AwsServiceNode({ data }) {
  const Icon = getAwsIcon(data?.awsType);

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        background: "white",
        boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        minWidth: 180,
      }}
    >
      {/* Connection handles (ports) */}
      <Handle type="target" position={Position.Left} id="l" style={{ width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} id="r" style={{ width: 10, height: 10 }} />
      <Handle type="target" position={Position.Top} id="t" style={{ width: 10, height: 10 }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ width: 10, height: 10 }} />

      <div style={{ width: 24, height: 24, display: "grid", placeItems: "center" }}>
        {Icon ? <Icon /> : <span style={{ fontSize: 16 }}>☁️</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>
          {data?.label || "AWS Service"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>{data?.awsType || ""}</div>
      </div>
    </div>
  );
}

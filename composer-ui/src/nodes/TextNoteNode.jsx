import React, { useState } from "react";
import { Handle, Position } from "reactflow";

/**
 * TextNoteNode - Editable text box for diagram annotations
 *
 * Features:
 * - Editable text content
 * - Yellow background for visibility
 * - Optional handles for connections
 */
export default function TextNoteNode({ data, id }) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(data?.text || "Note");

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    // Update node data
    if (data?.onChange) {
      data.onChange(id, text);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    }
  };

  return (
    <div
      style={{
        background: "#fef3c7",
        border: "2px solid #f59e0b",
        borderRadius: 8,
        padding: 12,
        minWidth: 150,
        minHeight: 60,
        fontSize: 14,
        color: "#92400e",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Optional connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#f59e0b", width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "#f59e0b", width: 8, height: 8 }}
      />

      {isEditing ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            minHeight: 60,
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "both",
            fontSize: 14,
            color: "#92400e",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <div
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            cursor: "text",
          }}
        >
          {text || "Double-click to edit"}
        </div>
      )}
    </div>
  );
}

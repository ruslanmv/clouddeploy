import React from "react";

export default function S3Icon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 9h8M8 12h8M8 15h8" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

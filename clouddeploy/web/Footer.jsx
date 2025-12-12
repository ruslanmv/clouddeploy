// clouddeploy/web/Footer.jsx
import React from "react";

export default function Footer() {
  return (
    <footer className="gp-footer" style={{ fontSize: "14px" }}>
      <div className="gp-footer-left">
        <a
          href="https://github.com/ruslanmv/CloudDeploy"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "inherit",
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "color 0.2s ease",
            fontSize: "14px",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = "#ff7a3c";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = "#c3c5dd";
          }}
        >
          ⭐ Star our GitHub project
        </a>
      </div>
      <div className="gp-footer-right" style={{ fontSize: "14px" }}>
        <span>© 2025 CloudDeploy</span>
        <a
          href="https://github.com/ruslanmv/CloudDeploy"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "14px" }}
        >
          Docs
        </a>
        <a
          href="https://github.com/ruslanmv/CloudDeploy"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "14px" }}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}

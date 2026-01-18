import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Tailwind entrypoint
import "./index.css";

createRoot(document.getElementById("root")).render(<App />);

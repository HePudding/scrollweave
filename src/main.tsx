import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles.css";
import { runtimeCSS } from "./runtime/render";
const style = document.createElement("style");
style.textContent = runtimeCSS;
document.head.prepend(style);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

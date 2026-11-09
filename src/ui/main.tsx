import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./TopBar";
import "./styles.css";

const viewId = /^\/v\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App viewId={viewId} />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readStorage } from "./storage";
import "./styles.css";

const viewId = /^\/v\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

const stored = readStorage<string | null>("diff-review:theme", null);
document.documentElement.dataset.theme =
  stored === "light" || stored === "dark" ? stored : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App viewId={viewId} />
  </StrictMode>,
);

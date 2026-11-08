import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const token = new URLSearchParams(location.hash.slice(1)).get("token");
const viewId = /^\/v\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App token={token} viewId={viewId} />
  </StrictMode>,
);

import type { Lang } from "./highlight.worker";
import { basename } from "./paths";

export type Style = Record<string, string>;

export interface Token {
  content: string;
  style?: Style;
}

export interface TokenLines {
  lines: (string | number)[][];
  styles: Style[];
}

export interface HighlightRequest {
  id: number;
  code: string;
  lang: Lang;
}

export interface HighlightResult {
  id: number;
  tokens: TokenLines | null;
}

const BY_EXTENSION: Record<string, Lang> = {
  astro: "astro",
  c: "c",
  h: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  inl: "cpp",
  cmake: "cmake",
  cs: "csharp",
  css: "css",
  dart: "dart",
  diff: "diff",
  patch: "diff",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  graphql: "graphql",
  gql: "graphql",
  hs: "haskell",
  hcl: "hcl",
  html: "html",
  htm: "html",
  ini: "ini",
  cfg: "ini",
  java: "java",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  mk: "make",
  md: "markdown",
  mdx: "markdown",
  nix: "nix",
  php: "php",
  ps1: "powershell",
  proto: "proto",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  tf: "terraform",
  toml: "toml",
  tsx: "tsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  vue: "vue",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
};

const BY_NAME: Record<string, Lang> = {
  Dockerfile: "dockerfile",
  Makefile: "make",
  GNUmakefile: "make",
  "CMakeLists.txt": "cmake",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
  ".profile": "shellscript",
  "tsconfig.json": "jsonc",
};

export function languageFor(filePath: string): Lang | null {
  const name = basename(filePath);
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("Dockerfile.")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

const MAX_HIGHLIGHT_CHARS = 400_000;
const MAX_CACHED = 64;
const cache = new Map<string, Promise<TokenLines | null>>();
const waiting = new Map<number, (tokens: TokenLines | null) => void>();
let worker: Worker | null = null;
let failed = false;
let nextId = 0;

function fail(): void {
  failed = true;
  for (const done of waiting.values()) done(null);
  waiting.clear();
}

function request(code: string, lang: Lang): Promise<TokenLines | null> {
  if (failed) return Promise.resolve(null);
  try {
    if (!worker) {
      worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<HighlightResult>) => {
        waiting.get(e.data.id)?.(e.data.tokens);
        waiting.delete(e.data.id);
      };
      worker.onerror = fail;
    }
    const id = nextId++;
    worker.postMessage({ id, code, lang } satisfies HighlightRequest);
    return new Promise((resolve) => waiting.set(id, resolve));
  } catch {
    fail();
    return Promise.resolve(null);
  }
}

export function highlight(code: string, lang: Lang): Promise<TokenLines | null> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return Promise.resolve(null);
  const key = `${lang}\0${code}`;
  let result = cache.get(key);
  if (!result) {
    result = request(code, lang);
    cache.set(key, result);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return result;
}

export function tokensAt(tokens: TokenLines | null, line: number): Token[] | undefined {
  const flat = tokens?.lines[line];
  if (!tokens || !flat) return undefined;
  const out: Token[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ content: flat[i] as string, style: tokens.styles[flat[i + 1] as number] });
  return out;
}

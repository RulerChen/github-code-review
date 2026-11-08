import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export interface Token {
  content: string;
  style?: Record<string, string>;
}
export type TokenLines = Token[][];

const LANGS = {
  astro: () => import("@shikijs/langs/astro"),
  c: () => import("@shikijs/langs/c"),
  cmake: () => import("@shikijs/langs/cmake"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  elixir: () => import("@shikijs/langs/elixir"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  haskell: () => import("@shikijs/langs/haskell"),
  hcl: () => import("@shikijs/langs/hcl"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  nix: () => import("@shikijs/langs/nix"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  proto: () => import("@shikijs/langs/proto"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  terraform: () => import("@shikijs/langs/terraform"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
} as const;

export type Lang = keyof typeof LANGS;

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
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("Dockerfile.")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

const MAX_HIGHLIGHT_CHARS = 400_000;

const SOFT_DARK_COLORS: Record<string, string> = { "#adbac7": "#d1d7e0", "#768390": "#9198a1" };

async function softDarkTheme() {
  const theme = (await import("@shikijs/themes/github-dark-dimmed")).default;
  return JSON.parse(JSON.stringify(theme).replace(/#adbac7|#768390/gi, (c) => SOFT_DARK_COLORS[c.toLowerCase()]!));
}

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Map<Lang, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import("@shikijs/themes/github-light-default"), softDarkTheme()],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

const cache = new Map<string, Promise<TokenLines | null>>();

export function highlight(code: string, lang: Lang): Promise<TokenLines | null> {
  const key = `${lang}\0${code}`;
  let result = cache.get(key);
  if (!result) {
    result = highlightUncached(code, lang);
    cache.set(key, result);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return result;
}

async function highlightUncached(code: string, lang: Lang): Promise<TokenLines | null> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  const h = await getHighlighter();
  let ready = loaded.get(lang);
  if (!ready) {
    ready = h.loadLanguage(LANGS[lang]());
    loaded.set(lang, ready);
  }
  await ready;
  const { tokens } = h.codeToTokens(code, { lang, themes: { light: "github-light-default", dark: "github-dark-dimmed" } });
  return tokens.map((line) => line.map((t) => ({ content: t.content, style: t.htmlStyle })));
}

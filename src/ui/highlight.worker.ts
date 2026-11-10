import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlightRequest, HighlightResult, Style, TokenLines } from "./highlight";

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

async function tokenize(code: string, lang: Lang): Promise<TokenLines> {
  const h = await getHighlighter();
  let ready = loaded.get(lang);
  if (!ready) {
    ready = h.loadLanguage(LANGS[lang]());
    loaded.set(lang, ready);
  }
  await ready;

  const { tokens } = h.codeToTokens(code, { lang, themes: { light: "github-light-default", dark: "github-dark-dimmed" } });
  const styles: Style[] = [];
  const indexOf = new Map<string, number>();
  const lines = tokens.map((line) => {
    const out: (string | number)[] = [];
    let text = "";
    let style = -1;
    for (const t of line) {
      const key = t.htmlStyle ? JSON.stringify(t.htmlStyle) : "";
      let index = indexOf.get(key);
      if (index === undefined) {
        index = t.htmlStyle ? styles.push(t.htmlStyle) - 1 : -1;
        indexOf.set(key, index);
      }
      if (text && index !== style) {
        out.push(text, style);
        text = "";
      }
      text += t.content;
      style = index;
    }
    if (text) out.push(text, style);
    return out;
  });
  return { lines, styles };
}

let queue: Promise<void> = Promise.resolve();

addEventListener("message", (e: MessageEvent<HighlightRequest>) => {
  const { id, code, lang } = e.data;
  queue = queue.then(async () => {
    const result: HighlightResult = { id, tokens: await tokenize(code, lang).catch(() => null) };
    postMessage(result);
  });
});

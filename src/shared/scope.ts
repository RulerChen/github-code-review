export interface Language {
  exts: string[];
  patterns: (name: string) => string[];
  values: (name: string) => string[];
  locals: (name: string) => string[];
  binders: (name: string) => string[];
  params: (name: string) => string[];
  module?: RegExp;
  shorthand?: boolean;
  scopes: RegExp[];
}

export type Scoped =
  | { kind: "member"; own: boolean; call: boolean }
  | { kind: "declared" }
  | { kind: "bound"; line: number; module: string | null }
  | { kind: "free" };

const S = "[[:space:]]";
const START = "(^|[^[:alnum:]_$])";
const END = "([^[:alnum:]_$]|$)";
const OPENS = "\\(([^;]*$|[^;{]*\\)[^;{]*\\{)";

const B = "(?<![\\w$.])";
const E = "(?![\\w$])";

const named = (n: string, mods = "") =>
  `\\((?:[^()]*?(?:[,{\\[]|\\.\\.\\.))?\\s*${mods}${n}${E}\\s*\\??\\s*(?:[,:}\\]][^()]*|=(?![=>])[^()]*)?\\)`;

const JS_MODS = "(?:(?:public|private|protected|readonly|override)\\s+)*";
const JS_HEAD = "(?:(?:export|default|public|private|protected|static|async|override|abstract|get|set)\\s+)*";
const JS_CONTROL = "(?:if|for|while|switch|catch|return|with|do|else|function|await|new|typeof|void)";

const C_MODS =
  "(?:(?:const|static|volatile|unsigned|signed|struct|enum|union|class|register|extern|final|mutable|constexpr|inline|typename|long|short|public|private|protected|internal|readonly|abstract|virtual|override|sealed|synchronized|transient|native|unsafe|ref|out|in|params)\\s+)*";
const C_KEYWORD =
  "(?:return|goto|delete|throw|new|else|case|typedef|using|namespace|package|import|break|continue|co_return|co_await|co_yield|await|yield|sizeof|if|while|for|switch|do|catch|try)";
const C_TYPE = `(?!${C_KEYWORD}\\b)${C_MODS}[A-Za-z_][\\w:.]*(?:<[^;(){}]*>)?(?:\\[\\s*\\])*`;
const LOWER = "(?=[a-z_])";
const typed = (n: string) => `${C_TYPE}(?:\\s*[*&]+\\s*|\\s+)(?:const\\s+)?${n}${E}`;

const ARGS = "\\((?:[^()]|\\([^()]*\\))*\\)";
const JS_FUNCTION = `(?:async\\s*)?(?:(?:<[^>]*>\\s*)?${ARGS}\\s*(?::[^=]*)?=>|[\\w$]+\\s*=>|function\\b)`;
const JS_VAR = "(?:const|let|var)\\s+(?<n>[\\w$]+)";
const C_ARGS = "(?:<[^;(){}]*>)?";
const C_NAME = `(?<n>(?!${C_KEYWORD}\\b)~?[A-Za-z_]\\w*${C_ARGS}(?:::~?\\w+${C_ARGS})*(?:(?<=\\boperator)\\s*(?:\\(\\)|\\[\\]|[^\\s\\w()]{1,3}))?)`;
const C_OPENS = "\\((?:[^;]*$|[^;{]*\\)[^;{]*\\{)";

export const LANGUAGES: Language[] = [
  {
    exts: ["py", "pyi"],
    patterns: (n) => [`^${S}*(async${S}+)?def${S}+${n}${S}*\\(`, `^${S}*class${S}+${n}${END}`],
    values: (n) => [`^${n}${S}*(:[^=]*)?=([^=]|$)`],
    locals: (n) => [
      `^\\s*(?:[\\w.\\[\\]*]+\\s*,\\s*)*\\*?${n}${E}\\s*(?:,\\s*\\*?[\\w.\\[\\]]+\\s*)*,?\\s*(?::[^=]+)?=(?!=)(?!.*,\\s*$)`,
      `\\bfor\\s+(?:[^:]*?[\\s,(])?${n}${E}(?:\\s*[,)][^:]*?)?\\s+in\\b`,
      `\\b(?:with|except|import)\\b.*\\bas\\s+\\(?(?:\\w+\\s*,\\s*)*${n}${E}`,
      `^\\s*import\\s+(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)*${n}${E}(?!\\s+as\\b)`,
      `^\\s*from\\s+[\\w.]+\\s+import\\b(?:.*[\\s,(])?${n}${E}(?!\\s+as\\b)`,
      `${B}${n}\\s*:=`,
    ],
    binders: (n) => [
      `\\bdef\\s+\\w+\\s*\\((?:[^()]*?,)?\\s*\\*{0,2}${n}${E}\\s*(?:[,:)]|=(?!=))`,
      `\\blambda\\b(?:[^:]*?,)?\\s*\\*{0,2}${n}${E}\\s*(?:[,:]|=(?!=))`,
    ],
    params: (n) => [`^\\s*\\*{0,2}${n}${E}\\s*(?:[,:)]|=(?!=)|$)`],
    module: /^\s*from\s+([\w.]+)\s+import\b|^\s*import\s+([\w.]+)/,
    scopes: [/^\s*(?:async\s+)?def\s+(?<n>\w+)/, /^\s*class\s+(?<n>\w+)/, /^(?<n>\w+)\s*(?::[^=]*)?=(?!=)/],
  },
  {
    exts: ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"],
    shorthand: true,
    patterns: (n) => [
      `${START}function${S}*\\*?${S}*${n}${S}*[(<]`,
      `${START}(class|interface|type|enum|namespace)${S}+${n}${END}`,
      `^${S}*((public|private|protected|static|async|readonly|override|abstract|get|set)${S}+)*\\*?${n}${S}*(<[^>]*>)?\\([^;]*\\)[^;]*\\{${S}*$`,
      `^${S}*((public|private|protected|static|readonly|override)${S}+)*${n}${S}*(:[^=]*)?=${S}*(async${S}*)?(\\(|[[:alnum:]_$]+${S}*=>)`,
    ],
    values: (n) => [`${START}(const|let|var)${S}+${n}${S}*(:[^=]*)?=([^=]|$)`],
    locals: (n) => [
      `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${n}${E}`,
      `^\\s*(?:export\\s+)?(?:const|let|var)\\s*[{\\[](?:[^=]*?(?:[,{\\[\\s:]|\\.\\.\\.))?${n}${E}\\s*(?:=[^,}\\]]*)?[,}\\]]`,
      `^\\s*import\\b[^"'\`]*?${B}${n}${E}`,
    ],
    binders: (n) => [
      `${named(n, JS_MODS)}\\s*(?::[^=()]*?)?\\s*=>`,
      `${B}${n}\\s*=>`,
      `\\bfunction\\b[^(]*${named(n, JS_MODS)}`,
      `^\\s*${JS_HEAD}\\*?(?!${JS_CONTROL}\\b)[\\w$#]+\\s*(?:<[^>()]*>)?${named(n, JS_MODS)}[^;]*\\{\\s*$`,
      `\\bcatch\\s*\\(\\s*${n}${E}`,
      `\\bfor\\s*(?:await\\s*)?\\(\\s*(?:const|let|var)\\s*(?:[{\\[](?:[^=;)]*?[,\\s{\\[:])?)?${n}${E}`,
      `(?:\\bfunction\\b\\s*\\*?\\s*[\\w$]*|\\b(?:class|interface|type)\\s+[\\w$]+|^\\s*${JS_HEAD}[\\w$#]+)\\s*<(?:[^<>()]*,)?\\s*(?:const\\s+|in\\s+|out\\s+)?${n}${E}[^<>()]*>`,
    ],
    params: (n) => [
      `^\\s*(?:\\.\\.\\.)?${JS_MODS}${n}${E}\\s*\\??\\s*(?:[,:)]|=(?![=>])|$)`,
      `^\\s*[{\\[](?:[^=()]*?[,{\\[\\s:])?${n}${E}\\s*(?:=[^,}\\]]*)?[,}\\]]`,
    ],
    module: /\bfrom\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/,
    scopes: [
      /\bfunction\s*\*?\s*(?<n>[\w$]+)\s*[(<]/,
      /^\s*(?:(?:export|default|declare|abstract)\s+)*(?:class|interface|type|enum|namespace)\s+(?<n>[\w$]+)/,
      new RegExp(`^(?:export\\s+)?(?:declare\\s+)?${JS_VAR}`),
      new RegExp(`^\\s+${JS_VAR}\\s*(?::[^=]*)?=\\s*(?:${JS_FUNCTION}|(?:React\\.)?use[A-Z]\\w*\\s*(?:<.*>)?\\()`),
      new RegExp(`^\\s*${JS_HEAD}\\*?(?<n>(?!${JS_CONTROL}\\b)[\\w$#]+)\\s*(?:<[^>()]*>)?${ARGS}(?:\\s*:.+?)?\\s*\\{\\s*$`),
      new RegExp(`^\\s*${JS_MODS}(?:static\\s+)?(?<n>[\\w$#]+)\\s*(?:(?::[^=]*)?=|:)\\s*${JS_FUNCTION}`),
    ],
  },
  {
    exts: ["go"],
    patterns: (n) => [`^func${S}*(\\([^)]*\\)${S}*)?${n}${S}*[([]`, `^${S}*type${S}+${n}${END}`],
    values: (n) => [`^(var|const)${S}+${n}${END}`],
    locals: (n) => [
      `^\\s*(?:\\w+\\s*,\\s*)*${n}${E}\\s*(?:,\\s*\\w+\\s*)*:=`,
      `^\\s*(?:var|const)\\s+${n}${E}`,
      `^\\s*(?:import\\s+)?${n}\\s+"[^"]+"`,
    ],
    binders: (n) => [
      `\\bfunc\\b[^(]*\\((?:[^()]*?,)?\\s*${n}${E}(?:\\s*,|\\s+[\\w*\\[\\]<.(]|\\s*\\.\\.\\.)`,
      `\\bfunc\\s*\\([^()]*\\)\\s*\\w+\\s*(?:\\[[^\\]]*\\])?\\((?:[^()]*?,)?\\s*${n}${E}(?:\\s*,|\\s+[\\w*\\[\\]<.(]|\\s*\\.\\.\\.)`,
      `\\b(?:if|for|switch|case)\\b.*?[\\s,;]${n}${E}\\s*(?:,\\s*\\w+\\s*)*:=`,
    ],
    params: (n) => [`^\\s*${n}${E}(?:\\s*,|\\s+[\\w*\\[\\]<.(])`],
    module: /^\s*(?:import\s+)?[\w.]*\s*"([^"]+)"\s*$/,
    scopes: [/^func\s*(?:\(\s*(?:\w+\s+)?\*?(?<o>\w+)[^)]*\)\s*)?(?<n>\w+)\s*[(\[]/, /^type\s+(?<n>\w+)/, /^(?:var|const)\s+(?<n>\w+)/],
  },
  {
    exts: ["rs"],
    shorthand: true,
    patterns: (n) => [
      `${START}fn${S}+${n}${S}*[(<]`,
      `${START}(struct|enum|trait|type|union|mod|const|static)${S}+${n}${END}`,
      `macro_rules!${S}*${n}${END}`,
    ],
    values: () => [],
    locals: (n) => [
      `^\\s*let\\s+(?:mut\\s+)?${n}${E}`,
      `^\\s*let\\s+(?:mut\\s+)?[^=]*?[\\s({\\[,&]\\s*(?:mut\\s+|ref\\s+)*${LOWER}${n}${E}\\s*[,)}\\]:]`,
      `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?use\\b[^;]*?(?:::|[\\s{,])${n}${E}\\s*(?:[,;}]|$)`,
      `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?use\\b.*\\bas\\s+${n}${E}`,
    ],
    binders: (n) => [
      `\\bfn\\b[^(]*\\((?:[^()]*?,)?\\s*(?:mut\\s+)?${n}${E}\\s*:`,
      `\\|(?:[^|]*?,)?\\s*(?:mut\\s+|&)*${n}${E}\\s*(?:[:,][^|]*)?\\|`,
      `\\bfor\\s+(?:[^{]*?[\\s,(&])?(?:mut\\s+)?${n}${E}(?:\\s*[,)][^{]*?)?\\s+in\\b`,
      `\\b(?:if|while)\\s+let\\b[^=]*?[\\s({,&]${LOWER}${n}${E}[^=]*=(?!=)`,
      `[(\\s{,&|]${LOWER}${n}${E}\\s*(?:[,)}]|@)[^=]*=>`,
    ],
    params: (n) => [`^\\s*(?:mut\\s+)?${n}${E}\\s*:`],
    module: /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/,
    scopes: [
      /\bfn\s+(?<n>\w+)\s*[(<]/,
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:struct|enum|trait|union|mod)\s+(?<n>\w+)/,
      /^\s*(?:unsafe\s+)?impl\b(?:\s*<.*?>)?\s+(?:.*?\s+for\s+)?(?<n>[\w:]+)/,
      /^\s*macro_rules!\s*(?<n>\w+)/,
      /^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?(?<n>\w+)/,
    ],
  },
  {
    exts: ["c", "h", "cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "inl", "cu", "cuh", "m", "mm", "java", "cs"],
    patterns: (n) => [
      `^[^[:space:]#/][^;=]*[^[:alnum:]_$]${n}${S}*${OPENS}`,
      `^${n}${S}*${OPENS}`,
      `^${S}+([[:alnum:]_][[:alnum:]_:<>,*&]*${S}+)+[*&]*${n}${S}*${OPENS}`,
      `^${S}*#${S}*define${S}+${n}${END}`,
      `${START}(struct|class|union|enum|interface|record)${S}+([[:alnum:]_]+${S}+)*${n}${S}*([{:<]|$)`,
      `^${S}*typedef[^;]*[^[:alnum:]_]${n}${S}*;`,
      `${START}using${S}+${n}${S}*=`,
    ],
    values: () => [],
    locals: (n) => [
      `^\\s*${typed(n)}\\s*(?:[=;,\\[({:]|$)`,
      `^\\s*${C_TYPE}(?:\\s*[*&]+\\s*|\\s+)[^;=(]*,\\s*[*&]*\\s*${n}${E}\\s*(?:[=;,\\[]|$)`,
      `^\\s*template\\s*<[^>]*\\b(?:typename|class)\\s+(?:\\.\\.\\.\\s*)?${n}${E}`,
    ],
    binders: (n) => [
      `^\\s*(?!(?:\\}\\s*)?(?:if|else|for|while|switch|do|return)\\b).*[(,]\\s*${typed(n)}\\s*(?:\\[[^\\]]*\\])?\\s*(?:[,)=]|$)`,
      `\\b(?:for|if|while|switch|foreach|using|catch|lock|fixed)\\s*\\(\\s*${typed(n)}\\s*(?:[=:;,)]|\\bin\\b|$)`,
      `${B}${n}(?:\\s+->|\\s*=>)`,
      `\\((?:[^()]*?,)?\\s*(?:${C_TYPE}(?:\\s*[*&]+\\s*|\\s+))?${n}${E}\\s*(?:,[^()]*)?\\)(?:\\s+->|\\s*=>)`,
    ],
    params: (n) => [`(?:^|[(,])\\s*${typed(n)}\\s*(?:\\[[^\\]]*\\])?\\s*(?:[,)=]|$)`],
    scopes: [
      new RegExp(`^(?![\\s#/}])(?:[^;=(]*?[^\\w$:~])?${C_NAME}\\s*${C_OPENS}`),
      new RegExp(`^\\s+(?!${C_KEYWORD}\\b)(?:[\\w@<][\\w:<>,.?*&\\[\\]]*\\s+)+[*&]*${C_NAME}\\s*${C_OPENS}`),
      /^\s*(?:(?:typedef|public|private|protected|internal|static|final|abstract|sealed|partial|export)\s+)*(?:struct|class|union|enum(?:\s+(?:class|struct))?|interface|record|namespace)\s+(?:[A-Z][A-Z0-9_]*(?:\([^)]*\))?\s+)?(?<n>\w+(?:::\w+)*)\s*(?:[{:<]|$|(?:final|extends|implements|permits|where)\b)/,
      /^(?![\s#/}])[^;=(]*?[^\w$](?<n>\w+)\s*(?:\[[^\]]*\]\s*)*=\s*\{?\s*$/,
    ],
  },
];

const KEYWORDS = "def|defp|defmodule|fn|fun|func|function|sub|proc|class|struct|interface|trait|object|module|type|enum|macro";

export const GENERIC: Language = {
  exts: [],
  patterns: (n) => [`${START}(${KEYWORDS})${S}+${n}${END}`],
  values: () => [],
  locals: (n) => [
    `^\\s*(?:(?:export|pub|public|private|protected|internal|open|override|static|final|readonly|declare(?:\\s+-\\w+)*)\\s+)*(?:let|var|val|const|local|my|our|alias)\\s+(?:mut\\s+)?[$@%]?${n}${E}`,
    `^\\s*(?:(?:export|local|readonly|declare(?:\\s+-\\w+)*)\\s+)?[$@%]?${n}\\s*=(?![=~>])`,
    `^\\s*(?:function\\s+)?${n}\\s*\\(\\s*\\)\\s*\\{?\\s*$`,
  ],
  binders: (n) => [
    `\\b(?:def|fn|fun|func|function|sub|proc|lambda|init)\\b[^(]*\\((?:[^()]*?,)?\\s*(?:\\w+\\s+)?[$@%&*]*${n}${E}\\s*(?:[,:)]|=(?!=)|$)`,
    `\\|(?:[^|]*?,)?\\s*${n}${E}\\s*(?:,[^|]*)?\\|`,
    `\\bfor(?:each)?\\s+\\(?(?:\\w+\\s*,\\s*)*[$]?${n}${E}(?:\\s*,\\s*\\w+)*\\s+in\\b`,
  ],
  params: (n) => [`^\\s*(?:\\w+\\s+)?[$@%&*]*${n}${E}\\s*(?:[,:)]|=(?!=)|$)`],
  scopes: [
    new RegExp(
      `^\\s*(?:(?:export|pub|public|private|protected|internal|open|override|static|final|abstract|async|local|suspend|inline|data|sealed)\\s+)*(?:${KEYWORDS})\\s+(?:self\\.)?(?<n>[\\w$.:]*[\\w$][?!]?)`,
    ),
    /^\s*(?:function\s+)?(?<n>[\w-]+)\s*\(\s*\)\s*\{?\s*$/,
  ],
};

export function languageOf(filePath: string): Language {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGES.find((l) => l.exts.includes(ext)) ?? GENERIC;
}

const fromPosix = (pattern: string) => pattern.replaceAll("[:space:]", "\\s").replaceAll("[:alnum:]", "A-Za-z0-9");

const finder = (sources: string[]) => {
  const all = sources.map((s) => new RegExp(s, "d"));
  return (line: string): number[] =>
    all.flatMap((r) => {
      const at = r.exec(line)?.indices?.groups?.n?.[0];
      return at === undefined ? [] : [at];
    });
};

function indentOf(line: string): number {
  let n = 0;
  for (const c of line) {
    if (c === " ") n++;
    else if (c === "\t") n += 8 - (n % 8);
    else break;
  }
  return n;
}

const NO_SCOPE = /^(?:$|\/\/|\/\*|\*(?:\s|\/|$)|--|#(?!\s*define\b)|(?:case\b.*|\w+)\s*:\s*(?:(?:\/\/|#|\/\*).*)?$)/;
const CONTROL = /^(?:\}\s*)?(?:if|else|elif|for|foreach|while|until|unless|switch|return|assert)\b/;

function closesList(t: string): boolean {
  if (t === "{") return true;
  return (
    /^[)\]}]/.test(t) &&
    !/^[)\]}]+\s*[.;,]/.test(t) &&
    !/^\}\s*(?:else|catch|finally|while|elif|except)\b/.test(t) &&
    /(?:\{|=>\s*\(?|:)\s*$/.test(t)
  );
}

function opener(lines: string[], closer: number, indent: number): string {
  for (let k = closer - 1; k >= 1; k--) {
    const t = lines[k - 1]!.trim();
    if (!NO_SCOPE.test(t) && indentOf(lines[k - 1]!) <= indent) return t;
  }
  return "";
}

export function scopeOf(text: string, no: number, col: number, name: string, filePath: string): Scoped {
  const lines = text.split("\n");
  const line = lines[no - 1];
  if (line === undefined || line.slice(col, col + name.length) !== name) return { kind: "free" };

  const before = line.slice(0, col);
  if (/(?:\.|->|::)\s*$/.test(before) && !/\.\.\.\s*$/.test(before)) {
    return { kind: "member", own: /(?<![\w$.])(?:this|self|cls)\s*(?:\.|->)\s*$/.test(before), call: /^\s*(?:<[^()]*>)?\(/.test(line.slice(col + name.length)) };
  }

  const lang = languageOf(filePath);
  const n = `(?<n>${name.replaceAll("$", "\\$")})`;
  const declared = finder([...lang.patterns(n), ...lang.values(n)].map(fromPosix).concat(lang.locals(n)));
  const bound = finder(lang.binders(n));
  const listed = finder(lang.params(n));
  const declares = (l: string) => declared(l).length > 0;
  const binds = (l: string) => bound(l).length > 0;
  const param = (l: string) => listed(l).length > 0;
  const at = (k: number): Scoped => {
    const found = k === no ? null : lang.module?.exec(lines[k - 1]!);
    return { kind: "bound", line: k, module: found?.slice(1).find((m) => m !== undefined) ?? null };
  };

  const here = [...declared(line), ...bound(line), ...(inList(lines, no) ? listed(line) : [])];
  if (here.includes(col)) return { kind: "declared" };
  if (here.some((c) => c < col)) return at(no);
  if (usesOf(text, filePath)(no, col, name).key) return { kind: "member", own: false, call: false };

  let min = indentOf(line);
  let list: { indent: number; params: boolean } | null = null;
  for (let k = no - 1; k >= 1; k--) {
    const l = lines[k - 1]!;
    const t = l.trim();
    if (NO_SCOPE.test(t)) continue;
    const i = indentOf(l);
    if (list && i > list.indent) {
      if (list.params && param(l)) return at(k);
      continue;
    }
    const opened = list;
    list = null;
    if (i > min) continue;

    const encloses = i < min || opened !== null;
    min = i;
    if (declares(l) || (encloses && binds(l))) return at(k);
    if (opened?.params && l.slice(l.lastIndexOf("(") + 1).split(",").some(param)) return at(k);
    if (encloses && !opened && closesList(t)) list = { indent: i, params: !CONTROL.test(opener(lines, k, i)) };
  }
  return here.length ? at(no) : { kind: "free" };
}

function inList(lines: string[], no: number): boolean {
  const indent = indentOf(lines[no - 1]!);
  for (let k = no + 1; k <= lines.length; k++) {
    const t = lines[k - 1]!.trim();
    if (NO_SCOPE.test(t)) continue;
    const i = indentOf(lines[k - 1]!);
    if (i >= indent) continue;
    return t !== "{" && closesList(t) && !CONTROL.test(opener(lines, k, i));
  }
  return false;
}

const NAMES = 2;
const MACRO = /^\s*#\s*define\s+(\w+)/;

function reader(text: string) {
  const lines = text.split("\n");
  const indents: number[] = [];
  const indentAt = (k: number) => (indents[k] ??= /^(?:#|$)/.test(lines[k - 1]!.trim()) || NO_SCOPE.test(lines[k - 1]!.trim()) ? -1 : indentOf(lines[k - 1]!));
  return { lines, indentAt };
}

export function insideOf(text: string, filePath: string): (no: number) => string | null {
  const { lines, indentAt } = reader(text);
  const scopes = languageOf(filePath).scopes;
  const header = (k: number, indent: number): string => {
    const l = lines[k - 1]!.trimEnd();
    if (!l.endsWith("(")) return l;
    for (let d = k + 1; d <= lines.length; d++) {
      const i = indentAt(d);
      if (i >= 0 && i <= indent) return lines[d - 1]!.trim().startsWith(")") ? l + lines[d - 1]!.trim() : l;
    }
    return l;
  };

  return (no) => {
    const line = lines[no - 1];
    if (line === undefined) return null;
    let top = no;
    while (top > 1 && lines[top - 2]!.trimEnd().endsWith("\\")) top--;
    const macro = top < no ? MACRO.exec(lines[top - 1]!)?.[1] : undefined;
    if (macro) return macro;
    let next = no;
    while (next <= lines.length && indentAt(next) < 0) next++;
    let min = Math.max(indentOf(line), next <= lines.length ? indentAt(next) : 0);
    let opened = closesList(line.trim());

    const names: string[] = [];
    for (let k = no - 1; k >= 1 && (min > 0 || opened) && names.length < NAMES; k--) {
      const i = indentAt(k);
      if (i < 0 || i > min) continue;
      const encloses = i < min || opened;
      const under = opened;
      opened = false;
      min = i;
      if (!encloses) continue;

      const l = header(k, i);
      let found: Record<string, string | undefined> | undefined;
      for (const r of scopes) if ((found = r.exec(l)?.groups)) break;
      if (found?.n) names.unshift((found.o ? `${found.o}.${found.n}` : found.n).replace(/<[^<>]*>/g, ""));
      else opened = closesList(l.trim()) || (under && /^(?:[)\]]|where\b)/.test(l.trim()));
    }
    return names.length ? names.join(" \u203a ") : null;
  };
}

export type Role = "field" | "write";

const ASSIGN = "(?:[-+*/%&|^:]|<<|>>>?|\\*\\*|\\?\\?|\\|\\||&&)?=(?![=>~])";
const ASSIGNED = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${ASSIGN}|^\\s*(?:\\+\\+|--)`);
const ASSIGNED_WITH = new RegExp(`^\\s*(?:,\\s*[\\w$.*]+\\s*)+${ASSIGN}`);
const ANNOTATED = /^\s*:[^=:(){}]*[^=!<>:(){}]=(?![=>])/;
const MODS = "(?:(?:readonly|public|private|protected|internal|static|declare|override|abstract|final|pub(?:\\([^)]*\\))?|mut|const|volatile|export|default|-|\\+)\\s+)*";
const ONLY_MODS = new RegExp(`^\\s*${MODS}$`);
const C_FIELD_LEAD = /^\s*(?:[\w@][\w:<>,.?*&[\]]*\s+)+[*&\s]*$/;
const C_FIELD_REST = /^\s*(?:\[[^\]]*\]\s*)*(?:=[^;]*)?[;,]/;
const TYPE_HEAD = /\b(?:interface|class|struct|union|enum|trait)\b[^=]*$|\btype\s+[\w$]+(?:<[^=]*>)?\s*=(?!=)[^;]*$/;
const PATTERN_HEAD = /(?:^|[\s(,;])(?:const|let|var|import|export)(?:\s+type)?\s*$|\bfunction\b[^)]*\($|=\s*(?:async\s*)?\($/;
const TYPE_BEFORE = /[<|&]\s*$|\b(?:as|satisfies|extends)\s*$|\):\s*$|(?:\b(?:const|let|var)\s+|\(\s*)[\w$]+\??\s*:\s*$/;
const NOT_KEYS = /(?:>|\$)$/;
const JSX_VALUE = /[\w-]=$/;
const VALUE_BEFORE = /(?:^|[=(,[:?{|&]|\breturn|=>)\s*$/;
const TYPE_VALUE = /^\s*(?:readonly\s+)?(?:string|number|boolean|bigint|symbol|unknown|any|never)\b|^[^,;{}()]*;/;
const ANNOTATION = /`[^`]*\b\w+:$|@(?:JsonProperty|JsonAlias|JsonKey|SerializedName|SerialName)\s*\((?:[^)]*=\s*)?$|\b(?:\w*alias|rename)\s*=\s*$/;
const DEFINES = /\b(?:def|function|fn|func|fun|sub|lambda)\b[^()]*$/;
const ARROW_PARAMS = /^\s*(?::[^=()]*)?(?:,[^()]*)?\)\s*(?::[^=]+)?=>/;

const STRING = /(["'`])(?:\\.|(?!\1).)*\1/g;

interface Around {
  open: string;
  head: string;
  inner: string;
}

function enclosure(lead: string): Around | null {
  const stack: number[] = [];
  let quote = "";
  for (let i = 0; i < lead.length; i++) {
    const c = lead[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") stack.push(i);
    else if (c === ")" || c === "]" || c === "}") stack.pop();
  }
  const at = stack.at(-1);
  return at === undefined ? null : { open: lead[at]!, head: lead.slice(0, at).trimEnd(), inner: lead.slice(at + 1) };
}

function afterGroup(rest: string): string | null {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && depth-- === 0) return rest.slice(i + 1);
  }
  return null;
}

export function rolesOf(text: string, filePath: string): (no: number, col: number, name: string) => Role | null {
  const uses = usesOf(text, filePath);
  return (no, col, name) => uses(no, col, name).role;
}

function usesOf(text: string, filePath: string): (no: number, col: number, name: string) => { role: Role | null; key: boolean } {
  const { lines, indentAt } = reader(text);
  const lang = languageOf(filePath);

  const jsx = /\.[jt]sx$/.test(filePath);
  const yaml = /\.ya?ml$/.test(filePath);
  const around = (no: number, lead: string): Around => {
    const here = enclosure(lead);
    if (here) return here;
    const indent = indentOf(lines[no - 1]!);
    for (let k = no - 1; k >= 1; k--) {
      const i = indentAt(k);
      if (i < 0 || i >= indent) continue;
      const t = lines[k - 1]!.trim().replace(/\s*(?:\/\/|#\s).*$/, "");
      const open = t.at(-1) ?? "";
      return "([{:".includes(open) ? { open, head: t.slice(0, -1).trimEnd(), inner: "" } : { open: "", head: t, inner: "" };
    }
    return { open: "", head: "", inner: "" };
  };
  const kindOf = ({ open, head, inner }: Around, value: string) => {
    if (open === "(") return "params";
    if ((open !== "{" && open !== ":") || NOT_KEYS.test(head) || (jsx && JSX_VALUE.test(head))) return "other";
    if (TYPE_HEAD.test(head) || TYPE_BEFORE.test(head)) return "type";
    if (open === ":") return "other";
    if (PATTERN_HEAD.test(head)) return "pattern";
    if (/:\s*$/.test(head) && TYPE_VALUE.test(value)) return "type";
    if (/;/.test(`${inner} ${/^[^,{}()]*/.exec(value)![0]}`.replace(STRING, ""))) return "type";
    return jsx && !VALUE_BEFORE.test(head) ? "other" : "literal";
  };

  const closing = (no: number, lead: string, rest: string): string => {
    if (enclosure(lead)) return afterGroup(rest) ?? "";
    const indent = indentOf(lines[no - 1]!);
    for (let k = no + 1; k <= lines.length; k++) {
      const i = indentAt(k);
      if (i < 0 || i >= indent) continue;
      const t = lines[k - 1]!.trim();
      return t.startsWith("}") ? t.slice(1) : "";
    }
    return "";
  };

  const none = { role: null, key: false };
  const field = { role: "field" as const, key: true };
  return (no, col, name) => {
    const line = lines[no - 1];
    if (line === undefined || line.slice(col, col + name.length) !== name) return none;
    let lead = line.slice(0, col);
    let rest = line.slice(col + name.length);
    const quoted = /["'`]$/.test(lead) && /^["'`]/.test(rest);
    if (quoted) {
      if (ANNOTATION.test(lead.slice(0, -1))) return field;
      if (/^.\]\s*(?:[-+*/%&|^]|\?\?)?=(?![=>])/.test(rest)) return { role: "write", key: true };
      lead = lead.slice(0, -1);
      rest = rest.slice(1);
    }
    if (/(?:^|[\s(,])[\w$]+\??\s*:(?!:)[^=,;(){}]*$|\btype\s+$/.test(lead)) return none;
    if (/(?:\+\+|--)\s*(?:[\w$]+(?:\.|->))*$/.test(lead) && !/^(?:\.|->|\[)/.test(rest)) return { role: "write", key: false };
    const start = ONLY_MODS.test(lead);
    const key = /^\??\s*:(?![:=])/.test(rest);
    const short = lang.shorthand === true && /^\s*(?:[,}]|$)/.test(rest);
    const placed = start || /[{(,;]\s*$/.test(lead);

    if (!quoted && (ASSIGNED.test(rest) || ANNOTATED.test(rest) || (start && ASSIGNED_WITH.test(rest)))) {
      const at = around(no, lead);
      if (at.open === "(" && (DEFINES.test(at.head) || (start && inList(lines, no) && !/^(?:async\s+)?(?:with|class)\b/.test(at.head)))) return none;
      if (start && kindOf(at, "") === "type") return field;
      return { role: "write", key: jsx && /^=[{"']/.test(rest) };
    }
    if (yaml && key && /^\s*(?:-\s+)*$/.test(lead)) return { role: "write", key: true };
    if ((key || short) && placed) {
      const kind = kindOf(around(no, lead), rest.replace(/^\??\s*:/, ""));
      if (kind === "type") return key ? field : none;
      return kind === "literal" && !ARROW_PARAMS.test(closing(no, lead, rest)) ? { role: "write", key } : none;
    }
    if (!quoted && !line.includes("(") && kindOf(around(no, lead), "") === "type") {
      if (C_FIELD_LEAD.test(lead) && !/(?<!:):(?!:)/.test(lead) && C_FIELD_REST.test(rest)) return field;
      if (start && /^\s+[\w*[\]<.]/.test(rest)) return field;
    }
    return none;
  };
}

// Works out what a clicked name refers to from the text of its file alone. The lines above the click are read by their indentation: a line indented less than everything passed so far encloses the click, a line at that same indentation is an earlier statement of an enclosing block, and deeper lines belong to blocks that closed before the click.

export interface Language {
  exts: string[];
  // POSIX extended expressions for git grep: the lines that define the name for a whole repository.
  patterns: (name: string) => string[];
  // The rest are JavaScript expressions. Statements that declare the name for the lines after them in their block.
  locals: (name: string) => string[];
  // Lines that open a block and bind the name inside it: the parameters of a function, the variable of a loop.
  binders: (name: string) => string[];
  // One line of a parameter list wrapped over several lines.
  params: (name: string) => string[];
  // The module an import line takes its names from.
  module?: RegExp;
}

export type Scoped =
  // After "." "->" or "::". Scope says nothing about a member. own is set for this.name and self.name.
  | { kind: "member"; own: boolean }
  // The click is on the declaration itself.
  | { kind: "declared" }
  // module is set when that line imports the name.
  | { kind: "bound"; line: number; module: string | null }
  | { kind: "free" };

const S = "[[:space:]]";
const START = "(^|[^[:alnum:]_$])";
const END = "([^[:alnum:]_$]|$)";
const OPENS = "\\(([^;]*$|[^;{]*\\)[^;{]*\\{)";

// The name starts here and is not a member of something.
const B = "(?<![\\w$.])";
const E = "(?![\\w$])";

// A parameter that starts with its name, inside one pair of parentheses with none nested.
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
// In a Rust pattern a lower-case name is a binding, and an upper-case one is a variant or a type.
const LOWER = "(?=[a-z_])";
// A type, then the name.
const typed = (n: string) => `${C_TYPE}(?:\\s*[*&]+\\s*|\\s+)(?:const\\s+)?${n}${E}`;

export const LANGUAGES: Language[] = [
  {
    exts: ["py", "pyi"],
    patterns: (n) => [`^${S}*(async${S}+)?def${S}+${n}${S}*\\(`, `^${S}*class${S}+${n}${END}`, `^${n}${S}*(:[^=]*)?=([^=]|$)`],
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
  },
  {
    exts: ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"],
    patterns: (n) => [
      `${START}function${S}*\\*?${S}*${n}${S}*[(<]`,
      `${START}(class|interface|type|enum|namespace)${S}+${n}${END}`,
      `${START}(const|let|var)${S}+${n}${S}*(:[^=]*)?=([^=]|$)`,
      `^${S}*((public|private|protected|static|async|readonly|override|abstract|get|set)${S}+)*\\*?${n}${S}*(<[^>]*>)?\\([^;]*\\)[^;]*\\{${S}*$`,
      `^${S}*((public|private|protected|static|readonly|override)${S}+)*${n}${S}*(:[^=]*)?=${S}*(async${S}*)?(\\(|[[:alnum:]_$]+${S}*=>)`,
    ],
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
  },
  {
    exts: ["go"],
    patterns: (n) => [`^func${S}*(\\([^)]*\\)${S}*)?${n}${S}*[([]`, `^${S}*type${S}+${n}${END}`, `^(var|const)${S}+${n}${END}`],
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
  },
  {
    exts: ["rs"],
    patterns: (n) => [
      `${START}fn${S}+${n}${S}*[(<]`,
      `${START}(struct|enum|trait|type|union|mod|const|static)${S}+${n}${END}`,
      `macro_rules!${S}*${n}${END}`,
    ],
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
  },
];

const KEYWORDS = "def|defp|defmodule|fn|fun|func|function|sub|proc|class|struct|interface|trait|object|module|type|enum|macro";

// Any other file: the keywords most languages share.
export const GENERIC: Language = {
  exts: [],
  patterns: (n) => [`${START}(${KEYWORDS})${S}+${n}${END}`],
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
};

export function languageOf(filePath: string): Language {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGES.find((l) => l.exts.includes(ext)) ?? GENERIC;
}

const fromPosix = (pattern: string) => pattern.replaceAll("[:space:]", "\\s").replaceAll("[:alnum:]", "A-Za-z0-9");

// Where in a line the expressions put the name: its column for each one that matches. The name is the group n.
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

// Lines that open or close no scope: blank lines, comments, preprocessor lines and labels such as "default:" or "else:".
const NO_SCOPE = /^(?:$|\/\/|\/\*|\*(?:\s|\/|$)|--|#(?!\s*define\b)|(?:case\b.*|\w+)\s*:\s*(?:(?:\/\/|#).*)?$)/;
const CONTROL = /^(?:\}\s*)?(?:if|else|elif|for|foreach|while|until|unless|switch|return|assert)\b/;

// A line that ends a parameter list wrapped over several lines and opens the block: ") {", "}: Props) {", ") => (", ") -> int:", or the lone "{" under a header. A closing bracket on its own ends a call, not a parameter list.
function closesList(t: string): boolean {
  if (t === "{") return true;
  return (
    /^[)\]}]/.test(t) &&
    !/^[)\]}]+\s*[.;,]/.test(t) &&
    !/^\}\s*(?:else|catch|finally|while|elif|except)\b/.test(t) &&
    /(?:\{|=>\s*\(?|:)\s*$/.test(t)
  );
}

// The line a wrapped list starts on: the first one above that is not indented deeper than the line that closes it.
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
    return { kind: "member", own: /(?<![\w$.])(?:this|self|cls)\s*(?:\.|->)\s*$/.test(before) };
  }

  const lang = languageOf(filePath);
  const n = `(?<n>${name.replaceAll("$", "\\$")})`;
  const declared = finder([...lang.patterns(n).map(fromPosix), ...lang.locals(n)]);
  const bound = finder(lang.binders(n));
  const listed = finder(lang.params(n));
  const declares = (l: string) => declared(l).length > 0;
  const binds = (l: string) => bound(l).length > 0;
  const param = (l: string) => listed(l).length > 0;
  const at = (k: number): Scoped => {
    const found = k === no ? null : lang.module?.exec(lines[k - 1]!);
    return { kind: "bound", line: k, module: found?.slice(1).find((m) => m !== undefined) ?? null };
  };

  // On the clicked line the name counts as declared only from where the line declares it: in "t.Run(func(t *testing.T) {" the first t is not the parameter.
  const here = [...declared(line), ...bound(line), ...(inList(lines, no) ? listed(line) : [])];
  if (here.includes(col)) return { kind: "declared" };
  if (here.some((c) => c < col)) return at(no);

  let min = indentOf(line);
  // While walking up through a wrapped parameter list: the indentation of the line that closed it, and whether its lines are parameters.
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
  // A name declared later on its own line and nowhere above, as in a Python comprehension.
  return here.length ? at(no) : { kind: "free" };
}

// Whether a line is one of a parameter list wrapped over several lines: the next line indented less closes such a list.
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

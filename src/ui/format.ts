export interface TextEdit {
  from: number;
  to: number;
  text: string;
  start: number;
  end: number;
}

export type Format = "heading" | "bold" | "italic" | "quote" | "code" | "link" | "ordered" | "unordered" | "task";

export function format(kind: Format, value: string, start: number, end: number): TextEdit {
  switch (kind) {
    case "bold":
      return wrap(value, start, end, "**");
    case "italic":
      return wrap(value, start, end, "_");
    case "code":
      return value.slice(start, end).includes("\n") ? fence(value, start, end, "") : wrap(value, start, end, "`");
    case "link":
      return link(value, start, end);
    case "heading":
      return prefix(value, start, end, () => "### ", /^#{1,6} /);
    case "quote":
      return prefix(value, start, end, () => "> ", /^> ?/);
    case "unordered":
      return prefix(value, start, end, () => "- ", /^[-*] (?!\[[ xX]\] )/);
    case "ordered":
      return prefix(value, start, end, (i) => `${i + 1}. `, /^\d+\. /);
    case "task":
      return prefix(value, start, end, () => "- [ ] ", /^[-*] \[[ xX]\] /);
  }
}

export function suggestion(value: string, start: number, end: number, lines: string): TextEdit {
  return fence(value, start, end, "suggestion", lines);
}

function wrap(value: string, start: number, end: number, mark: string): TextEdit {
  const n = mark.length;
  if (value.slice(start - n, start) === mark && value.slice(end, end + n) === mark) {
    const text = value.slice(start, end);
    return { from: start - n, to: end + n, text, start: start - n, end: end - n };
  }
  const selected = value.slice(start, end);
  if (selected.length >= 2 * n && selected.startsWith(mark) && selected.endsWith(mark)) {
    const text = selected.slice(n, -n);
    return { from: start, to: end, text, start, end: start + text.length };
  }
  return { from: start, to: end, text: mark + selected + mark, start: start + n, end: end + n };
}

function link(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end);
  const text = `[${selected}](url)`;
  if (!selected) return { from: start, to: end, text, start: start + 1, end: start + 1 };
  const url = start + selected.length + 3;
  return { from: start, to: end, text, start: url, end: url + 3 };
}

function prefix(value: string, start: number, end: number, make: (i: number) => string, has: RegExp): TextEdit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", last);
  const to = nl < 0 ? value.length : nl;
  const lines = value.slice(from, to).split("\n");
  const remove = lines.every((l) => has.test(l));
  const text = lines.map((l, i) => (remove ? l.replace(has, "") : make(i) + l)).join("\n");
  if (start === end) return { from, to, text, start: from + text.length, end: from + text.length };
  return { from, to, text, start: from, end: from + text.length };
}

function fence(value: string, start: number, end: number, info: string, body?: string): TextEdit {
  const inner = body ?? value.slice(start, end);
  const before = start === 0 || value[start - 1] === "\n" ? "" : "\n";
  const after = end === value.length || value[end] === "\n" ? "" : "\n";
  const open = `${before}\`\`\`${info}\n`;
  const text = `${open}${inner}\n\`\`\`${after}`;
  return { from: start, to: end, text, start: start + open.length, end: start + open.length + inner.length };
}

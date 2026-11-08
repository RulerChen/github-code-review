import { Fragment, type ReactNode } from "react";

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+/;

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `markdown ${className}` : "markdown"}>{blocks(text)}</div>;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push(
        <pre key={out.length}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!)) items.push(lines[i++]!.replace(LIST_ITEM, ""));
      const children = items.map((item, k) => <li key={k}>{inline(item)}</li>);
      out.push(ordered ? <ol key={out.length}>{children}</ol> : <ul key={out.length}>{children}</ul>);
      continue;
    }

    if (HEADING.test(line)) {
      out.push(
        <p key={out.length}>
          <strong>{inline(line.replace(HEADING, ""))}</strong>
        </p>,
      );
      i++;
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !FENCE.test(lines[i]!) && !LIST_ITEM.test(lines[i]!) && !HEADING.test(lines[i]!)) {
      para.push(lines[i++]!.trim());
    }
    out.push(<p key={out.length}>{inline(para.join(" "))}</p>);
  }
  return out;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, k) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={k}>{part.slice(2, -2)}</strong>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

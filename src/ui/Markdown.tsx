import { Fragment, memo, type ReactNode } from "react";

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const TASK = /^\[([ xX])\]\s+/;
const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+/;
const QUOTE = /^\s*>\s?/;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export const Markdown = memo(function Markdown({ text, className, base }: { text: string; className?: string; base?: string }) {
  return <div className={className ? `markdown ${className}` : "markdown"}>{blocks(text, base)}</div>;
});

function blocks(text: string, base: string | undefined): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      const info = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      out.push(
        info === "suggestion" ? (
          <Suggestion key={out.length} base={base} lines={code} />
        ) : (
          <pre key={out.length}>
            <code>{code.join("\n")}</code>
          </pre>
        ),
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(lines[i++]!.replace(QUOTE, ""));
      out.push(<blockquote key={out.length}>{blocks(quoted.join("\n"), base)}</blockquote>);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!)) items.push(lines[i++]!.replace(LIST_ITEM, ""));
      const children = items.map((item, k) => {
        const task = TASK.exec(item);
        if (!task) return <li key={k}>{inline(item)}</li>;
        return (
          <li key={k} className="task">
            <input type="checkbox" checked={task[1] !== " "} disabled />
            {inline(item.slice(task[0].length))}
          </li>
        );
      });
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
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !FENCE.test(lines[i]!) &&
      !LIST_ITEM.test(lines[i]!) &&
      !HEADING.test(lines[i]!) &&
      !QUOTE.test(lines[i]!)
    ) {
      para.push(lines[i++]!.trim());
    }
    out.push(<p key={out.length}>{inline(para.join(" "))}</p>);
  }
  return out;
}

function Suggestion({ base, lines }: { base: string | undefined; lines: string[] }) {
  const removed = base === undefined ? [] : base.split("\n");
  return (
    <div className="suggestion">
      <div className="suggestion-head">Suggested change</div>
      <div className="suggestion-lines">
        {removed.map((l, k) => (
          <div key={`d${k}`} className="suggestion-line del" data-mark="-">
            {l}
          </div>
        ))}
        {lines.map((l, k) => (
          <div key={`a${k}`} className="suggestion-line add" data-mark="+">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

const INLINE =
  /(`[^`]+`|\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*]+\*\*|(?<![\w*])\*[^*\s](?:[^*]*[^*\s])?\*(?![\w*])|(?<!\w)_[^_\s](?:[^_]*[^_\s])?_(?!\w))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, k) => {
    if (k % 2 === 0) return <Fragment key={k}>{part}</Fragment>;
    if (part.startsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={k}>{inline(part.slice(2, -2))}</strong>;
    const link = LINK.exec(part);
    if (!link) return <em key={k}>{inline(part.slice(1, -1))}</em>;
    const [, label, url] = link;
    if (!SAFE_URL.test(url!)) return <Fragment key={k}>{inline(label!)}</Fragment>;
    return (
      <a key={k} href={url} target="_blank" rel="noreferrer">
        {inline(label!)}
      </a>
    );
  });
}

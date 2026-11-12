import { lexer, type MarkedToken, type Token } from "marked";
import { Fragment, memo, type ReactNode } from "react";

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export const Markdown = memo(function Markdown({ text, className, base }: { text: string; className?: string; base?: string }) {
  return <div className={className ? `markdown ${className}` : "markdown"}>{blocks(lexer(text, { gfm: true, breaks: true }), base)}</div>;
});

function blocks(tokens: Token[], base: string | undefined): ReactNode[] {
  return tokens.map((token, k) => {
    const t = token as MarkedToken;
    switch (t.type) {
      case "space":
      case "def":
        return null;
      case "paragraph":
        return <p key={k}>{inline(t.tokens)}</p>;
      case "heading": {
        const Heading = `h${Math.min(6, Math.max(1, t.depth))}` as "h1";
        return <Heading key={k}>{inline(t.tokens)}</Heading>;
      }
      case "code":
        return t.lang === "suggestion" ? (
          <Suggestion key={k} base={base} lines={t.text === "" ? [] : t.text.split("\n")} />
        ) : (
          <pre key={k}>
            <code>{t.text}</code>
          </pre>
        );
      case "blockquote":
        return <blockquote key={k}>{blocks(t.tokens, base)}</blockquote>;
      case "list": {
        const items = t.items.map((item, i) => (
          <li key={i} className={item.task ? "task" : undefined}>
            {blocks(item.tokens, base)}
          </li>
        ));
        if (!t.ordered) return <ul key={k}>{items}</ul>;
        return (
          <ol key={k} start={typeof t.start === "number" && t.start !== 1 ? t.start : undefined}>
            {items}
          </ol>
        );
      }
      case "table":
        return (
          <div key={k} className="markdown-table">
            <table>
              <thead>
                <tr>
                  {t.header.map((cell, i) => (
                    <th key={i} style={cell.align ? { textAlign: cell.align } : undefined}>
                      {inline(cell.tokens)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i} style={cell.align ? { textAlign: cell.align } : undefined}>
                        {inline(cell.tokens)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "hr":
        return <hr key={k} />;
      case "html":
        return <p key={k}>{t.text}</p>;
      default:
        return <Fragment key={k}>{inline([t])}</Fragment>;
    }
  });
}

function inline(tokens: Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, k) => {
    const t = token as MarkedToken;
    switch (t.type) {
      case "text":
        return <Fragment key={k}>{t.tokens ? inline(t.tokens) : t.text}</Fragment>;
      case "escape":
      case "html":
        return <Fragment key={k}>{t.text}</Fragment>;
      case "codespan":
        return <code key={k}>{t.text}</code>;
      case "strong":
        return <strong key={k}>{inline(t.tokens)}</strong>;
      case "em":
        return <em key={k}>{inline(t.tokens)}</em>;
      case "del":
        return <del key={k}>{inline(t.tokens)}</del>;
      case "br":
        return <br key={k} />;
      case "checkbox":
        return <input key={k} type="checkbox" checked={t.checked} disabled />;
      case "link":
        if (!SAFE_URL.test(t.href)) return <Fragment key={k}>{inline(t.tokens)}</Fragment>;
        return (
          <a key={k} href={t.href} target="_blank" rel="noreferrer">
            {inline(t.tokens)}
          </a>
        );
      case "image":
        return <Fragment key={k}>{t.text}</Fragment>;
      default:
        return <Fragment key={k}>{"tokens" in t && t.tokens ? inline(t.tokens) : t.raw}</Fragment>;
    }
  });
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

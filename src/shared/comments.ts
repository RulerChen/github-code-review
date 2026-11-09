export const MENTION = /(^|\s)@claude\b/i;

interface Lines {
  start: number;
  end: number;
}

export const lineNumbers = ({ start, end }: Lines) => (start === end ? `${start}` : `${start}–${end}`);

export const lineRange = (lines: Lines) => `${lines.start === lines.end ? "line" : "lines"} ${lineNumbers(lines)}`;

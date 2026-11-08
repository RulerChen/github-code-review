import type { FileDiff, FileStatus } from "../shared/types";

interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: { file: FileDiff; anchor: string }[];
}

function buildTree(entries: { file: FileDiff; anchor: string }[]): DirNode {
  const root: DirNode = { name: "", dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.file.path.split("/");
    parts.pop();
    let node = root;
    for (const part of parts) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { name: part, dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(entry);
  }
  return compress(root);
}

/** Join chains of single-child directories ("src" → "engine" becomes "src/engine"). */
function compress(node: DirNode): DirNode {
  for (const [key, child] of node.dirs) {
    let c = child;
    while (c.files.length === 0 && c.dirs.size === 1) {
      const only = [...c.dirs.values()][0]!;
      c = { ...only, name: `${c.name}/${only.name}` };
    }
    node.dirs.set(key, compress(c));
  }
  return node;
}

/** Tree order: at each level directories come before files, then names compare by locale. */
export function comparePaths(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const aDir = i < pa.length - 1;
    const bDir = i < pb.length - 1;
    if (aDir !== bDir) return aDir ? -1 : 1;
    const c = pa[i]!.localeCompare(pb[i]!);
    if (c !== 0) return c;
  }
  return 0;
}

const STATUS_GLYPH: Record<FileStatus, string> = { added: "+", deleted: "−", modified: "•", renamed: "→" };

interface Props {
  entries: { file: FileDiff; anchor: string }[];
  active: string | null;
  isViewed: (file: FileDiff) => boolean;
  onSelect: (anchor: string) => void;
}

export function FileTree({ entries, active, isViewed, onSelect }: Props) {
  const tree = buildTree(entries);
  if (entries.length === 0) return <p className="tree-empty">No matching files.</p>;
  return (
    <ul className="tree" role="tree">
      <TreeLevel node={tree} depth={0} active={active} isViewed={isViewed} onSelect={onSelect} />
    </ul>
  );
}

function TreeLevel({
  node,
  depth,
  active,
  isViewed,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  active: string | null;
  isViewed: (file: FileDiff) => boolean;
  onSelect: (anchor: string) => void;
}) {
  const indent = { paddingLeft: `${8 + depth * 14}px` };
  return (
    <>
      {[...node.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((dir) => (
          <li key={`d:${dir.name}`} role="treeitem" aria-expanded="true">
            <div className="tree-dir" style={indent}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z" />
              </svg>
              <span>{dir.name}</span>
            </div>
            <ul role="group">
              <TreeLevel node={dir} depth={depth + 1} active={active} isViewed={isViewed} onSelect={onSelect} />
            </ul>
          </li>
        ))}
      {node.files.map(({ file, anchor }) => (
        <li key={anchor} role="treeitem">
          <button
            className={`tree-file${active === anchor ? " is-active" : ""}${isViewed(file) ? " is-viewed" : ""}`}
            style={indent}
            onClick={() => onSelect(anchor)}
            title={file.path}
          >
            <span className={`status status-${file.status}`} aria-label={file.status}>
              {STATUS_GLYPH[file.status]}
            </span>
            <span className="tree-name">{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
          </button>
        </li>
      ))}
    </>
  );
}

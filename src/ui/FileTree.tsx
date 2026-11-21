import { type CSSProperties, memo, useEffect, useMemo, useRef } from "react";
import type { FileDiff } from "../shared/types";
import { useIsActiveFile } from "./active";
import { ChevronIcon, DirIcon, FileIcon, StatusIcon } from "./icons";
import { basename } from "./paths";

export interface TreeEntry {
  path: string;
  file: FileDiff | null;
  anchor: string | null;
}

interface DirNode {
  name: string;
  dirs: Map<string, DirNode>;
  files: TreeEntry[];
  changed: boolean;
}

function buildTree(entries: TreeEntry[]): DirNode {
  const root: DirNode = { name: "", dirs: new Map(), files: [], changed: false };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    parts.pop();
    let node = root;
    for (const part of parts) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { name: part, dirs: new Map(), files: [], changed: false };
        node.dirs.set(part, next);
      }
      if (entry.file) next.changed = true;
      node = next;
    }
    node.files.push(entry);
  }
  return compress(root);
}

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

export function dirPaths(entries: TreeEntry[], skipInside: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const walk = (node: DirNode, path: string) => {
    for (const dir of node.dirs.values()) {
      const dirPath = path ? `${path}/${dir.name}` : dir.name;
      out.push(dirPath);
      if (!skipInside.has(dirPath)) walk(dir, dirPath);
    }
  };
  walk(buildTree(entries), "");
  return out;
}

export function withDirsOf(dirs: ReadonlySet<string>, paths: string[]): ReadonlySet<string> {
  let next: Set<string> | null = null;
  for (const p of paths) {
    for (let at = p.indexOf("/"); at > 0; at = p.indexOf("/", at + 1)) {
      const dir = p.slice(0, at);
      if (dirs.has(dir) || next?.has(dir)) continue;
      next ??= new Set(dirs);
      next.add(dir);
    }
  }
  return next ?? dirs;
}

interface Props {
  entries: TreeEntry[];
  isViewed: (file: FileDiff) => boolean;
  onSelect: (entry: TreeEntry) => void;
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  current: string | null;
  marked: boolean;
}

export const FileTree = memo(function FileTree({ entries, ...rest }: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  if (entries.length === 0) return <p className="tree-empty">No matching files.</p>;

  return (
    <ul className="tree" role="tree">
      <TreeLevel node={tree} path="" depth={0} {...rest} />
    </ul>
  );
});

interface LevelProps extends Omit<Props, "entries"> {
  node: DirNode;
  path: string;
  depth: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const byFileName = (a: TreeEntry, b: TreeEntry) => basename(a.path).localeCompare(basename(b.path));

function TreeLevel({ node, path, depth, ...rest }: LevelProps) {
  const { isViewed, onSelect, isOpen, onToggle, current, marked } = rest;
  const indent = { "--depth": depth } as CSSProperties;
  return (
    <>
      {[...node.dirs.values()].sort(byName).map((dir) => {
        const dirPath = path ? `${path}/${dir.name}` : dir.name;
        const open = isOpen(dirPath);
        return (
          <li key={`d:${dir.name}`} role="treeitem" aria-expanded={open}>
            <button className="tree-dir" style={indent} onClick={() => onToggle(dirPath)} title={dirPath}>
              <span className="tree-toggle">
                <ChevronIcon />
              </span>
              <DirIcon open={open} className="tree-icon" />
              <span className="tree-name">{dir.name}</span>
              {marked && dir.changed && <span className="tree-changed" role="img" aria-label="Has changes" title="Has changed files" />}
            </button>
            {open && (
              <ul role="group">
                <TreeLevel node={dir} path={dirPath} depth={depth + 1} {...rest} />
              </ul>
            )}
          </li>
        );
      })}
      {[...node.files].sort(byFileName).map((entry) => (
        <TreeFile
          key={entry.path}
          entry={entry}
          viewed={entry.file !== null && isViewed(entry.file)}
          current={current}
          indent={indent}
          onSelect={() => onSelect(entry)}
        />
      ))}
    </>
  );
}

interface FileProps {
  entry: TreeEntry;
  viewed: boolean;
  current: string | null;
  indent: CSSProperties;
  onSelect: () => void;
}

function TreeFile({ entry, viewed, current, indent, onSelect }: FileProps) {
  const { path, file } = entry;
  const scrolled = useIsActiveFile(path);
  const active = current === null ? scrolled : current === path;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li role="treeitem" aria-current={active || undefined}>
      <button
        className={`tree-file${active ? " is-active" : ""}${viewed ? " is-viewed" : ""}`}
        style={indent}
        onClick={onSelect}
        title={path}
        ref={ref}
      >
        <span className="tree-toggle" />
        <FileIcon className="tree-icon" />
        <span className="tree-name">{basename(path)}</span>
        {file && <StatusIcon status={file.status} />}
      </button>
    </li>
  );
}

import { type CSSProperties, useState } from "react";
import type { FileDiff, FileStatus } from "../shared/types";
import { ChevronIcon } from "./FileCard";

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

// Octicons (16px) used by GitHub's file tree.
const FILE_ICON =
  "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z";
const DIR_ICON =
  "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z";
const DIR_OPEN_ICON =
  "M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z";
const STATUS_ICON: Record<FileStatus, string> = {
  added:
    "M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm10.5 1.5H2.75a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z",
  deleted:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm8.5 6.25h-6.5a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5Z",
  modified:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z",
  renamed:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm9.03 6.03-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H4.75a.75.75 0 0 1 0-1.5h4.69L7.47 5.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l3.25 3.25a.75.75 0 0 1 0 1.06Z",
};

function Octicon({ d, className, label }: { d: string; className: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" width="16" height="16" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} />
    </svg>
  );
}

interface Props {
  entries: { file: FileDiff; anchor: string }[];
  active: string | null;
  isViewed: (file: FileDiff) => boolean;
  onSelect: (anchor: string) => void;
}

export function FileTree({ entries, active, isViewed, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const tree = buildTree(entries);
  if (entries.length === 0) return <p className="tree-empty">No matching files.</p>;
  return (
    <ul className="tree" role="tree">
      <TreeLevel node={tree} path="" depth={0} active={active} isViewed={isViewed} onSelect={onSelect} collapsed={collapsed} onToggle={toggle} />
    </ul>
  );
}

interface LevelProps {
  node: DirNode;
  path: string;
  depth: number;
  active: string | null;
  isViewed: (file: FileDiff) => boolean;
  onSelect: (anchor: string) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
}

function TreeLevel({ node, path, depth, ...rest }: LevelProps) {
  const { active, isViewed, onSelect, collapsed, onToggle } = rest;
  const indent = { "--depth": depth } as CSSProperties;
  return (
    <>
      {[...node.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((dir) => {
          const dirPath = path ? `${path}/${dir.name}` : dir.name;
          const open = !collapsed.has(dirPath);
          return (
            <li key={`d:${dir.name}`} role="treeitem" aria-expanded={open}>
              <button className="tree-dir" style={indent} onClick={() => onToggle(dirPath)} title={dirPath}>
                <span className="tree-toggle">
                  <ChevronIcon />
                </span>
                <Octicon d={open ? DIR_OPEN_ICON : DIR_ICON} className="tree-icon" />
                <span className="tree-name">{dir.name}</span>
              </button>
              {open && (
                <ul role="group">
                  <TreeLevel node={dir} path={dirPath} depth={depth + 1} {...rest} />
                </ul>
              )}
            </li>
          );
        })}
      {node.files.map(({ file, anchor }) => (
        <li key={anchor} role="treeitem">
          <button
            className={`tree-file${active === anchor ? " is-active" : ""}${isViewed(file) ? " is-viewed" : ""}`}
            style={indent}
            onClick={() => onSelect(anchor)}
            title={file.path}
          >
            <span className="tree-toggle" />
            <Octicon d={FILE_ICON} className="tree-icon" />
            <span className="tree-name">{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
            <Octicon d={STATUS_ICON[file.status]} className={`tree-status status-${file.status}`} label={file.status} />
          </button>
        </li>
      ))}
    </>
  );
}

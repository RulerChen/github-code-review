import { type CSSProperties, useState } from "react";
import type { FileDiff } from "../shared/types";
import { ChevronIcon, DirIcon, FileIcon, StatusIcon } from "./icons";
import { basename } from "./paths";

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
                <DirIcon open={open} className="tree-icon" />
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
            <FileIcon className="tree-icon" />
            <span className="tree-name">{basename(file.path)}</span>
            <StatusIcon status={file.status} />
          </button>
        </li>
      ))}
    </>
  );
}

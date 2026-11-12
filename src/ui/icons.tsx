import type { ReactNode } from "react";
import type { FileStatus } from "../shared/types";

interface SvgProps {
  className?: string;
  size?: number;
  label?: string;
  children?: ReactNode;
}

function Svg({ className, size = 16, label, children }: SvgProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

export function Octicon({ d, ...props }: Omit<SvgProps, "children"> & { d: string }) {
  return (
    <Svg {...props}>
      <path d={d} />
    </Svg>
  );
}

const CHECK =
  "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z";

export const ChevronIcon = () => (
  <Octicon d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z" />
);

export const CaretIcon = () => (
  <Octicon d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
);

export const CheckIcon = () => <Octicon d={CHECK} />;

export const CheckMark = ({ checked }: { checked: boolean }) => <Svg className="picker-check">{checked && <path d={CHECK} />}</Svg>;

export const CommentIcon = () => (
  <Octicon d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
);

export const CopyIcon = () => (
  <Svg>
    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
  </Svg>
);

export const SwapIcon = () => (
  <Octicon d="M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3Zm5.56-6.5a.75.75 0 1 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.69L9.72 2.28a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3Z" />
);

export const SyncIcon = () => (
  <Octicon d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
);

export const MoonIcon = () => <Octicon d="M6.2 1.1a6.75 6.75 0 1 0 8.7 8.7A5.5 5.5 0 0 1 6.2 1.1Z" />;

export const SunIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="3" />
    <path
      d="M8 0.75v1.5M8 13.75v1.5M0.75 8h1.5M13.75 8h1.5M2.87 2.87l1.06 1.06M12.07 12.07l1.06 1.06M2.87 13.13l1.06-1.06M12.07 3.93l1.06-1.06"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const PencilIcon = () => (
  <Svg size={14}>
    <path d="M10.75 2.75l2.5 2.5L5.5 13H3v-2.5l7.75-7.75ZM9.25 4.25l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </Svg>
);

export const TrashIcon = () => (
  <Svg size={14}>
    <path
      d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.25 4.25l.6 8.6a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.6M6.75 7v4M9.25 7v4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const KeyboardIcon = () => (
  <Svg>
    <rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 6.5h.5M7.75 6.5h.5M11.5 6.5h.5M4.75 9.5h6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Svg>
);

export const ConversationIcon = () => (
  <Svg>
    <path
      d="M2.5 2.75h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8.25L5 14.25v-2.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </Svg>
);

const SIDEBAR = {
  collapse: [
    "M6.823 7.823a.25.25 0 0 1 0 .354l-2.396 2.396A.25.25 0 0 1 4 10.396V5.604a.25.25 0 0 1 .427-.177Z",
    "M1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0ZM1.5 1.75v12.5c0 .138.112.25.25.25H9.5v-13H1.75a.25.25 0 0 0-.25.25ZM11 14.5h3.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11Z",
  ],
  expand: [
    "m4.177 7.823 2.396-2.396A.25.25 0 0 1 7 5.604v4.792a.25.25 0 0 1-.427.177L4.177 8.177a.25.25 0 0 1 0-.354Z",
    "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25H9.5v-13Zm12.5 13a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25H11v13Z",
  ],
};

export const SidebarIcon = ({ open }: { open: boolean }) => (
  <Svg>
    <g transform="matrix(-1 0 0 1 16 0)">
      {SIDEBAR[open ? "collapse" : "expand"].map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  </Svg>
);

export type ExpandDir = "up" | "down" | "all";

const EXPAND: Record<ExpandDir, string> = {
  up: "M8 13V3M4.5 6.5 8 3l3.5 3.5",
  down: "M8 3v10M4.5 9.5 8 13l3.5-3.5",
  all: "M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3",
};

export const ExpandIcon = ({ dir }: { dir: ExpandDir }) => <Octicon d={EXPAND[dir]} />;

const FOLD = {
  fold: "M8 1.75v4M5.5 3.25 8 5.75l2.5-2.5M8 14.25v-4M5.5 12.75 8 10.25l2.5 2.5M2.75 8h10.5",
  unfold: "M8 5.75v-4M5.5 4.25 8 1.75l2.5 2.5M8 10.25v4M5.5 11.75 8 14.25l2.5-2.5M2.75 8h10.5",
};

export const FoldIcon = ({ fold }: { fold: boolean }) => (
  <Svg>
    <path d={fold ? FOLD.fold : FOLD.unfold} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const FileIcon = ({ className }: { className: string }) => (
  <Octicon
    className={className}
    d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"
  />
);

const DIR = {
  closed:
    "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z",
  open: "M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z",
};

export const DirIcon = ({ open, className }: { open: boolean; className: string }) => (
  <Octicon className={className} d={open ? DIR.open : DIR.closed} />
);

const STATUS: Record<FileStatus, string> = {
  added:
    "M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1Zm10.5 1.5H2.75a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z",
  deleted:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm8.5 6.25h-6.5a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5Z",
  modified:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z",
  renamed:
    "M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm9.03 6.03-3.25 3.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.97-1.97H4.75a.75.75 0 0 1 0-1.5h4.69L7.47 5.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l3.25 3.25a.75.75 0 0 1 0 1.06Z",
};

export const StatusIcon = ({ status }: { status: FileStatus }) => (
  <Octicon className={`tree-status status-${status}`} d={STATUS[status]} label={status} />
);

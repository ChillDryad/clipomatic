import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

export function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  actions,
}: CollapsibleSectionProps) {
  return (
    <div className="border border-[var(--ctp-overlay)] rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 bg-[var(--ctp-surface)] flex items-center justify-between text-left hover:bg-[var(--ctp-surface-2)]"
      >
        <span className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-widest">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {actions}
          <span className="text-xs text-[var(--ctp-subtext)]">
            {expanded ? "−" : "+"}
          </span>
        </div>
      </button>
      {expanded && <div className="p-3">{children}</div>}
    </div>
  );
}

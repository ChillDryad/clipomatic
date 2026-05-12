import { type ReactNode, cloneElement } from "react";

interface ToggleGroupItemProps {
  value: string;
  label?: string;
  description?: string;
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}

export function ToggleGroupItem({
  value,
  label,
  description,
  children,
  onClick,
  selected,
}: ToggleGroupItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-state={selected ? "on" : "off"}
      className="toggle-group-item flex-1 px-3 py-2 text-xs font-medium rounded-md border border-[var(--ctp-overlay)] bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)] hover:border-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] transition-colors data-[state=on]:bg-[var(--ctp-mauve)] data-[state=on]:text-[var(--ctp-base)] data-[state=on]:border-[var(--ctp-mauve)]"
    >
      {children || (
        <div className="flex flex-col items-center gap-0.5">
          {label && <span>{label}</span>}
          {description && (
            <span className="text-[10px] opacity-70">{description}</span>
          )}
        </div>
      )}
    </button>
  );
}

interface ToggleGroupProps {
  type: "single";
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function ToggleGroup({
  type,
  value,
  onValueChange,
  children,
  className = "",
}: ToggleGroupProps) {
  const items = Array.isArray(children) ? children : [children];

  return (
    <div
      role="group"
      className={`flex gap-1 ${className}`}
    >
      {items.map((item) => {
        const itemValue = (item as React.ReactElement<ToggleGroupItemProps>).props.value;
        const isSelected = value === itemValue;

        return cloneElement(item as React.ReactElement, {
          key: itemValue,
          selected: isSelected,
          onClick: () => onValueChange(itemValue),
        });
      })}
    </div>
  );
}

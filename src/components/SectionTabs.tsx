import type { ReactNode } from "react";

export type SectionTabItem<T extends string> = {
  id: T;
  label?: ReactNode;
  leading?: ReactNode;
  badge?: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
  activeClassName?: string;
  disabledClassName?: string;
  badgeClassName?: string;
};

type SectionTabsProps<T extends string> = {
  items: readonly SectionTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
  tabClassName?: string;
  activeTabClassName?: string;
  disabledTabClassName?: string;
  badgeClassName?: string;
};

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function hasBadge(value: ReactNode): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

export function SectionTabs<T extends string>({
  items,
  activeId,
  onChange,
  ariaLabel,
  className,
  tabClassName,
  activeTabClassName,
  disabledTabClassName,
  badgeClassName,
}: SectionTabsProps<T>) {
  return (
    <div className={classNames("ui-tabs__list", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === activeId;

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={classNames(
              "ui-tab",
              tabClassName,
              item.className,
              active && "ui-tab--active",
              active && activeTabClassName,
              active && item.activeClassName,
              item.disabled && "ui-tab--disabled",
              item.disabled && disabledTabClassName,
              item.disabled && item.disabledClassName,
            )}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (!item.disabled) onChange(item.id);
            }}
          >
            {item.content ?? (
              <>
                {item.leading}
                {item.label}
                {hasBadge(item.badge) ? (
                  <span className={classNames("ui-tab__badge", badgeClassName, item.badgeClassName)}>
                    {item.badge}
                  </span>
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

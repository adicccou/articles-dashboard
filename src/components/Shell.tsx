import type { ReactNode } from "react";

type ShellProps = {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  sidebarOpen?: boolean;
  sidebarCollapsed?: boolean;
  onBackdropClick?: () => void;
};

export function Shell({ header, sidebar, children, sidebarOpen = false, sidebarCollapsed = false, onBackdropClick }: ShellProps) {
  return (
    <div className={`shell${sidebarOpen ? " shell--sidebar-open" : ""}${sidebarCollapsed ? " shell--sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="shell__backdrop"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onBackdropClick}
      />
      <aside className="shell__sidebar">{sidebar}</aside>
      <main className="shell__main">
        <div className="shell__header">{header}</div>
        <div className="shell__content">{children}</div>
      </main>
    </div>
  );
}

import type { ReactNode } from "react";

type ShellProps = {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
};

export function Shell({ header, sidebar, children }: ShellProps) {
  return (
    <div className="shell">
      <aside className="shell__sidebar">{sidebar}</aside>
      <main className="shell__main">
        <div className="shell__header">{header}</div>
        <div className="shell__content">{children}</div>
      </main>
    </div>
  );
}

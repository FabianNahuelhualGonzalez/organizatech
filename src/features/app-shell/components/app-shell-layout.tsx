import type { ReactNode } from "react";

export interface AppShellLayoutProps {
  topbar?: ReactNode;
  notificationOverlay?: ReactNode;
  navigationOverlay?: ReactNode;
  screenHeader?: ReactNode;
  children: ReactNode;
}

export function AppShellLayout({
  topbar,
  notificationOverlay,
  navigationOverlay,
  screenHeader,
  children,
}: AppShellLayoutProps) {
  return (
    <main className="app-shell">
      {topbar}
      {notificationOverlay}
      {navigationOverlay}
      {screenHeader}
      {children}
    </main>
  );
}

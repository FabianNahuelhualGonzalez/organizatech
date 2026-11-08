import type { ReactNode } from "react";

export interface AppShellLayoutProps {
  topbar?: ReactNode;
  notificationOverlay?: ReactNode;
  navigationOverlay?: ReactNode;
  screenHeader?: ReactNode;
  isContentWide?: boolean;
  children: ReactNode;
}

export function AppShellLayout({
  topbar,
  notificationOverlay,
  navigationOverlay,
  screenHeader,
  isContentWide = false,
  children,
}: AppShellLayoutProps) {
  return (
    <main className={`app-shell${isContentWide ? " app-shell-wide" : ""}`}>
      {topbar}
      {notificationOverlay}
      {navigationOverlay}
      {screenHeader}
      {children}
    </main>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

/** Shared dashboard shell; authorization must occur before tenant data is read. */
export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="dashboard-shell">
      <aside>
        <span className="brand">Chairly</span>
        <nav aria-label="Business dashboard">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/appointments">Appointments</Link>
          <Link href="/dashboard/settings">Settings</Link>
        </nav>
      </aside>
      <main>{children}</main>
    </div>
  );
}

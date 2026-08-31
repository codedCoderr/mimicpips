"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, FlaskConical, LayoutDashboard, LogOut, Megaphone, Receipt, Users } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { clearSession } from "@/lib/session";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/ledger", label: "Ledger", icon: Receipt },
  { href: "/dashboard/backtest", label: "Backtest", icon: FlaskConical },
  { href: "/dashboard/followers", label: "Followers", icon: Users },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone },
];

interface OperatorHeaderProps {
  status?: ReactNode;
}

export function OperatorHeader({ status }: OperatorHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleDisconnect() {
    clearSession();
    await fetch("/api/operator/bot-session", { method: "DELETE" }).catch(() => { });
    await fetch("/api/logout", { method: "POST" }).catch(() => { });
    router.push("/login");
  }

  return (
    <header className="border-b border-[var(--hairline)] bg-[var(--bg)]/95 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <BrandMark label="Mimic Pips" />
        <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono text-[var(--muted)]">
          <BarChart3 size={13} />
          <span>Leader control room</span>
        </div>
        {status}
      </div>
      <div className="flex items-center justify-between gap-4 px-6 pb-3 overflow-x-auto">
        <nav aria-label="Leader dashboard navigation" className="flex items-center gap-1 min-w-max">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                aria-current={active ? "page" : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono border transition-colors"
                style={{
                  color: active ? "var(--text)" : "var(--muted)",
                  borderColor: active ? "var(--long-dim)" : "transparent",
                  background: active ? "rgba(61, 214, 140, 0.08)" : "transparent",
                }}
              >
                <Icon size={13} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors min-w-max"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </header>
  );
}

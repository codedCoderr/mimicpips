"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CreditCard, Link2, LogOut, ShieldCheck, User } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const navItems = [
  { href: "/app/dashboard", label: "Dashboard", icon: ShieldCheck },
  { href: "/app/profile", label: "Profile", icon: User },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
  { href: "/app/performance", label: "Performance", icon: BarChart3 },
  { href: "/app/connect", label: "Exchange", icon: Link2 },
];

export function FollowerHeader({ status }: { status?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/saas/logout", { method: "POST" }).catch(() => { });
    router.push("/app/login");
  }

  return (
    <header className="border-b border-[var(--hairline)] bg-[var(--bg)]/95 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <BrandMark label="Mimic Pips" />
        <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono text-[var(--muted)]">
          <ShieldCheck size={13} />
          <span>Follower workspace</span>
        </div>
        {status}
      </div>
      <div className="flex items-center justify-between gap-4 px-6 pb-3 overflow-x-auto">
        <nav aria-label="Follower dashboard navigation" className="flex items-center gap-1 min-w-max">
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
        <button type="button" onClick={() => void handleLogout()} className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors min-w-max">
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </header>
  );
}

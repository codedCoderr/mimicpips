"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CreditCard, Receipt, CheckCircle2 } from "lucide-react";
import { openPaystackCheckout } from "@/lib/paystackClient";

interface SubscriptionInfo {
  status: string;
  monthlyFeeNGN: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  lastChargedAt: string | null;
}

interface InvoiceItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  endBalanceUSD: number;
  priorPeakBalanceUSD: number;
  profitAboveHighWaterMarkUSD: number;
  feePercent: number;
  feeAmountUSD: number;
  feeAmountNGN: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNgn(n: number): string {
  return `₦${n?.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    PENDING_APPROVAL: { color: "var(--warn)", label: "AWAITING YOUR APPROVAL" },
    APPROVED: { color: "var(--warn)", label: "PAYMENT PENDING" },
    PAID: { color: "var(--long)", label: "PAID" },
    WAIVED: { color: "var(--muted)", label: "WAIVED" },
    EXPIRED: { color: "var(--short)", label: "EXPIRED" },
  };
  const entry = map[status] ?? { color: "var(--muted)", label: status };
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap"
      style={{ color: entry.color, border: `1px solid ${entry.color}` }}
    >
      {entry.label}
    </span>
  );
}

function InvoiceCard({ invoice, onPay }: { invoice: InvoiceItem; onPay: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/saas/invoices/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Could not start payment.");
        return;
      }
      await openPaystackCheckout({
        accessCode: data.accessCode,
        authorizationUrl: data.authorizationUrl,
        onSuccess: () => onPay(invoice.id),
        onCancel: () => setBusy(false),
      });
      // Not calling setBusy(false) on success here — the page navigates
      // away (onPay triggers a reload of the invoice list) or the popup
      // stays open, so leaving the button disabled avoids a duplicate
      // click while Paystack's own success flow resolves.
      return;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-[var(--muted)]">
          {new Date(invoice.periodStart).toLocaleDateString()} –{" "}
          {new Date(invoice.periodEnd).toLocaleDateString()}
        </span>
        <StatusPill status={invoice.status} />
      </div>

      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Balance at period end</span>
          <span className="tabular">{fmtUsd(invoice.endBalanceUSD)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Your prior high-water mark</span>
          <span className="tabular">{fmtUsd(invoice.priorPeakBalanceUSD)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-1.5">
          <span className="text-[var(--muted)]">Profit above high-water mark</span>
          <span className="tabular font-semibold" style={{ color: "var(--long)" }}>
            {fmtUsd(invoice.profitAboveHighWaterMarkUSD)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[var(--hairline)]">
        <span className="text-sm text-[var(--muted)]">
          Fee ({(invoice.feePercent * 100).toFixed(0)}% of profit above your peak)
        </span>
        <div className="text-right">
          <span className="font-display font-semibold text-lg block">{fmtNgn(invoice.feeAmountUSD)}</span>
          <span className="text-[10px] font-mono text-[var(--muted-dim)]">
            ({fmtUsd(invoice.feeAmountUSD)} at time of invoice)
          </span>
        </div>
      </div>

      {error && (
        <p className="text-xs font-mono text-[var(--short)]">{error}</p>
      )}

      {invoice.status === "PENDING_APPROVAL" && (
        <button
          onClick={() => void handlePay()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                     font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                     disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
          Review and pay {fmtNgn(invoice.feeAmountUSD)}
        </button>
      )}
    </div>
  );
}

export default function BillingPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{ monthlyFeeUSD: number; monthlyFeeNGN: number } | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [subLoading, setSubLoading] = useState(true);

  const loadSubscription = useCallback(() => {
    setSubLoading(true);
    fetch("/api/saas/billing/status")
      .then((res) => res.json())
      .then((data) => setSubscription(data.subscription))
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, []);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  useEffect(() => {
    fetch("/api/saas/billing/pricing")
      .then((res) => res.json())
      .then((data) => {
        if (data.monthlyFeeNGN) setPricing(data);
      })
      .catch(() => {});
  }, []);

  const loadInvoices = useCallback(() => {
    fetch("/api/saas/invoices")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load invoices.");
        setInvoices(data.invoices);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  async function handleSubscribe() {
    setSubscribing(true);
    setSubscribeError(null);
    try {
      const res = await fetch("/api/saas/billing/subscribe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSubscribeError(data?.error ?? "Could not start subscription.");
        return;
      }
      await openPaystackCheckout({
        accessCode: data.accessCode,
        authorizationUrl: data.authorizationUrl,
        onSuccess: () => {
          loadSubscription();
        },
        onCancel: () => setSubscribing(false),
      });
      return;
    } catch {
      // This only fires for a genuine failure reaching OUR server
      // (the fetch to /api/saas/billing/subscribe) — openPaystackCheckout
      // handles its own failure modes internally (falls back to a
      // redirect rather than throwing), so a message here specifically
      // means our own API call failed.
      setSubscribeError("Could not reach the server.");
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/dashboard")}
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <div className="flex items-center gap-2">
            <Receipt size={16} />
            <span className="font-display font-semibold text-lg">Billing</span>
          </div>
        </div>
      </header>

      <div className="flex-1 p-6">
        <div className="max-w-[560px] mx-auto space-y-6">
          <div className="panel p-5 space-y-3">
            <span className="eyebrow">Subscription</span>

            {subscription?.status === "ACTIVE" ? (
              <>
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--long)" }}>
                  <CheckCircle2 size={16} />
                  <span className="font-semibold">Active</span>
                </div>
                <div className="space-y-1.5 font-mono text-xs text-[var(--muted)]">
                  <div className="flex items-center justify-between">
                    <span>Monthly fee</span>
                    <span className="tabular">{fmtNgn(subscription.monthlyFeeNGN)}</span>
                  </div>
                  {subscription.currentPeriodEnd && (
                    <div className="flex items-center justify-between">
                      <span>Next charge</span>
                      <span className="tabular">
                        {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : subscription?.status === "PAST_DUE" ? (
              <>
                <p className="text-sm text-[var(--short)] font-semibold">
                  Payment failed — your subscription is past due.
                </p>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Resubscribe below to update your payment method and
                  restore access.
                </p>
                {subscribeError && (
                  <p className="text-xs font-mono text-[var(--short)]">{subscribeError}</p>
                )}
                <button
                  onClick={() => void handleSubscribe()}
                  disabled={subscribing || !pricing}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                             font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                             disabled:opacity-50"
                >
                  {subscribing ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                  {subscribing ? "Starting…" : pricing ? `Update payment — ${fmtNgn(pricing.monthlyFeeNGN)}/month` : "Loading price…"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  {pricing ? fmtNgn(pricing.monthlyFeeNGN) : "…"}/month, billed
                  automatically. Plus a 30% fee on new profit above your
                  account's all-time high — only charged when you're ahead
                  of where you've ever been, and only after you review and
                  approve the exact amount.
                </p>
                {subscribeError && (
                  <p className="text-xs font-mono text-[var(--short)]">{subscribeError}</p>
                )}
                <button
                  onClick={() => void handleSubscribe()}
                  disabled={subscribing || !pricing || subLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                             font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                             disabled:opacity-50"
                >
                  {subscribing ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                  {subscribing ? "Starting…" : pricing ? `Subscribe — ${fmtNgn(pricing.monthlyFeeNGN)}/month` : "Loading price…"}
                </button>
              </>
            )}
          </div>

          <div>
            <span className="eyebrow block mb-3">Performance fee invoices</span>

            {error && (
              <p className="text-sm font-mono text-[var(--short)] border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
                {error}
              </p>
            )}

            {!error && invoices === null && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
              </div>
            )}

            {invoices && invoices.length === 0 && (
              <p className="text-sm text-[var(--muted)] font-mono">
                No performance fee invoices yet — these are generated
                automatically at the end of each billing period, only
                when you're ahead of your prior high-water mark.
              </p>
            )}

            {invoices && invoices.length > 0 && (
              <div className="space-y-3">
                {invoices.map((inv) => (
                  <InvoiceCard key={inv.id} invoice={inv} onPay={loadInvoices} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
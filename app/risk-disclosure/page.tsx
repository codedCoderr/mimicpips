export default function RiskDisclosurePage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-[var(--text)] space-y-6">
      <h1 className="text-2xl font-bold font-display">Risk Disclosure Statement</h1>
      <p className="text-xs font-mono text-[var(--muted)]">Last Updated: August 2026 | Version 1.0.0</p>
      
      <div className="space-y-4 text-sm leading-relaxed text-[var(--muted)]">
        <p>
          Trading digital assets, futures, and leveraged financial products involves high operational and market risk. You should carefully evaluate whether trading is suitable for your financial situation.
        </p>

        <strong className="block text-[var(--text)]">1. No Investment Advice</strong>
        <p>
          This platform operates as an automated signal and trade-copying execution tool. The services provided do not constitute financial, investment, or legal advice.
        </p>

        <strong className="block text-[var(--text)]">2. Limitation of Liability</strong>
        <p>
          Under no circumstances shall the platform or its developers be liable for lost profits, trading losses, software execution failures, exchange latency, or market slippage resulting from automated API order submission.
        </p>

        <strong className="block text-[var(--text)]">3. Non-Custodial Safeguards</strong>
        <p>
          Users must ensure API keys connected to this platform strictly restrict withdrawal permissions. The platform is not responsible for securing third-party exchange credentials on external services.
        </p>
      </div>
    </main>
  );
}
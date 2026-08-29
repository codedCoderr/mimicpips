function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-[var(--panel)] border border-[var(--hairline)] animate-pulse ${className}`}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 max-w-[1400px] mx-auto">
      <div className="space-y-6 min-w-0">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Block key={i} className="h-[84px]" />
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--hairline)]">
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} className="h-[76px]" />
          ))}
        </div>
        <Block className="h-[240px]" />
        <Block className="h-[200px]" />
        <Block className="h-[220px]" />
      </div>
      <div className="space-y-6">
        <Block className="h-[260px]" />
        <Block className="h-[180px]" />
      </div>
    </div>
  );
}
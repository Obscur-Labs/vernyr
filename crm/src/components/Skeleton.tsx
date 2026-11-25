export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div className={`h-4 bg-muted rounded animate-pulse ${className}`} />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-card border border-line rounded-2xl p-5 space-y-3 animate-pulse">
      <div className="h-5 bg-muted rounded w-1/3" />
      <div className="h-8 bg-muted rounded w-1/2" />
      <div className="h-4 bg-muted rounded w-2/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-4 px-4 py-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-4 bg-muted rounded animate-pulse" />
        ))}
      </div>
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-4 px-4 py-3 bg-card border border-line rounded-xl">
          {[...Array(4)].map((_, j) => (
            <div key={j} className={`h-4 bg-muted rounded animate-pulse ${j === 0 ? 'w-3/4' : j === 3 ? 'w-1/2' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

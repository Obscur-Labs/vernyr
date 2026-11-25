export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`bg-muted rounded-lg animate-pulse ${className}`} />;
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} className={`h-4 ${i === 0 ? 'w-3/4' : 'w-1/2'}`} />
      ))}
    </div>
  );
}

export function DocCardSkeleton() {
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-muted animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonLine className="h-4 w-1/3" />
        <SkeletonLine className="h-3 w-1/4" />
      </div>
      <SkeletonLine className="h-7 w-20 rounded-full" />
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {[true, false, true, true, false].map((right, i) => (
        <div key={i} className={`flex ${right ? 'justify-end' : ''}`}>
          <div className={`h-9 rounded-2xl bg-muted animate-pulse ${right ? 'w-40' : 'w-52'}`} />
        </div>
      ))}
    </div>
  );
}

export function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-2xl border border-line bg-surface">
      <div className="w-9 h-9 rounded-xl bg-muted animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonLine className="h-4 w-1/2" />
        <SkeletonLine className="h-3 w-3/4" />
      </div>
    </div>
  );
}

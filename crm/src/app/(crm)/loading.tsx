import { Skeleton, SkeletonList } from '@/components/ui';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <SkeletonList rows={6} />
    </div>
  );
}

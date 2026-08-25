'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * A dynamic route only knows its record's id from the URL, so the last crumb
 * would read `/students/6a85…` until the page has loaded the record. Pages call
 * `useBreadcrumbTail(name)` to replace it once they know the real name.
 */
const BreadcrumbContext = createContext<{
  tail: string | undefined;
  setTail: (v: string | undefined) => void;
}>({ tail: undefined, setTail: () => {} });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<string | undefined>(undefined);
  return (
    <BreadcrumbContext.Provider value={{ tail, setTail }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export const useBreadcrumb = () => useContext(BreadcrumbContext);

/** Names the last crumb, and clears it on unmount so it cannot leak to the next page. */
export function useBreadcrumbTail(label: string | undefined) {
  const { setTail } = useBreadcrumb();
  useEffect(() => {
    setTail(label);
    return () => setTail(undefined);
  }, [label, setTail]);
}

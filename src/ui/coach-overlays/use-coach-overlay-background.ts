"use client";

import { useEffect, type RefObject } from "react";

// Scoped inert leases, not a focus stack. Overlapping sheets cannot unlock the
// same background prematurely. The canonical overlay engine still owns focus.
const leases = new WeakMap<HTMLElement, { count: number; original: boolean }>();

export function useCoachOverlayBackground(isActive: boolean, backgroundRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!isActive || !backgroundRef.current) return;
    const background = backgroundRef.current;
    const lease = leases.get(background) ?? { count: 0, original: background.inert };
    lease.count += 1;
    leases.set(background, lease);
    background.inert = true;
    return () => {
      lease.count -= 1;
      if (lease.count !== 0) return;
      background.inert = lease.original;
      leases.delete(background);
    };
  }, [isActive, backgroundRef]);
}

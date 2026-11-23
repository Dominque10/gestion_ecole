"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recharge la page toutes les 3 secondes tant que le paiement attend la confirmation. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

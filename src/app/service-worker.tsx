"use client";

import { useEffect } from "react";

/** Installe le service worker (version de production seulement : il est construit après le build). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sans service worker, l'application marche avec du réseau ; rien d'autre à faire.
    });
  }, []);
  return null;
}

"use client";
import { useEffect, useState } from "react";

/** Read a query-string parameter on the client (static export friendly). */
export function useQueryParam(name: string): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return v;
}

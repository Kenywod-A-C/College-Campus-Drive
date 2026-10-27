import { useEffect, useState } from 'react';
import { reportsApi } from '@/api';

let cache: Record<string, string> | undefined;
let inflight: Promise<Record<string, string>> | undefined;
const load = () => (inflight ??= reportsApi.filterOptions().then((o) => (cache = Object.fromEntries(o.departments.map((d) => [d.value, d.label])))));

/** Resolves department ids to codes via the reference API (cached for the session). */
export function useDeptName() {
  const [map, setMap] = useState(cache);
  useEffect(() => { if (!cache) load().then(setMap).catch(() => undefined); }, []);
  return (id: string) => map?.[id] ?? '…';
}

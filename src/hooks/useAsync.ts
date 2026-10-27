import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/types';

export interface AsyncState<T> { data: T | undefined; loading: boolean; error: ApiError | Error | undefined; reload: () => void; setData: (d: T) => void }

/** Loads data through an API function, with race-condition protection and an explicit reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error>();
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(() => {
    const id = ++run.current;
    setLoading(true);
    setError(undefined);
    fnRef.current()
      .then((d) => { if (id === run.current) { setData(d); setLoading(false); } })
      .catch((e: Error) => {
        if (id !== run.current) return;
        if (e instanceof ApiError && e.status === 401) window.dispatchEvent(new Event('ca:unauthorized'));
        setError(e); setLoading(false);
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, deps);
  return { data, loading, error, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

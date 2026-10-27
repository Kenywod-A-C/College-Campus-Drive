/**
 * Wraps a lazily loaded service object so that every method call first awaits the (dynamic) import.
 * Used only when VITE_USE_MOCK=true; in a real build the dynamic import is dead code and the mock is not shipped.
 */
export function lazyMock<T extends object>(load: () => Promise<T>): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined; // never look like a thenable
      return (...args: unknown[]) => load().then((svc) => (svc as Record<string, (...a: unknown[]) => unknown>)[prop](...args));
    },
  });
}

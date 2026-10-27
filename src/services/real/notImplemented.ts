import { ApiError } from '@/types';

export const NOT_IMPLEMENTED_MESSAGE = 'This feature is not available on the server yet.';

/** Rejects like the server's 501 — real mode never silently falls back to mock data. */
export const notImplemented = (_name: string) => (): Promise<never> =>
  Promise.reject(new ApiError(501, NOT_IMPLEMENTED_MESSAGE, 'not_implemented'));

/**
 * Completes a partially implemented service. `stubs` must list EVERY method of the full API surface `T`
 * that `impl` does not provide, so adding a method to the mock API without handling it here is a compile error.
 */
export function withStubs<T extends object, I extends Partial<T>>(impl: I, stubs: Record<Exclude<keyof T, keyof I>, true>): T {
  const out: Record<string, unknown> = { ...impl };
  for (const name of Object.keys(stubs)) out[name] = notImplemented(name);
  return out as T;
}

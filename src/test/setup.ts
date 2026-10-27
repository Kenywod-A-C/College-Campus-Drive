// Global test setup. jest-dom matchers are harmless in node tests; DOM cleanup only applies when a DOM exists.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document !== 'undefined') (await import('@testing-library/react')).cleanup();
});

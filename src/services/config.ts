// Build-time switches. Only VITE_* values are exposed to the browser: never put secrets in them.
// USE_MOCK is a compile-time literal (see `define` in vite.config.ts) so real builds contain no mock code or demo credentials.
export const USE_MOCK: boolean = __USE_MOCK__;
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '');

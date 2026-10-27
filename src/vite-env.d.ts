/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' enables the in-browser mock backend (development only). Anything else uses the real API. */
  readonly VITE_USE_MOCK?: string;
  /** Base URL of the REST API. Defaults to '/api/v1' (proxied to Flask by the Vite dev server). */
  readonly VITE_API_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.config.ts from VITE_USE_MOCK (compile-time literal). */
declare const __USE_MOCK__: boolean;

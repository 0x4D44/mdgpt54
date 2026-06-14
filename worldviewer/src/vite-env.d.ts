/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the OpenSky CORS proxy (worker/opensky-proxy.js). Optional. */
  readonly VITE_OPENSKY_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

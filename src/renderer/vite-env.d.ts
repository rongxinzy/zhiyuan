/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  readonly VITE_BROWSER_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

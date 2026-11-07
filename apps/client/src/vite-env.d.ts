/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** the API's origin when the client is served from another one */
    readonly VITE_API_URL?: string;
    /** package.json version, set in vite.config.mts */
    readonly VITE_GAME_VERSION: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "virtual-atlases-*" {}

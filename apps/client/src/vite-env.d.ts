/// <reference types="vite/client" />

declare module "*.ejs" {
    function render(env: Record<string, any>);
    export default render;
}

interface ImportMetaEnv {
    readonly VITE_ENABLE_SURVEV_ADS: boolean;
    readonly VITE_NITROPAY_SITE_ID: string;
    /** the API's origin when the client is served from another one, eg on game portals */
    readonly VITE_API_URL?: string;
    readonly VITE_AD_PREFIX?: string;
    readonly VITE_GAMEMONETIZE_ID?: string;
    readonly VITE_SPELLSYNC_PROJECT_ID?: string;
    readonly VITE_SPELLSYNC_PUBLIC_TOKEN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "virtual-atlases-*" {}

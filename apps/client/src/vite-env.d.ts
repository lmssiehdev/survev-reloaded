/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ENABLE_SURVEV_ADS: boolean;
    readonly VITE_NITROPAY_SITE_ID: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "virtual-atlases-*" {}

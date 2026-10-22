import { getConfig } from "./config.ts";

// dot access so the production build inlines it (scripts/buildApp.ts defines process.env.NODE_ENV)
const isProd = process.env.NODE_ENV === "production";
// survev-config.hjson lives at the repo root. The path is relative to this package's directory
// (packages/config) in dev, and to apps/<app>/dist once bundled for production
export const serverConfigPath = isProd ? "../../../" : "../../";
export const Config = getConfig(isProd, serverConfigPath);

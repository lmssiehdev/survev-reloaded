import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { resolve } from "node:path";
import { defineConfig, loadEnv, PluginOption, type ServerOptions } from "vite";
import pkgJson from "../../package.json" with { type: "json" };
import { atlasBuilderPlugin } from "./atlas-builder/vitePlugin.ts";
import { codefendPlugin } from "./vite-plugins/codefendPlugin.ts";
import { ejsPlugin } from "./vite-plugins/ejsPlugin.ts";
import { stripBlockPlugin } from "./vite-plugins/stripBlockPlugin.ts";
import { svgoPlugin } from "./vite-plugins/svgoPlugin.ts";

// the repo root .env, VITE_* variables end up in the client (import.meta.env), the rest stays here
const envDir = resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, envDir, "");
    const isDev = mode === "development";

    const port = Number(env.CLIENT_PORT || 3000);
    const apiUrl = env.API_URL || `http://127.0.0.1:${env.API_PORT || 8000}`;

    process.env.VITE_DEBUG_CSS_LINK = isDev
        ? `<link href='css/dev.css' rel="stylesheet" />`
        : "";
    process.env.VITE_GAME_VERSION = pkgJson.version;

    const plugins: PluginOption[] = [
        ejsPlugin(),
        ...atlasBuilderPlugin(mode === "production"),
        svgoPlugin(),
    ];

    if (!isDev) {
        plugins.push(codefendPlugin());

        plugins.push(
            stripBlockPlugin({
                start: "STRIP_FROM_PROD_CLIENT:START",
                end: "STRIP_FROM_PROD_CLIENT:END",
            }),
        );
    }

    const serverOptions: ServerOptions = {
        port,
        host: "127.0.0.1",
        proxy: {
            // this redirects /stats to /stats/
            // because vite is cringe and does not work without trailing slashes at the end of paths 😭
            "^/stats(?!/$).*": {
                target: `http://127.0.0.1:${port}`,
                rewrite: (path) => path.replace(/^\/stats(?!\/$).*/, "/stats/"),
                changeOrigin: true,
                secure: false,
            },
            "/api": {
                target: apiUrl,
                changeOrigin: true,
                secure: false,
            },
            "/team_v2": {
                target: apiUrl,
                changeOrigin: true,
                secure: false,
                ws: true,
            },
        },
    };

    return {
        appType: "mpa",
        base: "",
        build: {
            target: "es2022",
            chunkSizeWarningLimit: 2000,
            rolldownOptions: {
                input: {
                    main: resolve(import.meta.dirname, "index.html"),
                    stats: resolve(import.meta.dirname, "stats/index.html"),
                    ...(isDev
                        ? {
                            "building-editor": resolve(
                                import.meta.dirname,
                                "building-editor/index.html",
                            ),
                        }
                        : {}),
                },
                output: {
                    assetFileNames(assetInfo) {
                        if (assetInfo.names[0]?.endsWith(".css")) {
                            return "css/[name]-[hash][extname]";
                        }
                        return "assets/[name]-[hash][extname]";
                    },
                    entryFileNames: "js/[hash].js",
                    chunkFileNames: "js/[hash].js",
                },
            },
        },
        envDir,
        resolve: {
            extensions: [".ts", ".js"],
            alias: {
                "@/sdk.ts": env.VITE_ENABLE_SURVEV_ADS === "true"
                    ? "./sdk-manager.prod"
                    : "./sdk-manager",
            },
        },
        define: {
            GIT_VERSION: JSON.stringify(GIT_VERSION),
            IS_DEV: isDev,
        },
        plugins,
        json: {
            stringify: true,
        },
        server: serverOptions,
        preview: serverOptions,
    };
});

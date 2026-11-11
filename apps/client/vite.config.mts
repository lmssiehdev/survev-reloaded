import solidPlugin from "@solidjs/vite-plugin";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { resolve } from "node:path";
import { type Connect, defineConfig, loadEnv, PluginOption, type ServerOptions } from "vite";
import pkgJson from "../../package.json" with { type: "json" };
import { atlasBuilderPlugin } from "./atlas-builder/vitePlugin.ts";
import { codefendPlugin } from "./vite-plugins/codefendPlugin.ts";
import { stripBlockPlugin } from "./vite-plugins/stripBlockPlugin.ts";
import { svgoPlugin } from "./vite-plugins/svgoPlugin.ts";

// the repo root .env, VITE_* variables end up in the client (import.meta.env), the rest stays here
const envDir = resolve(import.meta.dirname, "../..");

/**
 * vite only serves stats/index.html at /stats/ (with the trailing slash),
 * so redirect /stats and /stats?query there, keeping the query.
 */
function statsRedirectPlugin(): PluginOption {
    const redirect: Connect.NextHandleFunction = (req, res, next) => {
        const match = req.url?.match(/^\/stats(\?.*)?$/);
        if (!match) return next();
        res.writeHead(301, { Location: `/stats/${match[1] ?? ""}` });
        res.end();
    };
    return {
        name: "stats-redirect",
        configureServer: (server) => void server.middlewares.use(redirect),
        configurePreviewServer: (server) => void server.middlewares.use(redirect),
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, envDir, "");
    const isDev = mode === "development";

    const port = Number(env.CLIENT_PORT || 3000);
    const apiUrl = env.API_URL || `http://127.0.0.1:${env.API_PORT || 8000}`;

    process.env.VITE_GAME_VERSION = pkgJson.version;

    const plugins: PluginOption[] = [
        statsRedirectPlugin(),
        solidPlugin(),
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
            "/t/": {
                target: apiUrl,
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
            extensions: [".ts", ".tsx", ".js"],
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

import solidPlugin from "@solidjs/vite-plugin";
import { getConfig } from "@survev/config/config.ts";
import { GIT_VERSION } from "@survev/config/utils/gitRevision.ts";
import { stripBlockPlugin } from "@survev/shared/utils/stripBlockPlugin.ts";
import { resolve } from "node:path";
import { type Connect, defineConfig, PluginOption, type ServerOptions } from "vite";
import pkgJson from "../../package.json" with { type: "json" };
import { atlasBuilderPlugin } from "./atlas-builder/vitePlugin.ts";
import { codefendPlugin } from "./vite-plugins/codefendPlugin.ts";
import { svgoPlugin } from "./vite-plugins/svgoPlugin.ts";

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
    const isDev = mode === "development";

    const Config = getConfig(!isDev, "../../");

    process.env.VITE_TURNSTILE_SCRIPT = "";
    if (Config.secrets.TURNSTILE_SITE_KEY) {
        process.env.VITE_TURNSTILE_SCRIPT =
            `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>`;
    }

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
        port: Config.vite.port,
        host: Config.vite.host,
        proxy: {
            "/api": {
                target: `http://${Config.apiServer.host}:${Config.apiServer.port}`,
                changeOrigin: true,
                secure: false,
            },
            "/team_v2": {
                target: `http://${Config.apiServer.host}:${Config.apiServer.port}`,
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
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
        },
        define: {
            GAME_REGIONS: Config.regions,
            GIT_VERSION: JSON.stringify(GIT_VERSION),
            PING_TEST_URLS: Object.entries(Config.regions).map(([key, data]) => {
                return {
                    region: key,
                    zone: key,
                    url: data.address,
                    https: data.https,
                };
            }),
            PASS_TYPE: JSON.stringify(Config.passType),
            IS_DEV: isDev,
            PROXY_DEFS: JSON.stringify(Config.proxies),
            TURNSTILE_SITE_KEY: JSON.stringify(Config.secrets.TURNSTILE_SITE_KEY),
        },
        plugins,
        json: {
            stringify: true,
        },
        server: serverOptions,
        preview: serverOptions,
    };
});

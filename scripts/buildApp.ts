import type { BunPlugin } from "bun";
import fs from "node:fs";
import path from "node:path";

/**
 * Production bundle for the bun apps (apps/api, apps/server).
 *
 * Usage, from the app directory: bun ../../scripts/buildApp.ts <entry> [...entries]
 * Writes a flat dist/ (dist/<entry name>.js) next to the app's package.json.
 */
const appDir = process.cwd();
const outdir = path.join(appDir, "dist");
const entries = process.argv.slice(2);
if (!entries.length) {
    console.error("Usage: bun ../../scripts/buildApp.ts <entry> [...entries]");
    process.exit(1);
}

/**
 * Keeps npm packages external (loaded from node_modules at runtime) but bundles
 * the @survev/* workspace packages, like the relative imports they replaced.
 */
function externalNpmPackagesPlugin(): BunPlugin {
    return {
        name: "external-npm-packages",
        setup(build) {
            build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.path.startsWith("@survev/") || args.path.startsWith("bun") || args.path.startsWith("node:")) {
                    return undefined;
                }
                // dist/ loads it from the app's node_modules at runtime, so the app must depend on it
                // (bun's isolated installs don't expose a workspace package's dependencies to the app)
                try {
                    Bun.resolveSync(args.path, appDir);
                } catch {
                    throw new Error(`"${args.path}" (imported by ${args.importer}) is not a dependency of ${appDir}`);
                }
                return { path: args.path, external: true };
            });
        },
    };
}

// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: Copyright (c) 2023 gyeongseok.seo
// Bun port of https://github.com/gseok/vite-plugin-strip-block
// (ref: https://github.com/jballant/webpack-strip-block)
function stripBlockPlugin(options: { start: string; end: string }): BunPlugin {
    const escapeRe = (s: string) => s.replace(/[-[\]{}()*+?.,\\^$\\/|#]/g, "\\$&");
    const regexPattern = new RegExp(
        `\\/\\* ?${escapeRe(options.start)} ?\\*\\/[\\s\\S]*?\\/\\* ?${escapeRe(options.end)} ?\\*\\/`,
        "g",
    );

    return {
        name: "strip-block",
        setup(build) {
            build.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path: filePath }) => {
                const code = await Bun.file(filePath).text();
                return {
                    contents: code.replace(regexPattern, ""),
                    loader: path.extname(filePath).slice(1) as "js" | "jsx" | "ts" | "tsx",
                };
            });
        },
    };
}

if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true });
}

const result = await Bun.build({
    entrypoints: entries.map((entry) => path.join(appDir, entry)),
    outdir,
    // flat output: dist/gameServer.js, dist/gameProcess.js, dist/index.js
    naming: "[name].[ext]",
    target: "bun",
    format: "esm",
    sourcemap: "linked",
    // bundle our own code (including @survev/* workspace packages), keep npm packages in node_modules
    minify: {
        syntax: true,
        whitespace: false,
        identifiers: false,
    },
    define: {
        "process.env.NODE_ENV": "'production'",
    },
    plugins: [
        externalNpmPackagesPlugin(),
        stripBlockPlugin({
            start: "STRIP_FROM_PROD_SERVER:START",
            end: "STRIP_FROM_PROD_SERVER:END",
        }),
    ],
});

if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
}

for (const output of result.outputs) {
    if (output.kind !== "entry-point") continue;
    const size = (output.size / 1024).toFixed(1);
    console.log(`${path.relative(appDir, output.path)}  ${size} KiB`);
}

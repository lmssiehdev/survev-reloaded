import type { BunPlugin } from "bun";
import fs from "node:fs";
import path from "node:path";

const serverDir = path.resolve(import.meta.dirname, "..");
const outdir = path.join(serverDir, "dist");

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
    entrypoints: [
        "src/gameServer.ts",
        "src/game/gameProcess.ts",
        "src/api/index.ts",
    ].map((entry) => path.join(serverDir, entry)),
    outdir,
    // flat output: dist/gameServer.js, dist/gameProcess.js, dist/index.js
    naming: "[name].[ext]",
    target: "bun",
    format: "esm",
    sourcemap: "linked",
    // bundle our own code, keep npm packages in node_modules
    packages: "external",
    minify: {
        syntax: true,
        whitespace: false,
        identifiers: false,
    },
    define: {
        "process.env.NODE_ENV": "'production'",
    },
    plugins: [
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
    console.log(`${path.relative(serverDir, output.path)}  ${size} KiB`);
}

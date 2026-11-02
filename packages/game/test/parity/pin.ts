// Upstream survev commit the fork's gameplay must match. Bump it only together with the
// allowed diffs and a full parity run.
export const UPSTREAM_SHA = "81d9cf929394d67825a07be098ba02ef3e6256cc";
export const UPSTREAM_URL = "https://github.com/survev/survev.git";

/** fork path for an upstream path, or undefined when the file is out of the gameplay scope */
export function forkPathFor(upstreamPath: string): string | undefined {
    if (upstreamPath.startsWith("server/src/game/")) return `packages/game/${upstreamPath.slice(16)}`;
    if (upstreamPath.startsWith("shared/")) return `packages/shared/${upstreamPath.slice(7)}`;
    return undefined;
}

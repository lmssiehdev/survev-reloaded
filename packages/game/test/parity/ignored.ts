/**
 * Object keys left out of the STRICT state hash, with why. Everything else reachable from a game
 * object is compared exactly. Netcode bookkeeping is here because the wire tiers already cover what
 * it produces, and leaving it in would block layout changes to it that don't change gameplay.
 */
export const IGNORED_KEYS = new Set<string>([
    // fork-only: Player.joinedAt is Date.now() at join, used for the session-duration log line
    "joinedAt",
    // serialization scratch buffers; what they produce is compared on the wire
    "partialStream",
    "fullStream",
    // grid bookkeeping; the order grid queries return objects in is hashed separately (STRICT)
    "__gridBounds",
    "__gridQueryId",
    "__onGrid",
]);

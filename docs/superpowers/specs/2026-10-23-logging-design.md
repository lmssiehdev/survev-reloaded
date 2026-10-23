# Logging redesign: LogTape + Axiom

## Why

Debugging prod today means SSH + `docker logs | grep`. The existing logging is coloured text,
Discord is the only error sink, and important failures are invisible:

- `Logger` / `ServerLogger` print ANSI strings; nothing is searchable by game, route, user or region.
- `logErrorToWebhook` posts every `.error()` to Discord: no dedupe, no batching, Discord rate limits
  drop messages during error storms.
- `app.onError` logs expected `HTTPException`s (401/404) as server errors.
- Only `uncaughtException` is hooked; `unhandledRejection` is not, so crashes from rejected promises
  are never reported.
- `JSON.stringify` turns nested `Error`s into `{}`; logs carry no request/game/user context.
- `/report_error` is a Discord-embed proxy for browser errors, not a log pipeline.

The user's framing: the old way was bad and limiting; don't preserve any of it, build it properly.
The one hard constraint is that it must not slow the game down.

Goal: **logging is first class**. Every process, every crash, every request, every game is
observable in Axiom without SSH, and logging never slows the game loop.

## Goals

- One logging setup shared by api, game server, game child processes and bot.
- Structured records (message + properties), never formatted strings with data baked in.
- Prod logs land in Axiom; Discord alerts come from Axiom monitors.
- Crashes (`uncaughtException`, `unhandledRejection`) are logged and flushed before exit.
- When an error happens, the debug lead-up for that game/request is visible (fingers-crossed).
- A small set of wide "event" records answers "what happened" without grepping prose.

## Non-goals

- Metrics/tracing system (OpenTelemetry, Prometheus). Summary events cover it for now.
- Sentry or PostHog.
- **Browser/client error reporting.** Out of scope for now (user decision). The old client
  reporting is deleted, not replaced.
- Product analytics.
- Log sidecars or shippers (Vector, Fluent Bit, Docker log drivers). Explicitly rejected: too much.

## Anti-goals (failure even if it "works")

- Any logging work inside the per-tick hot path beyond incrementing counters.
- A network call or synchronous stdout write that can stall a game tick.
- Axiom becoming required: with no Axiom env vars, everything still works and logs go to stdout.
- A failing Axiom sink logging its own failure through the logger (recursion / storms).
- Keeping the old `Logger`, `ServerLogger`, `logErrorToWebhook` or webhook settings alive "for compat".

## Decisions (made with the user)

- **Library: LogTape** (`@logtape/logtape`). Chosen over Pino (worker-thread transports are
  unreliable on Bun), Winston/consola (heavy / wrong focus), `@axiomhq/logging` (vendor lock-in),
  and hand-rolled (would have to rebuild non-blocking buffering and fingers-crossed).
- **Shipping: in-process**, each process sends its own batches to Axiom's HTTP ingest API with
  plain `fetch`. No SDK, no sidecar container.
- **Old logging is deleted**, not wrapped: `packages/config/utils/logger.ts`,
  `packages/config/utils/consoleLogger.ts`, the `logging`,
  `errorLoggingWebhook` and `clientErrorLoggingWebhook` config fields, and `/report_error`.
- **Lives in its own package**: `packages/logger` (`@survev/logger`), not inside `packages/config`.

## Design

### Package `@survev/logger`

Exports:

- `setupLogging({ app, ... })`: calls LogTape `configure()` once per process. `app` is
  `"api" | "game-server" | "game-proc" | "bot"`, stamped on every record with `env`, `git`
  revision and `pid`; game server and game procs also get `region` (api and bot have none, so
  the property is omitted). *(Builder-check call: `env` comes from a `SURVEV_ENV` env var, e.g.
  `production`/`staging`/`dev`, so staging and prod can share one Axiom dataset.)*
- `getLogger(category)`: re-export of LogTape `getLogger`, categories are arrays rooted at
  `"survev"`, e.g. `["survev", "api", "auth"]`, `["survev", "game"]`.
- `installCrashHandlers(logger)`: `uncaughtException` + `unhandledRejection` → log at `fatal`
  with the error, `await` sink flush/dispose, `process.exit(1)`.
- `flushLogs()`: drains/disposes sinks; used by crash handlers and graceful shutdown (SIGINT/SIGTERM).
- An error serializer so `Error` properties (including `cause` chains and errors nested in
  objects) become `{ name, message, stack, cause }` instead of `{}`.

Sinks configured by `setupLogging`:

1. **Console sink**, non-blocking (buffered). Pretty, human format in dev; JSON lines in prod
   (`NODE_ENV=production` or an explicit `LOG_FORMAT=json`). This is the `docker logs` fallback.
2. **Axiom sink** (only if `AXIOM_TOKEN` and `AXIOM_DATASET` are set): custom sink via
   `fromAsyncSink`, buffers records, POSTs NDJSON to
   `https://api.axiom.co/v1/datasets/<dataset>/ingest` with `Authorization: Bearer <token>`.
   Flushes every ~2s or ~500 records, whichever first. Bounded queue, drop-oldest on overflow,
   dropped count reported periodically. Its own send failures go to `console.error` directly,
   never through LogTape.
3. **Fingers-crossed wrapper** in front of both: below-threshold records (debug/info) are kept in a
   bounded per-context buffer and only emitted when a `warning`+ record arrives in the same
   context (isolated by `gameId` / `requestId`). `LOG_LEVEL` sets what is always emitted (default
   `info`); `debug` records reach outputs only via fingers-crossed, unless `LOG_LEVEL=debug`.

Exact LogTape option names (`nonBlocking`, `fingersCrossed` options, `fromAsyncSink` queue options,
`dispose`/`drain`) are left to the builder against the installed LogTape version.

### Env vars

Follow the env-config convention (`apps/<app>/src/env.ts` via `parseEnv`, documented in
`.env.example`):

- `LOG_LEVEL` (`debug | info | warning | error`, default `info`)
- `LOG_FORMAT` (`pretty | json`, default `pretty` in dev, `json` in production)
- `AXIOM_TOKEN`, `AXIOM_DATASET` (both optional; unset = Axiom sink off)
- `SURVEV_ENV` (`production | staging | dev`, default `dev`)

### Context

- **API**: LogTape implicit context with `AsyncLocalStorage`. A Hono middleware assigns a
  `requestId` and wraps the request in `withContext({ requestId, method, route })`; auth adds
  `userId` once known.
- **Game**: no AsyncLocalStorage in the game loop. `serverGameOptions` creates
  `getLogger(["survev","game"]).with({ gameId, mapName, teamMode })` once per game and injects it
  through the existing `GameOptions.logger`. The `GameLogger` interface in `packages/game` stays
  dependency-free; it changes to LogTape's call shape `(message: string, props?: Record<string, unknown>)`
  so call sites pass data as properties.
- **Game child process**: root logger `.with({ port })`; the parent logs child exits with code/signal.

### Events (the "what happened" records)

Each is a single record with a stable message and flat properties, so Axiom can filter/aggregate:

| Event | Where | Key properties |
|---|---|---|
| `process.start` / `process.exit` | every process | app, git, region, pid, exit code/signal |
| `process.crash` | crash handlers | error (serialized), kind: exception/rejection |
| `game.proc.died` | game server parent | child pid, port, code, signal, games lost |
| `http.request` | API middleware | route, method, status, durationMs, userId (5xx at error, rest info) |
| `game.end` | `Game.stop()` | gameId, durationMs, players peak/total, tick p50/p99/max ms, netSync p99, overload warnings, end reason |
| `process.stats` | each game proc + api, every 60s | memory rss/heap, active games, sockets, tick p99 over window |
| `player.leave` | game, when a client disconnects | gameId, durationMs in game, disconnect reason, kills, placement if dead, avg ping *(my call)* |

Existing ad-hoc messages (failed DB saves, ProxyCheck failures, Redis failures, rate-limit closes,
bad packets, etc.) are kept but converted to structured form: stable message + properties, correct
level. Pure noise (player joined/left at info) moves to debug so it shows up via fingers-crossed.

### Hot-path rules

- Inside `Game.update` / `netSync`: only counters and a fixed-size tick-time sample buffer. The
  existing "tick took over Xms" warnings stay but are throttled (at most one per game per N
  seconds, carrying a count of suppressed ones) instead of one per slow tick.
- The per-15s debug "Avg ms/tick" log is replaced by tick stats in `process.stats` / `game.end`.
- Debug calls with expensive arguments use LogTape lazy evaluation.

### Client errors (deleted)

Delete `/report_error` (`GameRouter`), `apps/client/src/errorLogs.ts`, every
`errorLogManager.*` call site, and the `window.onerror` reporter in `apps/client/src/main.ts`.
No replacement in this project.

### Alerts

Discord webhook code is deleted. Alerting moves to Axiom monitors (configured in Axiom, not in
code): any `fatal`/`process.crash`, `game.proc.died`, error rate above threshold, `http.request`
5xx rate. Setup steps documented in `HOSTING.md`.

**Rollout order (builder-check call):** create the Axiom dataset, ingest token and monitors, and
set the env vars on staging and prod *before* the deploy that removes the Discord webhook, so
there is no window where crashes go unalerted.

### Performance acceptance

"Doesn't slow things down" is verified, not assumed: run `bun run stressTest` against the game
server before and after the change with the same bot count and duration, and compare tick-time
p50/p99 and netSync p99 (from the new `process.stats` / `game.end` records, and from the
profiler/debug output for the baseline). The after numbers must be within noise of the before
numbers, with `LOG_LEVEL=info` and the Axiom sink enabled (pointing at a fake local HTTP
endpoint is fine).

## Constraints

- Bun runtime; packages are bundled into each app's `dist`.
- Game logic package (`packages/game`) must not import Node-only or LogTape modules directly;
  it receives its logger via `GameOptions`.
- Config is env vars only; the client never reads server config. **Branch (my call):** build on a
  new branch off `env-config`, since `bun-migration` doesn't have env-var config yet.
- No logging-related test files committed beyond unit tests for the package itself
  (error serializer, Axiom sink batching/overflow with a fake fetch).

## Left to the builder

- Exact LogTape APIs/options and version.
- Pretty console format details.
- Flush interval/batch/queue sizes within the ranges above.
- Throttle window for slow-tick warnings.
- Message wording for converted ad-hoc logs.
- How tick p50/p99 is computed (fixed ring buffer is fine).

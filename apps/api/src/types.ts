/**
 * Type-only entry point, exported as `@survev/api/types`.
 * Other apps use these to type their hono clients; this module must only contain types
 * so importing it never pulls API runtime code (drizzle, hono server) into their bundles.
 */
export type { PrivateRouteApp } from "./routes/private/private.ts";
export type { UserRouterApp } from "./routes/user/UserRouter.ts";

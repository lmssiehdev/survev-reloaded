import type { Server, TLSOptions, WebSocketHandler } from "bun";
import { isIP } from "node:net";
import type { z, ZodObject } from "zod";

/**
 * uWebSockets.js defaults we relied on, applied to Bun's websocket handlers for parity
 * (Bun defaults to 16MB backpressure and payload limits).
 */
export const uwsWebSocketDefaults = {
    // uWS `maxBackpressure` default, see uWebSockets.js index.d.ts WebSocketBehavior
    backpressureLimit: 64 * 1024,
    closeOnBackpressureLimit: false,
    sendPings: true,
    perMessageDeflate: false,
} satisfies Partial<WebSocketHandler<unknown>>;

/**
 * Thrown by getJsonBody, holds the response that should be sent to the client
 */
export class HttpError extends Error {
    constructor(readonly response: Response, options?: ErrorOptions) {
        super(`${response.status} ${response.statusText}`, options);
    }
}

export const serverHelpers = {
    forbidden(): Response {
        return new Response("403 Forbidden", { status: 403 });
    },

    returnJson(data: Record<string, unknown>): Response {
        return Response.json(data);
    },

    /**
     * Max request body size, to use as Bun.serve `maxRequestBodySize`.
     * Bun responds with 413 to bigger bodies.
     */
    bodyLimit: 1024 * 1024, // 1 MB

    async getJsonBody<T extends ZodObject>(req: Request, validator: T): Promise<z.infer<T>> {
        try {
            const body = await req.json();
            return validator.parse(body);
        } catch (error) {
            throw new HttpError(new Response("400 Bad Request", { status: 400 }), { cause: error });
        }
    },

    /**
     * Get the client IP of a Bun.serve request
     */
    getIp(req: Request, server: Server<unknown>, proxyHeader?: string): string | undefined {
        let ip = proxyHeader
            ? req.headers.get(proxyHeader)
            : server.requestIP(req)?.address;

        // strip IPv4-mapped IPv6 prefix to match uWS getRemoteAddressAsText() on IPv4 sockets
        if (!proxyHeader && ip?.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) {
            ip = ip.slice(7);
        }

        if (!ip || isIP(ip) == 0) return undefined;
        return ip;
    },

    getTLSOptions(config: { ssl?: { keyFile: string; certFile: string } }): TLSOptions | undefined {
        if (!config.ssl) return undefined;
        return {
            key: Bun.file(config.ssl.keyFile),
            cert: Bun.file(config.ssl.certFile),
        };
    },
};

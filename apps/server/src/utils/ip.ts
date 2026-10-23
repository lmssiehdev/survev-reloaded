import type { Server } from "bun";
import { isIP } from "node:net";

/**
 * Client IP of a Bun.serve request: the proxy header if one is configured, else the socket address
 */
export function getIp(req: Request, server: Server<unknown>, proxyHeader?: string): string | undefined {
    let ip = proxyHeader ? req.headers.get(proxyHeader) : server.requestIP(req)?.address;

    // strip IPv4-mapped IPv6 prefix to match uWS getRemoteAddressAsText() on IPv4 sockets
    if (!proxyHeader && ip?.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) {
        ip = ip.slice(7);
    }

    return ip && isIP(ip) !== 0 ? ip : undefined;
}

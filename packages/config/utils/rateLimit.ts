import { Config } from "../serverConfig.ts";

/**
 * fixed window counter: true once more than `limit` hits land in the same `interval` ms window.
 * windows are timestamps, no timers
 */
function hit(window: { start: number; count: number }, limit: number, interval: number, now: number) {
    if (now - window.start >= interval) {
        window.start = now;
        window.count = 1;
        return false;
    }
    return ++window.count > limit;
}

// modified version of https://github.com/uNetworking/uWebSockets.js/blob/master/examples/RateLimit.js
// also wraps simultaneous connections rate limit not just messages
export class WebSocketRateLimit {
    // per socket message window, stored on the socket's data
    private _start = Symbol();
    private _count = Symbol();

    // open connections per IP, an entry is removed when its last connection closes
    private _connections = new Map<string, number>();

    constructor(
        readonly limit: number,
        readonly interval: number,
        readonly maxConnections: number,
    ) {}

    /**
     * Returns true if a websocket is being rate limited by sending too many messages
     */
    isRateLimited(wsData: Record<symbol, number>): boolean {
        if (!Config.rateLimitsEnabled) return false;
        const window = { start: wsData[this._start] ?? -Infinity, count: wsData[this._count] ?? 0 };
        const limited = hit(window, this.limit, this.interval, Date.now());
        wsData[this._start] = window.start;
        wsData[this._count] = window.count;
        return limited;
    }

    /**
     * returns true if the IP has exceeded the max simultaneous connections
     * false otherwise
     */
    isIpRateLimited(ip: string): boolean {
        if (!Config.rateLimitsEnabled) return false;
        return (this._connections.get(ip) ?? 0) + 1 > this.maxConnections;
    }

    ipConnected(ip: string) {
        this._connections.set(ip, (this._connections.get(ip) ?? 0) + 1);
    }

    ipDisconnected(ip: string) {
        const count = this._connections.get(ip);
        if (count === undefined) return;
        if (count <= 1) this._connections.delete(ip);
        else this._connections.set(ip, count - 1);
    }
}

export class HTTPRateLimit {
    private _windows = new Map<string, { start: number; count: number }>();

    constructor(
        readonly limit: number,
        readonly interval: number,
    ) {
        // drop finished windows so the map doesn't grow with every IP ever seen
        setInterval(() => {
            const now = Date.now();
            for (const [ip, window] of this._windows) {
                if (now - window.start >= interval) this._windows.delete(ip);
            }
        }, Math.max(interval, 60_000)).unref();
    }

    /**
     * Checks if an IP is rate limited
     */
    isRateLimited(ip: string): boolean {
        if (!Config.rateLimitsEnabled) return false;
        let window = this._windows.get(ip);
        if (!window) {
            window = { start: -Infinity, count: 0 };
            this._windows.set(ip, window);
        }
        return hit(window, this.limit, this.interval, Date.now());
    }
}

import { getLogger } from "@survev/logger/node.ts";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { isIP } from "node:net";
import { env } from "../env.ts";
import { fetchJson } from "./fetchJson.ts";

const logger = getLogger(["api", "ip"]);

export function getHonoIp(c: Context, proxyHeader?: string): string | undefined {
    const ip = proxyHeader
        ? c.req.header(proxyHeader)
        : getConnInfo(c).remote.address;

    if (!ip || isIP(ip) == 0) return undefined;
    if (ip.includes("::ffff:")) return ip.split("::ffff:")[1];
    return ip;
}

/** Ok(false): the token was rejected, Err: turnstile could not be reached */
export async function verifyTurnstile(token: string, ip: string) {
    const res = await fetchJson<{ success?: boolean }>(
        "Turnstile",
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
            timeoutMs: 5000,
        },
    );
    return res.map((outcome) => outcome.success === true);
}

type IpInfo = {
    network: {
        asn: string;
        range: string;
        hostname: string;
        provider: string;
        organisation: string;
        type: string;
    };
    location: {
        continent_name: string;
        continent_code: string;
        country_name: string;
        country_code: string;
        region_name: string;
        region_code: string;
        city_name: string;
        postal_code: string;
        latitude: number;
        longitude: number;
        timezone: string;
        currency: {
            name: string;
            code: string;
            symbol: string;
        };
    };
    device_estimate: {
        address: number;
        subnet: number;
    };
    detections: {
        proxy: boolean;
        vpn: boolean;
        compromised: boolean;
        scraper: boolean;
        tor: boolean;
        hosting: boolean;
        anonymous: boolean;
        risk: number;
        confidence: number;
        first_seen: string;
        last_seen: string;
    };
    detection_history: {
        delisted: boolean;
        delist_datetime: string;
    };
    attack_history: {
        vulnerability_probing: number;
    };
    operator: null;
    last_updated: string;
};

type ProxyCheckRes<IP extends string> =
    & {
        status: "ok" | "warning" | "denied" | "error";
        query_time: number;
    }
    & {
        [k in IP]: IpInfo;
    };

const proxyCheckCache = new Map<
    string,
    {
        info: IpInfo;
        expiresAt: number;
    }
>();

async function fetchIpInfo(ip: string): Promise<IpInfo | undefined> {
    const url = new URL(`https://proxycheck.io/v3/${ip}`);
    url.searchParams.set("key", env.PROXYCHECK_KEY!);

    const data = await fetchJson<ProxyCheckRes<string>>("ProxyCheck", url, { timeoutMs: 5000 });
    if (data.isErr()) return undefined;

    const res = data.value;
    const msg: unknown = Reflect.get(res, "message");
    const reason = typeof msg === "string" ? msg : undefined;
    switch (res.status) {
        case "ok":
        case "warning":
            if (res.status === "warning") {
                logger.warning("proxycheck.warning", { reason });
            }
            if (!res[ip]?.detections) {
                logger.warning("proxycheck.no_detections", { status: res.status, reason });
                return undefined;
            }
            return res[ip];
        case "denied":
        case "error":
            logger.warning("proxycheck.failed", { status: res.status, reason });
            return undefined;
    }
}

/** fails open: a proxycheck outage lets players through */
export async function isBehindProxy(ip: string, checkVpn: boolean): Promise<boolean> {
    if (!env.PROXYCHECK_KEY) return false;

    let info = proxyCheckCache.get(ip);
    if (!info || info.expiresAt <= Date.now()) {
        const fetched = await fetchIpInfo(ip);
        if (!fetched) return false;
        info = { info: fetched, expiresAt: Date.now() + 10 * 60 * 1000 };
        proxyCheckCache.set(ip, info);
    }

    const { detections } = info.info;
    return detections.proxy || (checkVpn && detections.vpn);
}

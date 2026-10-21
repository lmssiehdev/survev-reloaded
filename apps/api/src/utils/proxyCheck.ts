import { Config } from "@survev/config/serverConfig.ts";
import { defaultLogger } from "@survev/config/utils/logger.ts";
import { Result } from "better-result";
import { fetchResult, readJson } from "../errors.ts";

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
    url.searchParams.set("key", Config.secrets.PROXYCHECK_KEY!);

    const data = await fetchResult("ProxyCheck", url, { timeoutMs: 5000, retries: 2 })
        .then(Result.andThenAsync((res: Response) => readJson<ProxyCheckRes<string>>("ProxyCheck", res)));
    if (data.isErr()) return undefined;

    const res = data.value;
    switch (res.status) {
        case "ok":
        case "warning":
            if (res.status === "warning") {
                defaultLogger.warn(`ProxyCheck warning, res:`, res);
            }
            if (!res[ip]?.detections) {
                defaultLogger.error(`ProxyCheck sent no detections for ${ip}:`, res);
                return undefined;
            }
            return res[ip];
        case "denied":
        case "error":
            defaultLogger.error(`ProxyCheck failed for ${ip}:`, res);
            return undefined;
    }
}

/** fails open: a proxycheck outage lets players through */
export async function isBehindProxy(ip: string, checkVpn: boolean): Promise<boolean> {
    if (!Config.secrets.PROXYCHECK_KEY) return false;

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

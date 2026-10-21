import { RedisClient } from "bun";
import { Config } from "../../config.ts";
import { server } from "../apiServer.ts";

export const CACHE_TTL = 3 * 24 * 60 * 60;

let redisClient: RedisClient;

export async function getRedisClient() {
    if (redisClient || !Config.cachingEnabled) {
        return redisClient;
    }
    // defaults to $REDIS_URL / $VALKEY_URL or redis://localhost:6379
    const cacheInstance = new RedisClient();

    cacheInstance.onconnect = () => server.logger.info("Connected to redis");
    process.on("exit", () => cleanupRedis);

    await cacheInstance.connect();
    redisClient = cacheInstance;
    return cacheInstance;
}

export async function cleanupRedis() {
    if (redisClient) {
        try {
            redisClient.close();
        } catch (err) {
            server.logger.info(
                `CacheStore - Error while disconnecting from redis: ${
                    err instanceof Error ? err.message : "Unknown error"
                }`,
            );
        }
    }
}

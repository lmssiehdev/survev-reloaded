import { Config } from "@survev/config/serverConfig.ts";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import fs from "node:fs";
import path from "node:path";
import { relations } from "./relations.ts";

function openDatabase(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const client = new Database(file, { create: true });
    client.run("PRAGMA journal_mode = WAL");
    client.run("PRAGMA foreign_keys = ON");
    client.run("PRAGMA busy_timeout = 5000");
    client.run("PRAGMA synchronous = NORMAL");
    return client;
}

// nothing is stored when the database is disabled, don't create a file for it
const client = Config.database.enabled ? openDatabase(Config.database.file) : new Database(":memory:");

/**
 * bun:sqlite is synchronous: a query blocks the API process while it runs.
 * transactions must be synchronous too (`db.transaction((tx) => { tx...run() })`),
 * the statements of an async callback run outside of the transaction
 */
export const db = drizzle({
    client,
    relations,
});

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

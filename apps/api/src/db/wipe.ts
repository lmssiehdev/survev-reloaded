// Deletes the sqlite file from the config (with its WAL files), run db:migrate afterwards
import { Config } from "@survev/config/serverConfig.ts";
import fs from "node:fs";

const file = Config.database.file;
for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(file + suffix, { force: true });
}
console.log(`Deleted ${file}`);

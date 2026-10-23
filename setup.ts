// `bun survev-setup`: writes .env from .env.example with random secrets, see .env.example for every setting
import enquirer from "enquirer";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(import.meta.dirname, ".env");
const examplePath = path.join(import.meta.dirname, ".env.example");

async function confirm(message: string) {
    return (await enquirer.prompt<{ value: boolean }>({ type: "confirm", name: "value", message, initial: false }))
        .value;
}

async function input(message: string) {
    return (await enquirer.prompt<{ value: string }>({ type: "input", name: "value", message, required: true })).value;
}

if (fs.existsSync(envPath)) {
    if (!(await confirm(".env already exists, overwrite it?"))) process.exit(0);
}

const values: Record<string, string> = {
    SURVEV_API_KEY: randomBytes(48).toString("base64url"),
    SURVEV_IP_SECRET: randomBytes(32).toString("base64url"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
};

const production = await confirm("Is this a production server (docker compose)?");

if (production) {
    values.SURVEV_DOMAIN = await input("Website domain (eg survev.example.com)");
    values.SURVEV_GAME_DOMAIN = await input("Game server domain (eg game.survev.example.com)");
    values.POSTGRES_PASSWORD = randomBytes(24).toString("base64url");
}

// fills in the KEY= lines of the example, commented out defaults stay as they are
let env = fs.readFileSync(examplePath, "utf8");
for (const [key, value] of Object.entries(values)) {
    env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}
fs.writeFileSync(envPath, env, { mode: 0o600 });

console.log(`Wrote ${envPath} with random secrets.`);
if (production) {
    console.log("Next: set REGION and REGION_L10N for the game server in it, then see HOSTING.md.");
}

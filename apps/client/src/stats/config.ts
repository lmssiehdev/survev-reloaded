import { ConfigManager } from "../config.ts";

/** the game's saved settings (localStorage "surviv_config"): language, profile slug */
export const config = new ConfigManager();
config.load();

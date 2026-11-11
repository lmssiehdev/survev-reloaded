import { ConfigManager } from "./config.ts";

/** the game's saved settings (localStorage "surviv_config"), shared by the game classes and TSX */
export const config = new ConfigManager();

import { saveConfig } from "@survev/config/config.ts";
import { Config, serverConfigPath } from "@survev/config/serverConfig.ts";
import type { MapDefKey } from "@survev/shared/defs/mapDefs.ts";

type Mode = (typeof Config)["modes"][number];

/**
 * what admins can change at runtime through /private;
 * every change is written back to the config file so it survives a restart
 */
class Settings {
    #modes = [...Config.modes];
    #clientTheme = Config.clientTheme;
    #captchaEnabled = Config.captchaEnabled;

    get modes(): readonly Mode[] {
        return this.#modes;
    }

    get clientTheme() {
        return this.#clientTheme;
    }

    get captchaEnabled() {
        return this.#captchaEnabled;
    }

    /** false when there is no mode at that index */
    setMode(index: number, patch: Partial<Mode>) {
        const mode = this.#modes[index];
        if (!mode) return false;
        this.#modes[index] = {
            mapName: patch.mapName ?? mode.mapName,
            teamMode: patch.teamMode ?? mode.teamMode,
            enabled: patch.enabled ?? mode.enabled,
        };
        saveConfig(serverConfigPath, { modes: this.#modes });
        return true;
    }

    setClientTheme(theme: MapDefKey) {
        this.#clientTheme = theme;
        saveConfig(serverConfigPath, { clientTheme: theme });
    }

    setCaptchaEnabled(enabled: boolean) {
        this.#captchaEnabled = enabled;
        saveConfig(serverConfigPath, { captchaEnabled: enabled });
    }
}

export const settings = new Settings();

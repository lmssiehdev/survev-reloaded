import { config } from "../../appConfig.ts";
import type { AimStyle } from "../../config.ts";
import { device } from "../../device.ts";
import { t } from "../i18n.ts";
import { onNative } from "../nativeEvent.ts";
import { touchRef } from "../touchControls.ts";

const styleIcon = (style: AimStyle | undefined) => ({
    "locked-on-icon": style === "locked",
    "unlocked-on-icon": style === "anywhere",
});

/** the in-game menu's touch toggles, shown on touch devices; Touch keeps their settings in config */
const touchOnly = (display: string) => (device.touch ? display : "none");

export function TouchControls() {
    const container = () => (device.touch ? "inline-block" : undefined);
    return (
        <>
            <div id="btn-touch-styles" class="btns-game-double-row" style={{ display: touchOnly("flex") }}>
                <div class="btn-game-container" style={{ display: container() }}>
                    <a
                        id="btn-game-move-style"
                        class={[
                            "btn-double-row btn-game-touch-style btn-darken",
                            styleIcon(config.state.touchMoveStyle),
                        ]}
                        ref={onNative("touchstart", () => touchRef()?.toggleMoveStyle())}
                    />
                    <div class="btn-double-row game-menu-icon-toggle movement-icon" />
                </div>
                <div class="btn-game-container" style={{ display: container() }}>
                    <a
                        id="btn-game-aim-style"
                        class={[
                            "btn-double-row btn-game-touch-style btn-darken",
                            styleIcon(config.state.touchAimStyle),
                        ]}
                        ref={onNative("touchstart", () => touchRef()?.toggleAimStyle())}
                    />
                    <div class="btn-double-row game-menu-icon-toggle target-icon" />
                </div>
            </div>
            <a
                id="btn-game-aim-line"
                // locked-on-icon is in the original markup and was never removed
                class={[
                    "btn-game-menu btn-darken locked-on-icon",
                    {
                        "aim-line-on-icon": config.state.touchAimLine === true,
                        "aim-line-off-icon": config.state.touchAimLine === false,
                    },
                ]}
                style={{ display: touchOnly("block") }}
                ref={onNative("touchstart", () => touchRef()?.toggleAimLine())}
            >
                {t("game-aim-line")}
            </a>
        </>
    );
}

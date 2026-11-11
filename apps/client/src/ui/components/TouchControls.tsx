import type { AimStyle } from "../../config.ts";
import { t } from "../i18n.ts";
import { onNative } from "../nativeEvent.ts";
import { touchControls, touchRef } from "../touchControls.ts";

const styleIcon = (style: AimStyle | undefined) => ({
    "locked-on-icon": style === "locked",
    "unlocked-on-icon": style === "anywhere",
});

/**
 * The in-game menu's touch toggles. UiManager2 shows `#btn-touch-styles` and `#btn-game-aim-line`
 * on touch devices (it sets their display).
 */
export function TouchControls() {
    const container = () => (touchControls.touch ? "inline-block" : undefined);
    return (
        <>
            <div id="btn-touch-styles" class="btns-game-double-row">
                <div class="btn-game-container" style={{ display: container() }}>
                    <a
                        id="btn-game-move-style"
                        class={["btn-double-row btn-game-touch-style btn-darken", styleIcon(touchControls.moveStyle)]}
                        ref={onNative("touchstart", () => touchRef()?.toggleMoveStyle())}
                    />
                    <div class="btn-double-row game-menu-icon-toggle movement-icon" />
                </div>
                <div class="btn-game-container" style={{ display: container() }}>
                    <a
                        id="btn-game-aim-style"
                        class={["btn-double-row btn-game-touch-style btn-darken", styleIcon(touchControls.aimStyle)]}
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
                        "aim-line-on-icon": touchControls.aimLine === true,
                        "aim-line-off-icon": touchControls.aimLine === false,
                    },
                ]}
                ref={onNative("touchstart", () => touchRef()?.toggleAimLine())}
            >
                {t("game-aim-line")}
            </a>
        </>
    );
}

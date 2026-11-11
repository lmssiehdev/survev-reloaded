import { CrosshairDefs } from "@survev/shared/defs/gameObjects/crosshairDefs.ts";
import type { Crosshair } from "@survev/shared/utils/loadout.ts";
import { util } from "@survev/shared/utils/util.ts";

function getCrosshairDims(crosshairDef: Crosshair) {
    const crosshairBase = {
        width: 64,
        height: 64,
    };
    return {
        width: Math.round((crosshairBase.width * Number(crosshairDef.size)) / 4) * 4,
        height: Math.round((crosshairBase.height * Number(crosshairDef.size)) / 4) * 4,
    };
}
function getBaseURL(crosshairDef: Crosshair) {
    const objDef = CrosshairDefs[crosshairDef.type];
    const dims = getCrosshairDims(crosshairDef);
    const color = util.rgbToHex(util.intToRgb(crosshairDef.color));
    const strokeWidth = crosshairDef.stroke;
    let svgCode = objDef.code.replace(/white/g, color);
    svgCode = svgCode.replace(/stroke-width=".5"/g, `stroke-width="${strokeWidth}"`);
    svgCode = svgCode.replace(/width="64"/g, `width="${dims.width}"`);
    svgCode = svgCode.replace(/height="64"/g, `height="${dims.height}"`);
    return `url('data:image/svg+xml;utf8,${(svgCode = svgCode.replace(/#/g, "%23"))}')`;
}
function getCursorCSS(crosshairDef: Crosshair) {
    const dims = getCrosshairDims(crosshairDef);
    return `${getBaseURL(crosshairDef)} ${dims.width / 2} ${dims.height / 2}, crosshair`;
}

/** the CSS `cursor` for an element showing this crosshair */
function getCursor(crosshairDef: Crosshair) {
    const objDef = CrosshairDefs[crosshairDef.type];
    if (!objDef) return "crosshair";
    return objDef.cursor ? objDef.cursor : getCursorCSS(crosshairDef);
}

export const crosshair = {
    getCursorURL: function(crosshairDef: Crosshair) {
        return getBaseURL(crosshairDef);
    },
    getCursor,
    setElemCrosshair: function(elem: HTMLElement, crosshairDef: Crosshair) {
        elem.style.cursor = getCursor(crosshairDef);
    },
    setGameCrosshair: function(crosshairDef: Crosshair) {
        // Set game pointer
        const gameArea = document.getElementById("game-area-wrapper");
        if (gameArea) crosshair.setElemCrosshair(gameArea, crosshairDef);

        // Adjust UI elements to use the custom crosshair as well
        const objDef = CrosshairDefs[crosshairDef.type];
        const style = !objDef || objDef.cursor ? "pointer" : "inherit";
        for (
            const el of document.querySelectorAll<HTMLElement>(
                ".ui-zoom, .ui-medical, .ui-settings-button, .ui-weapon-switch",
            )
        ) {
            el.style.cursor = style;
        }
    },
};

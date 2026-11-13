import { FxEffects, type MatchFx, type WeatherName, WeatherNames } from "@survev/shared/defs/mapFxDefs.ts";
import type { MapFx } from "./mapFx.ts";

// Dev only: override what the server picked with ?fx=all|light,sway,... ?fxTime=<hour>|cycle and
// ?weather=<name>. Any of them also opens the panel below.

const CycleSeconds = 120;

export function devOverrides(fx: MatchFx): { fx: MatchFx; panel: boolean } {
    const params = new URLSearchParams(window.location.search);
    const fxParam = params.get("fx");
    const timeParam = params.get("fxTime");
    const weatherParam = params.get("weather");
    const out = { ...fx };
    if (fxParam !== null) {
        const keys = fxParam.split(",");
        out.effects = FxEffects.filter((k) => fxParam === "all" || keys.includes(k));
    }
    if (timeParam === "cycle") out.dayLength = CycleSeconds;
    if (timeParam !== null && timeParam !== "cycle") {
        out.hour = Number(timeParam) || 0;
        out.dayLength = 0;
    }
    if (WeatherNames.includes(weatherParam as WeatherName)) out.weather = weatherParam as WeatherName;
    return { fx: out, panel: fxParam !== null || timeParam !== null || weatherParam !== null };
}

export class DebugPanel {
    el = document.createElement("div");
    info = document.createElement("span");
    perf = { ms: 0, frames: 0, last: performance.now() };

    constructor(fx: MapFx) {
        const el = this.el;
        el.style.cssText =
            "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100000;background:rgba(0,0,0,.65);color:#fff;font:12px monospace;padding:6px 10px;border-radius:6px;display:flex;gap:10px;align-items:center;pointer-events:auto";
        for (const key of FxEffects) {
            const label = document.createElement("label");
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = fx.on(key);
            box.onchange = () => {
                if (box.checked) fx.enabled.add(key);
                else fx.enabled.delete(key);
            };
            label.append(box, key);
            el.append(label);
        }
        const select = document.createElement("select");
        select.id = "fx-weather";
        for (const name of WeatherNames) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.append(opt);
        }
        select.value = fx.weather.name;
        select.onchange = () => fx.weather.setWeather(select.value as WeatherName);
        const slider = document.createElement("input");
        slider.id = "fx-hour";
        slider.type = "range";
        slider.min = "0";
        slider.max = "24";
        slider.step = "0.1";
        slider.value = String(fx.currentHour());
        slider.oninput = () => fx.setClock(Number(slider.value), 0);
        this.info.id = "fx-info";
        el.append(select, slider, this.info);
        for (const e of ["mousedown", "mouseup", "pointerdown", "keydown"]) {
            el.addEventListener(e, (ev) => ev.stopPropagation());
        }
        document.body.append(el);
    }

    /** once a second, shows what the effects cost on the CPU */
    record(fx: MapFx, ms: number) {
        const perf = this.perf;
        perf.ms += ms;
        perf.frames++;
        const now = performance.now();
        if (now - perf.last < 1000) return;
        const fps = (perf.frames * 1000) / (now - perf.last);
        const cpu = perf.ms / perf.frames;
        this.info.textContent = `${fx.currentHour().toFixed(1)}h ${fps.toFixed(0)}fps fx-cpu ${
            cpu.toFixed(2)
        }ms shadows ${fx.shadows.count} lights ${fx.lights.count}`;
        perf.ms = 0;
        perf.frames = 0;
        perf.last = now;
    }

    free() {
        this.el.remove();
    }
}

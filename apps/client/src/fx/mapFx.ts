import type { FxEffect, MatchFx } from "@survev/shared/defs/mapFxDefs.ts";
import type { AABB } from "@survev/shared/utils/coldet.ts";
import { collider } from "@survev/shared/utils/collider.ts";
import { math } from "@survev/shared/utils/math.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import type { Map } from "../map.ts";
import { createFalloffTexture, type FxWorld } from "./common.ts";
import { DebugPanel, devOverrides } from "./debugPanel.ts";
import { Grade } from "./grade.ts";
import { Lights } from "./lights.ts";
import { type Look, sampleLook } from "./look.ts";
import { Shadows } from "./shadows.ts";
import { Sway } from "./sway.ts";
import { Weather } from "./weather.ts";
import { WeatherAudio } from "./weatherAudio.ts";

// Map effects: lighting, shadows, foliage sway, weather and colour grading. The server picks
// which ones a match uses (see mapFxDefs.ts); every effect reads one shared Look per frame so
// they stay a single image.

// How much outdoor weather sound reaches the listener.
function muffleFor(underground: boolean, indoors: boolean) {
    if (underground) return 0.9;
    if (indoors) return 0.7;
    return 0;
}

// Footprints of ground-level buildings, where no rain falls.
function dryZones(map: Map) {
    const zones: AABB[] = [];
    const buildings = map.m_buildingPool.m_getPool();
    for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (!b.active || b.layer != 0) continue;
        for (const region of b.ceiling.zoomRegions) {
            if (region.zoomIn) zones.push(collider.toAabb(region.zoomIn));
        }
    }
    return zones;
}

export class MapFx {
    /** nothing runs until the server sends the match setup */
    enabled = new Set<FxEffect>();
    startHour = 15;
    dayLength = 0;
    clock = 0;
    time = 0;

    pixi!: PIXI.IRenderer;
    world = new PIXI.Container();
    // Filters render into a transparent texture, so the grass clear colour needs a real backdrop.
    grass = new PIXI.Sprite(PIXI.Texture.WHITE);
    look: Look = sampleLook(15, null);

    falloff = createFalloffTexture();
    grade = new Grade();
    shadows = new Shadows(this.falloff);
    lights = new Lights(this.falloff);
    sway = new Sway();
    weather = new Weather("clear");
    weatherAudio: WeatherAudio | null = null;
    panel: DebugPanel | null = null;

    constructor(public canvasMode: boolean) {
        this.world.addChild(this.grass);
    }

    on(key: FxEffect) {
        return this.enabled.has(key);
    }

    /** applies the setup the server picked for this match */
    configure(match: MatchFx) {
        // The effects are WebGL shaders; the canvas fallback renders the plain map.
        if (this.canvasMode) return;
        const dev = import.meta.env.DEV ? devOverrides(match) : { fx: match, panel: false };
        const fx = dev.fx;
        this.enabled = new Set(fx.effects);
        this.setClock(fx.hour, fx.dayLength);
        this.weather.setWeather(fx.weather, true);
        if (dev.panel && !this.panel) this.panel = new DebugPanel(this);
    }

    setClock(hour: number, dayLength: number) {
        this.startHour = hour;
        this.dayLength = dayLength;
        this.clock = 0;
    }

    currentHour() {
        if (this.dayLength <= 0) return this.startHour;
        return (this.startHour + (this.clock / this.dayLength) * 24) % 24;
    }

    // World containers move under one parent so screen passes skip the UI.
    attach(
        pixi: PIXI.IRenderer,
        stage: PIXI.Container,
        worldContainers: PIXI.DisplayObject[],
        topLayerIdx: number,
    ) {
        this.pixi = pixi;
        for (let i = 0; i < worldContainers.length; i++) {
            this.world.addChild(worldContainers[i]);
            if (i == topLayerIdx) {
                // Weather sits under the lightmap: rain is only visible where something lights it.
                this.world.addChild(
                    this.weather.splashLayer,
                    this.weather.airLayer,
                    this.lights.overlay,
                    this.lights.glow,
                );
            }
        }
        stage.addChildAt(this.world, 0);
    }

    update(dt: number, camera: Camera, w: FxWorld) {
        const t0 = performance.now();
        this.time += dt;
        this.clock += dt;
        const weatherOn = this.on("weather");
        const c = this.weather.cur;
        this.look = sampleLook(
            this.currentHour(),
            weatherOn ? { gloom: c.gloom, fog: c.fog, flash: this.weather.flash } : null,
        );

        this.updateFilters(camera, w.map);
        this.updateWeather(dt, camera, w);
        this.lights.collectFlashes(dt, w, (pos, rad) => this.weather.addShock(pos, rad * 1.6));
        if (this.on("sway")) {
            const wind = weatherOn ? { angle: this.weather.windAngle, strength: this.weather.windStrength() } : null;
            this.sway.update(dt, this.time, camera, w, wind);
        }
        if (this.on("shadow") && w.renderer.layers[0].visible) {
            const overcast = weatherOn ? math.clamp((c.cloud - 0.3) / 0.7, 0, 1) : 0;
            this.shadows.update(camera, w, this.look, overcast);
        } else {
            this.shadows.hide();
        }
        if (this.on("light")) this.lights.update(this.pixi, camera, w, this.look);
        else this.lights.hide();

        this.panel?.record(this, performance.now() - t0);
    }

    updateFilters(camera: Camera, map: Map) {
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const grade = this.on("grade");
        const filters = [
            ...(this.on("weather") ? [this.weather.filter] : []),
            ...(grade ? [this.grade.filter] : []),
        ];
        const filtered = filters.length > 0;
        this.world.filters = filtered ? filters : null;
        this.world.filterArea = filtered ? new PIXI.Rectangle(0, 0, sw, sh) : (null as unknown as PIXI.Rectangle);
        this.grass.visible = filtered;
        this.grass.width = sw;
        this.grass.height = sh;
        this.grass.tint = map.mapLoaded ? map.getMapDef().biome.colors.grass : 0x80af49;
        if (grade) this.grade.update(this.look);
    }

    updateWeather(dt: number, camera: Camera, w: FxWorld) {
        const on = this.on("weather") && w.map.mapLoaded;
        this.weatherAudio ??= new WeatherAudio(w.audio);
        const underground = w.activeLayer == 1;
        const indoors = underground || w.map.insideBuildingCeiling(collider.createCircle(w.activePos, 0.01), true);
        // Rain outside is quieter but still there; underground almost nothing gets through.
        const muffle = muffleFor(underground, indoors);
        this.weather.splashLayer.visible = on && !underground;
        this.weather.airLayer.visible = on && !underground;
        if (on) {
            this.weather.setDryZones(dryZones(w.map));
            this.weather.update(dt, camera, w.map, this.look.fog, 1 - this.look.night, (dist) => {
                if (dist < 0.4 && !underground) camera.m_addShake(camera.m_pos, 0.15 * (1 - dist));
                this.weatherAudio?.thunder(dist, muffle);
            });
        }
        const c = this.weather.cur;
        const wet = on ? c.rain : 0;
        const outside = 1 - muffle;
        const mood = {
            wind: on ? this.weather.windStrength() : 0,
            rain: wet,
            storm: on ? c.storm : 0,
            night: on ? math.smoothstep(this.look.night, 0.4, 0.9) : 0,
            muffle,
        };
        this.weatherAudio.update(dt, w.activePos, mood, {
            rain: wet * (1 - 0.7 * c.storm) * outside,
            storm: mood.storm * outside,
            roof: indoors && !underground ? wet : 0,
            crickets: mood.night * (1 - wet) * (1 - math.clamp(c.wind - 0.5, 0, 1)) * outside,
        });
    }

    free() {
        this.panel?.free();
        this.panel = null;
        this.lights.free();
        this.weatherAudio?.free();
    }
}

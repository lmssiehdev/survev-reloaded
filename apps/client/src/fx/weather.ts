import type { WeatherName } from "@survev/shared/defs/mapFxDefs.ts";
import type { AABB } from "@survev/shared/utils/coldet.ts";
import { math } from "@survev/shared/utils/math.ts";
import type { Vec2 } from "@survev/shared/utils/v2.ts";
import * as PIXI from "pixi.js-legacy";
import type { Camera } from "../camera.ts";
import type { Map } from "../map.ts";

// Weather: one world-space atmosphere pass plus particle layers.

interface WeatherParams {
    cloud: number;
    fog: number;
    rain: number;
    wet: number;
    wind: number;
    leaves: number;
    storm: number;
    gloom: number;
}

export const WeatherPresets: Record<WeatherName, WeatherParams> = {
    // Leaves only fly when the wind is worth noticing; a calm day stays calm.
    clear: { cloud: 0.3, fog: 0, rain: 0, wet: 0, wind: 0.35, leaves: 0, storm: 0, gloom: 0 },
    windy: { cloud: 0.5, fog: 0, rain: 0, wet: 0, wind: 1.2, leaves: 0.6, storm: 0, gloom: 0.05 },
    rain: { cloud: 0.8, fog: 0.15, rain: 0.55, wet: 0.7, wind: 0.6, leaves: 0.1, storm: 0, gloom: 0.25 },
    storm: { cloud: 1, fog: 0.2, rain: 1, wet: 1, wind: 1.5, leaves: 0.45, storm: 1, gloom: 0.45 },
    fog: { cloud: 0.5, fog: 0.85, rain: 0, wet: 0.25, wind: 0.15, leaves: 0, storm: 0, gloom: 0.15 },
};

const MaxShocks = 4;

const atmoFrag = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec2 uScreen;
uniform vec2 uCam;
uniform float uZoom;
uniform float uTime;
uniform vec2 uCloudOff;
uniform vec2 uFogOff;
uniform float uCloud;
uniform float uFog;
uniform vec3 uFogColor;
uniform float uWet;
uniform float uFlash;
uniform float uRain;
uniform vec2 uWindDir;
uniform float uVignette;
uniform vec4 uShock[${MaxShocks}];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + 17.1;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 px = vTextureCoord * inputSize.xy + outputFrame.xy;
    vec2 uv = vTextureCoord;

    // Explosion shockwaves: a refracting ring plus a fading heat shimmer inside it.
    float aberr = 0.0;
    for (int i = 0; i < ${MaxShocks}; i++) {
        vec4 s = uShock[i];
        if (s.w <= 0.0) continue;
        vec2 d = px - s.xy;
        float dist = length(d) + 0.001;
        float ring = 1.0 - smoothstep(0.0, 36.0, abs(dist - s.z));
        float k = s.w * ring;
        float haze = s.w * (1.0 - smoothstep(0.0, s.z, dist)) * 0.35;
        vec2 wob = vec2(sin(px.y * 0.09 + uTime * 30.0), cos(px.x * 0.08 + uTime * 27.0));
        uv -= (d / dist) * k * 14.0 * inputSize.zw;
        uv += wob * haze * 3.0 * inputSize.zw;
        aberr += k;
    }
    vec4 c = texture2D(uSampler, uv);
    if (aberr > 0.01) {
        vec2 o = vec2(aberr * 3.0) * inputSize.zw;
        c.r = texture2D(uSampler, uv + o).r;
        c.b = texture2D(uSampler, uv - o).b;
    }
    vec3 col = c.rgb;

    vec2 world = uCam + vec2(px.x - uScreen.x * 0.5, uScreen.y * 0.5 - px.y) / uZoom;

    // Cloud shadows drifting with the wind. Kept to 10-20%, and cool: red drops most, blue least.
    float cl = fbm((world + uCloudOff) * 0.011);
    float lo = 0.62 - 0.28 * uCloud;
    float shade = smoothstep(lo, lo + 0.22, cl) * (0.1 + 0.1 * uCloud);
    col *= 1.0 - shade * vec3(1.0, 0.9, 0.7);

    // Wet ground: deeper, cooler, more contrast.
    col = pow(max(col, 0.0), vec3(1.0 + 0.3 * uWet)) * mix(vec3(1.0), vec3(0.9, 0.95, 1.04), uWet);

    // Rolling fog banks, thinner around the player.
    vec2 sc = (px - uScreen * 0.5) / min(uScreen.x, uScreen.y);
    float r = length(sc);
    float f = fbm((world + uFogOff) * 0.03 + vec2(0.0, uTime * 0.015));
    float fogAmt = uFog * smoothstep(0.3, 0.75, f + 0.25 * uFog) * mix(0.3, 1.0, smoothstep(0.08, 0.5, r));
    // Capped so nothing within scope range ever fully disappears.
    col = mix(col, uFogColor, clamp(fogAmt, 0.0, 0.5));

    // Distant rain sheets: stretched noise sliding along the wind, far cheaper than more drops.
    if (uRain > 0.01) {
        vec2 wd = normalize(uWindDir + vec2(0.0001, -0.35));
        vec2 rp = vec2(dot(px, vec2(-wd.y, wd.x)), dot(px, wd));
        float sheet = noise(vec2(rp.x * 0.35, rp.y * 0.012 - uTime * 9.0));
        sheet = smoothstep(0.72, 1.0, sheet) * uRain * dot(uFogColor, vec3(0.33));
        float gustBand = 0.6 + 0.4 * fbm(world * 0.02 + uCloudOff * 0.5);
        col = mix(col, vec3(0.82, 0.88, 0.95) * (0.35 + 0.65 * uFogColor), sheet * 0.12 * gustBand);
    }

    // Lightning.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col += uFlash * vec3(0.7, 0.78, 1.0) * (0.45 + 0.55 * l);

    vec2 e = (px - uScreen * 0.5) / (uScreen * 0.5);
    col *= 1.0 - uVignette * smoothstep(0.5, 1.5, length(e));
    gl_FragColor = vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}
`;

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext("2d")!);
    return PIXI.Texture.from(canvas);
}

const streakTexture = () =>
    canvasTexture(4, 64, (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(1, "rgba(255,255,255,1)");
        ctx.fillStyle = g;
        ctx.fillRect(1, 0, 2, 64);
    });

const ringTexture = () =>
    canvasTexture(64, 64, (ctx) => {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.stroke();
    });

interface Drop {
    sprite: PIXI.Sprite;
    x: number;
    y: number;
    h: number;
    speed: number;
}

interface Splash {
    sprite: PIXI.Sprite;
    pos: Vec2;
    age: number;
    life: number;
    size: number;
    water: boolean;
}

interface Leaf {
    sprite: PIXI.Sprite;
    pos: Vec2;
    vel: Vec2;
    spin: number;
    flutter: number;
    phase: number;
    life: number;
    age: number;
}

export interface Shock {
    pos: Vec2;
    age: number;
    life: number;
    rad: number;
}

export class Weather {
    target: WeatherParams;
    cur: WeatherParams;
    name: WeatherName;

    filter = new PIXI.Filter(undefined, atmoFrag, {
        uScreen: [1, 1],
        uCam: [0, 0],
        uZoom: 1,
        uTime: 0,
        uCloudOff: [0, 0],
        uFogOff: [0, 0],
        uCloud: 0,
        uFog: 0,
        uFogColor: [0.8, 0.82, 0.85],
        uWet: 0,
        uFlash: 0,
        uRain: 0,
        uWindDir: [1, 0],
        uVignette: 0.3,
        uShock: new Float32Array(MaxShocks * 4),
    });

    // Ground-level splashes sit under the lightmap; rain and leaves fall on top of everything.
    splashLayer = new PIXI.ParticleContainer(1500, { vertices: true, position: true, tint: true });
    airLayer = new PIXI.Container();
    rainLayer = new PIXI.ParticleContainer(3000, { vertices: true, position: true, rotation: true, tint: true });
    leafLayer = new PIXI.Container();

    streak = streakTexture();
    ring = ringTexture();
    drops: Drop[] = [];
    splashes: Splash[] = [];
    splashPool: PIXI.Sprite[] = [];
    leaves: Leaf[] = [];
    shocks: Shock[] = [];
    waterCache = new globalThis.Map<number, boolean>();
    dryZones: AABB[] = [];

    windAngle = -0.4;
    wind = { x: 0, y: 0 };
    gust = 0;
    cloudOff = { x: 0, y: 0 };
    fogOff = { x: 0, y: 0 };
    flash = 0;
    strikeIn = 6;
    strikeQueue: number[] = [];
    strikeDist = 0;
    time = 0;

    constructor(name: WeatherName) {
        this.name = name;
        this.target = WeatherPresets[name];
        this.cur = { ...this.target };
        this.airLayer.addChild(this.leafLayer, this.rainLayer);
    }

    /** eases toward the new weather, or jumps straight to it with `snap` */
    setWeather(name: WeatherName, snap = false) {
        this.name = name;
        this.target = WeatherPresets[name];
        if (snap) this.cur = { ...this.target };
    }

    setDryZones(zones: AABB[]) {
        this.dryZones = zones;
    }

    isDry(x: number, y: number) {
        for (const z of this.dryZones) {
            if (x >= z.min.x && x <= z.max.x && y >= z.min.y && y <= z.max.y) return true;
        }
        return false;
    }

    windStrength() {
        return this.cur.wind * (0.7 + 0.6 * this.gust);
    }

    addShock(pos: Vec2, rad: number) {
        if (this.shocks.length >= MaxShocks) this.shocks.shift();
        this.shocks.push({ pos, age: 0, life: 0.7, rad });
    }

    isWater(map: Map, x: number, y: number) {
        const key = (Math.floor(x / 2) << 12) | Math.floor(y / 2);
        let water = this.waterCache.get(key);
        if (water === undefined) {
            water = map.getGroundSurface({ x, y }, 0).type == "water";
            this.waterCache.set(key, water);
        }
        return water;
    }

    update(dt: number, camera: Camera, map: Map, fog: number[], daylight: number, onStrike: (dist: number) => void) {
        this.time += dt;
        const t = this.time;
        const blend = 1 - Math.exp(-dt * 0.6);
        const cur = this.cur;
        for (const k of Object.keys(cur) as Array<keyof WeatherParams>) {
            cur[k] = math.lerp(blend, cur[k], this.target[k]);
        }

        // Wind slowly veers; gusts come in waves.
        this.windAngle += Math.sin(t * 0.05) * dt * 0.05;
        this.gust = math.clamp(0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.7), 0, 1);
        const ws = this.windStrength();
        this.wind.x = Math.cos(this.windAngle) * ws;
        this.wind.y = Math.sin(this.windAngle) * ws;
        this.cloudOff.x -= this.wind.x * dt * 6;
        this.cloudOff.y -= this.wind.y * dt * 6;
        this.fogOff.x -= this.wind.x * dt * 2.5;
        this.fogOff.y -= this.wind.y * dt * 2.5;

        this.updateLightning(dt, onStrike);

        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const z = camera.m_z();
        const u = this.filter.uniforms;
        u.uScreen = [sw, sh];
        u.uCam = [camera.m_pos.x, camera.m_pos.y];
        u.uZoom = z;
        u.uTime = t;
        u.uCloudOff = [this.cloudOff.x, this.cloudOff.y];
        u.uFogOff = [this.fogOff.x, this.fogOff.y];
        u.uCloud = this.cur.cloud * (0.25 + 0.75 * daylight);
        u.uFog = this.cur.fog;
        u.uFogColor = fog;
        u.uWet = this.cur.wet;
        u.uFlash = this.flash;
        u.uRain = this.cur.rain;
        u.uWindDir = [this.wind.x, -this.wind.y];
        u.uVignette = 0.3 + 0.25 * this.cur.gloom;
        const shockU = u.uShock as Float32Array;
        shockU.fill(0);
        for (let i = this.shocks.length - 1; i >= 0; i--) {
            const s = this.shocks[i];
            s.age += dt;
            if (s.age > s.life) {
                this.shocks.splice(i, 1);
                continue;
            }
        }
        for (let i = 0; i < this.shocks.length; i++) {
            const s = this.shocks[i];
            const k = s.age / s.life;
            const sp = camera.m_pointToScreen(s.pos);
            shockU[i * 4] = sp.x;
            shockU[i * 4 + 1] = sp.y;
            shockU[i * 4 + 2] = camera.m_scaleToScreen(s.rad) * (0.15 + 1.1 * Math.sqrt(k));
            shockU[i * 4 + 3] = (1 - k) * (1 - k);
        }

        // The lightmap shades these layers, so they keep their daylight colour here.
        const lightTint = 0xd4e2f5;
        this.updateRain(dt, camera, map, lightTint);
        this.updateSplashes(dt, camera, lightTint);
        // Leaves are muted so they read as part of the ground, not confetti.
        this.updateLeaves(dt, camera, 0xc9c2a4);
    }

    updateLightning(dt: number, onStrike: (dist: number) => void) {
        this.flash = Math.max(0, this.flash - dt * 4.5);
        if (this.cur.storm < 0.5) return;
        this.strikeIn -= dt;
        if (this.strikeIn <= 0) {
            this.strikeIn = 12 + Math.random() * 28;
            // Real strikes flicker: a few pulses in quick succession.
            this.strikeQueue = [0, 0.09 + Math.random() * 0.05, 0.3 + Math.random() * 0.2];
            // 0 is overhead, 1 is on the horizon; most strikes are far.
            this.strikeDist = Math.random() ** 0.4;
            onStrike(this.strikeDist);
        }
        for (let i = this.strikeQueue.length - 1; i >= 0; i--) {
            this.strikeQueue[i] -= dt;
            if (this.strikeQueue[i] <= 0) {
                this.flash = (i == 0 ? 0.9 : 0.55) * (1 - 0.6 * this.strikeDist);
                this.strikeQueue.splice(i, 1);
            }
        }
    }

    // Top-down rain: each drop has a height and falls straight down, so perspective makes
    // it slide toward the screen centre while the wind carries it sideways.
    updateRain(dt: number, camera: Camera, map: Map, tint: number) {
        const z = camera.m_z();
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const halfW = sw / z / 2 + 4;
        const halfH = sh / z / 2 + 4;
        const want = Math.floor(1200 * this.cur.rain * Math.min(1, (sw * sh) / (1280 * 720)));
        const persp = 0.45;
        const cx = sw / 2;
        const cy = sh / 2;
        const cam = camera.m_pos;
        const spawn = (d: Drop, randomH: boolean) => {
            d.x = cam.x + (Math.random() * 2 - 1) * halfW;
            d.y = cam.y + (Math.random() * 2 - 1) * halfH;
            d.h = randomH ? Math.random() : 1;
            d.speed = 1.9 + Math.random() * 0.8;
        };
        while (this.drops.length < want) {
            const s = new PIXI.Sprite(this.streak);
            s.anchor.set(0.5, 1);
            const d = { sprite: s, x: 0, y: 0, h: 0, speed: 0 };
            spawn(d, true);
            this.drops.push(d);
            this.rainLayer.addChild(s);
        }
        while (this.drops.length > want) {
            const d = this.drops.pop()!;
            this.rainLayer.removeChild(d.sprite);
            d.sprite.destroy();
        }
        const wx = this.wind.x * 9;
        const wy = this.wind.y * 9;
        for (const d of this.drops) {
            const prevH = d.h;
            d.h -= d.speed * dt;
            d.x += wx * dt;
            d.y += wy * dt;
            if (d.h <= 0) {
                if (Math.random() < 0.6 && !this.isDry(d.x, d.y)) this.addSplash(map, d.x, d.y);
                spawn(d, false);
                continue;
            }
            // Under a roof there is no rain to see. ParticleContainer ignores `visible`, so use alpha.
            if (this.isDry(d.x, d.y)) {
                d.sprite.alpha = 0;
                continue;
            }
            const k0 = 1 + d.h * persp;
            const sx = cx + (d.x - cam.x) * z * k0;
            const sy = cy - (d.y - cam.y) * z * k0;
            // Where the drop was a moment ago, stretched for a motion streak.
            const back = 0.07;
            const k1 = 1 + Math.min(1.2, prevH + d.speed * back) * persp;
            const px = cx + (d.x - wx * back - cam.x) * z * k1;
            const py = cy - (d.y - wy * back - cam.y) * z * k1;
            const dx = sx - px;
            const dy = sy - py;
            const len = Math.sqrt(dx * dx + dy * dy) + 6;
            const s = d.sprite;
            s.position.set(sx, sy);
            s.rotation = Math.atan2(dy, dx) - Math.PI / 2;
            s.scale.set(0.6 + d.h * 0.5, len / 64);
            s.tint = tint;
            s.alpha = 0.2 + 0.22 * (1 - d.h);
        }
    }

    addSplash(map: Map, x: number, y: number) {
        const water = this.isWater(map, x, y);
        let s = this.splashPool.pop();
        if (!s) {
            s = new PIXI.Sprite(this.ring);
            s.anchor.set(0.5, 0.5);
            this.splashLayer.addChild(s);
        }
        s.visible = true;
        this.splashes.push({
            sprite: s,
            pos: { x, y },
            age: 0,
            life: water ? 0.7 : 0.22,
            size: water ? 0.9 + Math.random() * 0.6 : 0.25 + Math.random() * 0.15,
            water,
        });
    }

    updateSplashes(dt: number, camera: Camera, tint: number) {
        const z = camera.m_z();
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const p = this.splashes[i];
            p.age += dt;
            if (p.age > p.life) {
                p.sprite.alpha = 0;
                this.splashPool.push(p.sprite);
                this.splashes.splice(i, 1);
                continue;
            }
            const k = p.age / p.life;
            const sp = camera.m_pointToScreen(p.pos);
            const size = (p.size * (0.3 + 0.7 * Math.sqrt(k)) * z * 2) / 64;
            p.sprite.position.set(sp.x, sp.y);
            p.sprite.scale.set(size, size * (p.water ? 1 : 0.8));
            p.sprite.tint = tint;
            p.sprite.alpha = (1 - k) * (p.water ? 0.35 : 0.4);
        }
    }

    updateLeaves(dt: number, camera: Camera, tint: number) {
        const z = camera.m_z();
        const sw = camera.m_screenWidth;
        const sh = camera.m_screenHeight;
        const halfW = sw / z / 2;
        const halfH = sh / z / 2;
        const want = Math.floor(70 * this.cur.leaves * (0.4 + 0.6 * this.gust));
        const cam = camera.m_pos;
        if (this.leaves.length < want && Math.random() < dt * 20) {
            const tex = PIXI.Texture.from(`part-leaf-0${1 + Math.floor(Math.random() * 6)}.img`);
            const s = new PIXI.Sprite(tex);
            s.anchor.set(0.5, 0.5);
            this.leafLayer.addChild(s);
            // Enter from the upwind edge so leaves blow across the screen.
            const wlen = Math.hypot(this.wind.x, this.wind.y) || 1;
            const ux = this.wind.x / wlen;
            const uy = this.wind.y / wlen;
            const across = (Math.random() * 2 - 1) * Math.max(halfW, halfH);
            this.leaves.push({
                sprite: s,
                pos: { x: cam.x - ux * (halfW + 3) - uy * across, y: cam.y - uy * (halfH + 3) + ux * across },
                vel: { x: 0, y: 0 },
                spin: (Math.random() * 2 - 1) * 4,
                flutter: 5 + Math.random() * 6,
                phase: Math.random() * 10,
                life: 6 + Math.random() * 4,
                age: 0,
            });
        }
        for (let i = this.leaves.length - 1; i >= 0; i--) {
            const l = this.leaves[i];
            l.age += dt;
            const dx = l.pos.x - cam.x;
            const dy = l.pos.y - cam.y;
            if (l.age > l.life || Math.abs(dx) > halfW + 8 || Math.abs(dy) > halfH + 8) {
                this.leafLayer.removeChild(l.sprite);
                l.sprite.destroy();
                this.leaves.splice(i, 1);
                continue;
            }
            const swirl = Math.sin(this.time * 1.7 + l.phase) * 2.5;
            const tx = this.wind.x * 11 - this.wind.y * swirl;
            const ty = this.wind.y * 11 + this.wind.x * swirl;
            l.vel.x += (tx - l.vel.x) * Math.min(1, dt * 2);
            l.vel.y += (ty - l.vel.y) * Math.min(1, dt * 2);
            l.pos.x += l.vel.x * dt;
            l.pos.y += l.vel.y * dt;
            const sp = camera.m_pointToScreen(l.pos);
            const s = l.sprite;
            s.position.set(sp.x, sp.y);
            s.rotation += l.spin * dt;
            // Squashing one axis fakes the leaf tumbling in 3D.
            const base = camera.m_pixels(0.12);
            s.scale.set(base, base * Math.sin(this.time * l.flutter + l.phase));
            s.tint = tint;
            const fade = Math.min(1, l.age * 2, (l.life - l.age) * 2);
            s.alpha = this.isDry(l.pos.x, l.pos.y) ? 0 : 0.75 * fade;
        }
    }
}

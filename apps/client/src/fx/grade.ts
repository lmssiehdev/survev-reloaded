import * as PIXI from "pixi.js-legacy";
import type { Look } from "./look.ts";

// The one colour pass. It never tints: the lightmap owns colour, this only shapes it.
const gradeFrag = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 uShade;
uniform float uSat;
uniform float uContrast;

void main() {
    vec4 c = texture2D(uSampler, vTextureCoord);
    vec3 col = c.rgb;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uSat);
    col = (col - 0.5) * uContrast + 0.5;
    // Darks sink into the shade colour instead of black.
    col += uShade * (1.0 - smoothstep(0.0, 0.5, l)) * 0.5;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}
`;

export class Grade {
    filter = new PIXI.Filter(undefined, gradeFrag, { uShade: [0, 0, 0], uSat: 1, uContrast: 1 });

    update(look: Look) {
        const u = this.filter.uniforms;
        u.uShade = look.shade;
        u.uSat = look.sat;
        u.uContrast = look.contrast;
    }
}

// Main viewscreen: a full-screen ray tracer that bends light around the black hole,
// plus point-sprite asteroids/torpedoes/explosions and warp "space dust" streaks.
import { mat4 } from 'gl-matrix';
import { getGL, program, fullscreenQuad, fitCanvas, FULLSCREEN_VS, NOISE_GLSL } from './gl.js';
import { vec, forwardOf, targetInfo, C } from './sim.js';

const { sub, norm, cross, dot, len, scale, add } = vec;
const MAXB = 8;

const SPACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamF, uCamR, uCamU;
uniform float uTanHalf;
uniform int uCount;
uniform vec3 uPos[${MAXB}];
uniform float uRad[${MAXB}];
uniform float uType[${MAXB}];
uniform vec3 uCol[${MAXB}];
uniform float uRot[${MAXB}];
uniform vec3 uLight;
uniform int uRingIdx;
uniform vec3 uRingN;
uniform int uPulsarIdx;
uniform vec3 uBeam;
uniform vec3 uBH;
uniform float uRs;
uniform vec3 uDiskN, uDiskE1, uDiskE2;
uniform float uWarp, uWarpFlash, uShield, uHull, uRadiation, uFade;

${NOISE_GLSL}

vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// ---------- background sky ----------
vec3 starLayer(vec3 d, float sc, float thresh) {
  vec3 p = d * sc;
  vec3 c = floor(p);
  float h = hash(c);
  if (h < thresh) return vec3(0.0);
  vec3 o = vec3(hash(c + 11.3), hash(c + 23.7), hash(c + 37.1));
  vec3 sp = normalize(c + 0.15 + 0.7 * o);
  vec3 cr = cross(d, sp);
  float ang2 = dot(cr, cr);
  float pix = 2.0 * uTanHalf / uRes.y;
  float sigma = max(pix * 0.6, 0.0002);
  float b = pow((h - thresh) / (1.0 - thresh), 4.0) * 3.0 + 0.06;
  float t = hash(c + 51.0);
  vec3 tint = t < 0.25 ? vec3(0.65, 0.78, 1.0) : t < 0.7 ? vec3(1.0) : t < 0.9 ? vec3(1.0, 0.88, 0.7) : vec3(1.0, 0.65, 0.45);
  return tint * b * exp(-ang2 / (sigma * sigma));
}

vec3 background(vec3 d) {
  vec3 col = vec3(0.0);
  vec3 gN = normalize(vec3(0.25, 0.92, -0.3));
  float gl = dot(d, gN);
  float band = exp(-gl * gl * 22.0);
  float n1 = fbm(d * 3.0);
  float n2 = fbm(d * 8.0 + 4.0);
  col += vec3(0.55, 0.5, 0.68) * band * (0.025 + 0.09 * n1 * n1);
  float dust = smoothstep(0.42, 0.68, n2) * exp(-gl * gl * 90.0);
  col *= 1.0 - 0.75 * dust;
  // a colorful nebula
  vec3 nd = normalize(vec3(-0.6, 0.18, 0.8));
  float nn = max(dot(d, nd), 0.0);
  float neb = pow(nn, 5.0) * smoothstep(0.35, 0.8, fbm(d * 3.5 + 10.0));
  col += neb * mix(vec3(0.7, 0.12, 0.35), vec3(0.1, 0.45, 0.55), fbm(d * 5.0 + 2.0)) * 0.45;
  vec3 nd2 = normalize(vec3(0.7, -0.3, 0.6));
  float neb2 = pow(max(dot(d, nd2), 0.0), 8.0) * smoothstep(0.4, 0.8, fbm(d * 4.5 - 3.0));
  col += neb2 * vec3(0.25, 0.3, 0.8) * 0.4;
  col += starLayer(d, 140.0, 0.965);
  col += starLayer(d, 290.0, 0.982 - band * 0.02);
  col += starLayer(d, 560.0, 0.993 - band * 0.015) * 0.6;
  return col;
}

// ---------- bodies ----------
float ringDensity(float rr) {
  if (rr < 1.35 || rr > 2.3) return 0.0;
  float b = 0.5 + 0.5 * sin(rr * 47.0) * sin(rr * 13.0 + 1.0);
  float gap = smoothstep(0.0, 0.02, abs(rr - 1.86) - 0.035);
  return (0.3 + 0.6 * b) * gap * smoothstep(1.35, 1.42, rr) * smoothstep(2.3, 2.18, rr);
}

float sphereT(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  vec3 q = oc - b * rd;
  float h = r * r - dot(q, q);
  if (h < 0.0) return -1.0;
  float t = -b - sqrt(h);
  return t > 0.0 ? t : -1.0;
}

vec3 shadeStar(int i, vec3 n, vec3 rd) {
  float mu = max(dot(n, -rd), 0.0);
  vec3 ln = rotY(n, uRot[i]);
  float gran = fbm(ln * 9.0 + uTime * 0.04);
  float spots = smoothstep(0.62, 0.7, fbm(ln * 3.0 + 7.0));
  vec3 c = uCol[i] * (0.45 + 0.55 * pow(mu, 0.45)) * (0.8 + 0.4 * gran) * (1.0 - 0.5 * spots);
  return c * 5.0;
}

vec3 shadePlanet(int i, vec3 hp, vec3 n, vec3 rd) {
  vec3 L = normalize(uLight - hp);
  float diff = max(dot(n, L), 0.0);
  vec3 ln = rotY(n, uRot[i]);
  float type = uType[i];
  vec3 albedo;
  float spec = 0.0;
  vec3 atmo;
  vec3 night = vec3(0.0);
  if (type < 1.5) {
    float h = fbm(ln * 2.5 + 3.1);
    float land = smoothstep(0.5, 0.53, h);
    vec3 ocean = vec3(0.02, 0.1, 0.32);
    vec3 ground = mix(vec3(0.1, 0.32, 0.08), vec3(0.5, 0.42, 0.25), smoothstep(0.56, 0.72, h));
    albedo = mix(ocean, ground, land);
    float ice = smoothstep(0.8, 0.86, abs(ln.y) + 0.12 * fbm(ln * 6.0));
    albedo = mix(albedo, vec3(0.92), ice);
    float cl = smoothstep(0.52, 0.75, fbm(rotY(n, uRot[i] * 1.25) * 4.0 + vec3(0.0, uTime * 0.01, 0.0)));
    albedo = mix(albedo, vec3(1.0), cl * 0.85);
    spec = (1.0 - land) * (1.0 - cl) * 0.7;
    atmo = vec3(0.3, 0.55, 1.0);
    // city lights on the night side
    float city = smoothstep(0.72, 0.9, noise(ln * 60.0)) * land * (1.0 - ice) * (1.0 - cl);
    night = vec3(1.0, 0.75, 0.4) * city * 0.6 * smoothstep(0.1, -0.2, dot(n, L));
  } else if (type < 2.5) {
    float h = fbm(ln * 3.0);
    albedo = mix(vec3(0.42, 0.16, 0.07), vec3(0.82, 0.47, 0.26), h);
    albedo *= 0.75 + 0.5 * fbm(ln * 10.0);
    albedo = mix(albedo, vec3(0.9, 0.86, 0.82), smoothstep(0.88, 0.94, abs(ln.y)));
    atmo = vec3(0.85, 0.5, 0.3) * 0.35;
  } else {
    float lat = ln.y;
    float turb = fbm(vec3(ln.x * 2.0, lat * 10.0, ln.z * 2.0) + vec3(uTime * 0.004));
    float band = sin(lat * 22.0 + turb * 4.0);
    albedo = mix(vec3(0.72, 0.56, 0.38), vec3(0.96, 0.9, 0.74), 0.5 + 0.5 * band);
    albedo = mix(albedo, vec3(0.62, 0.36, 0.2), smoothstep(0.55, 0.85, turb) * 0.55);
    atmo = vec3(0.9, 0.8, 0.6) * 0.25;
  }
  float shadow = 1.0;
  if (i == uRingIdx) {
    float den = dot(L, uRingN);
    if (abs(den) > 1e-4) {
      float tt = dot(uPos[i] - hp, uRingN) / den;
      if (tt > 0.0) {
        vec3 x = hp + L * tt - uPos[i];
        shadow = 1.0 - ringDensity(length(x) / uRad[i]) * 0.85;
      }
    }
  }
  vec3 col = albedo * (diff * shadow * 1.25 + 0.012) + night;
  vec3 hlf = normalize(L - rd);
  col += spec * pow(max(dot(n, hlf), 0.0), 120.0) * diff * vec3(1.0, 0.9, 0.7) * 0.6;
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  col += atmo * rim * smoothstep(-0.25, 0.4, dot(n, L)) * 0.9;
  return col;
}

// integral over s of 1/(k2 + s^2)^2 from s1 to s2
float coronaInt(float k2, float s1, float s2) {
  float k = sqrt(k2);
  float F2 = s2 / (2.0 * k2 * (k2 + s2 * s2)) + atan(s2 / k) / (2.0 * k2 * k);
  float F1 = s1 / (2.0 * k2 * (k2 + s1 * s1)) + atan(s1 / k) / (2.0 * k2 * k);
  return F2 - F1;
}

// Trace a straight segment. Returns true if the ray hit something opaque.
bool traceSeg(vec3 ro, vec3 rd, float L, inout vec3 col, inout float tr) {
  float tHit = L;
  int hi = -1;
  for (int i = 0; i < ${MAXB}; i++) {
    if (i >= uCount) break;
    float t = sphereT(ro, rd, uPos[i], uRad[i]);
    if (t > 0.0 && t < tHit) { tHit = t; hi = i; }
  }
  // glows: stellar coronas and lens bloom
  for (int i = 0; i < ${MAXB}; i++) {
    if (i >= uCount) break;
    float ty = uType[i];
    if (ty > 0.5 && ty < 3.5) continue;
    vec3 rel = uPos[i] - ro;
    float s0 = dot(rel, rd);
    vec3 q = rel - s0 * rd;
    float b2 = dot(q, q);
    float R = uRad[i];
    float cg = ty > 3.5 ? 6.0 : 0.9;
    float k2 = b2 + 0.05 * R * R;
    float corona = R * R * R * coronaInt(k2, -s0, tHit - s0);
    col += tr * uCol[i] * corona * cg * 0.6;
    if (s0 > 0.0 && s0 < tHit + R) {
      float ang2 = b2 / (s0 * s0);
      float angR = R / s0;
      float w = 0.012;
      float bl = angR * angR / (ang2 + w * w) * (ty > 3.5 ? 2.0 : 0.35);
      col += tr * uCol[i] * min(bl, 4.0);
    }
  }
  // pulsar beams
  if (uPulsarIdx >= 0) {
    vec3 P = uPos[uPulsarIdx];
    vec3 w0 = ro - P;
    float bb = dot(rd, uBeam);
    float dd = dot(rd, w0);
    float ee = dot(uBeam, w0);
    float den = max(1.0 - bb * bb, 1e-4);
    float t = clamp((bb * ee - dd) / den, 0.0, tHit);
    float u = dot(ro + rd * t - P, uBeam);
    float dist = length(ro + rd * t - (P + uBeam * u));
    float wid = 1.5 + abs(u) * 0.06;
    float I = exp(-dist * dist / (wid * wid)) * exp(-abs(u) / 600.0) * min(1.0 / (sqrt(den) + 0.02), 30.0);
    col += tr * vec3(0.55, 0.7, 1.0) * I * 0.25;
  }
  // planetary rings
  if (uRingIdx >= 0) {
    vec3 P = uPos[uRingIdx];
    float den = dot(rd, uRingN);
    if (abs(den) > 1e-5) {
      float t = dot(P - ro, uRingN) / den;
      if (t > 0.0 && t < tHit) {
        vec3 x = ro + rd * t;
        float rr = length(x - P) / uRad[uRingIdx];
        float a = ringDensity(rr);
        if (a > 0.0) {
          vec3 L = normalize(uLight - x);
          float sh = sphereT(x, L, P, uRad[uRingIdx]) > 0.0 ? 0.1 : 1.0;
          vec3 rc = mix(vec3(0.8, 0.72, 0.6), vec3(0.95, 0.9, 0.8), fract(rr * 7.3)) * (0.2 + 0.9 * sh);
          col += tr * rc * a;
          tr *= 1.0 - a * 0.9;
        }
      }
    }
  }
  if (hi >= 0) {
    vec3 hp = ro + rd * tHit;
    vec3 n = normalize(hp - uPos[hi]);
    float ty = uType[hi];
    vec3 c;
    if (ty < 0.5) c = shadeStar(hi, n, rd);
    else if (ty > 3.5) c = vec3(0.8, 0.9, 1.0) * 12.0;
    else c = shadePlanet(hi, hp, n, rd);
    col += tr * c;
    tr = 0.0;
    return true;
  }
  return false;
}

// ---------- black hole ----------
vec3 bendToward(vec3 d, vec3 toward, float al) {
  vec3 n = toward - dot(toward, d) * d;
  float l = length(n);
  if (l < 1e-6) return d;
  n /= l;
  al = min(al, 1.5);
  return normalize(d * cos(al) + n * sin(al));
}

vec3 diskEmission(vec3 x, vec3 d, out float a) {
  float rr = length(x) / uRs;
  a = 0.0;
  if (rr < 3.0 || rr > 11.0) return vec3(0.0);
  float u = dot(x, uDiskE1), v = dot(x, uDiskE2);
  float omega = 0.9 * pow(rr / 3.0, -1.5);
  float th = atan(v, u) - omega * uTime;
  // streaky texture: slow around the disk, fast in radius
  float n = fbm(vec3(cos(th) * 1.6, sin(th) * 1.6, rr * 2.2));
  float n2 = noise(vec3(cos(th) * 4.0, sin(th) * 4.0, rr * 9.0));
  float T = pow(rr / 3.0, -0.75);
  vec3 base = mix(vec3(1.0, 0.3, 0.06), vec3(1.0, 0.85, 0.6), T);
  base = mix(base, vec3(0.9, 0.95, 1.0), T * T * 0.4);
  // Doppler beaming: gas coming toward us looks brighter and bluer
  vec3 tang = normalize(cross(uDiskN, x));
  float beta = sqrt(0.5 / rr);
  float gamma = 1.0 / sqrt(1.0 - beta * beta);
  float g = 1.0 / (gamma * (1.0 - beta * dot(tang, -d)));
  g *= sqrt(1.0 - 1.0 / rr);
  vec3 shifted = base * mix(vec3(1.25, 0.7, 0.45), vec3(0.75, 0.9, 1.35), smoothstep(0.6, 1.4, g));
  float I = pow(g, 3.0) * T * T * 3.5 * (0.45 + 0.9 * n) * (0.8 + 0.4 * n2);
  float edge = smoothstep(3.0, 3.4, rr) * smoothstep(11.0, 8.0, rr);
  a = clamp(edge * (0.55 + 0.45 * n), 0.0, 0.95);
  return shifted * I * edge;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hexEdge(vec2 p) {
  p.x *= 1.1547;
  p.y += mod(floor(p.x), 2.0) * 0.5;
  p = abs(fract(p) - 0.5);
  return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uCamF + uv.x * aspect * uTanHalf * uCamR + uv.y * uTanHalf * uCamU);
  vec3 ro = vec3(0.0);
  vec3 col = vec3(0.0);
  float tr = 1.0;
  bool done = false;
  float Rl = 30.0 * uRs;

  vec3 rel = uBH - ro;
  float s0 = dot(rel, rd);
  vec3 qq = rel - s0 * rd;
  float b2 = dot(qq, qq);
  bool march = length(rel) < Rl;
  if (!march) {
    float b = sqrt(b2);
    if (b < Rl && s0 > 0.0) {
      float se = sqrt(Rl * Rl - b2);
      float tE = s0 - se;
      done = traceSeg(ro, rd, tE, col, tr);
      if (!done) {
        ro += rd * tE;
        float al = uRs / b * (-se / Rl + s0 / sqrt(b2 + s0 * s0));
        rd = bendToward(rd, uBH - ro, al);
        march = true;
      }
    } else {
      // weak lensing: total deflection 2 rs / b (Einstein's famous result)
      float al = uRs / b * (1.0 + s0 / sqrt(b2 + s0 * s0));
      if (s0 > 0.0) {
        done = traceSeg(ro, rd, s0, col, tr);
        if (!done) { ro += rd * s0; rd = bendToward(rd, uBH - ro, al); }
      } else {
        rd = bendToward(rd, uBH - ro, al);
      }
    }
  }
  if (march && !done) {
    vec3 p = ro - uBH;
    vec3 d = rd;
    for (int i = 0; i < 400; i++) {
      float r = length(p);
      if (r < uRs) { tr = 0.0; done = true; break; }
      if (r > Rl && dot(p, d) > 0.0) {
        float s = dot(p, d);
        float b = length(p - s * d);
        d = bendToward(d, -p, uRs / b * (1.0 - s / r));
        break;
      }
      float dt = clamp(0.06 * r, 0.02 * uRs, 2.5 * uRs);
      vec3 h = cross(p, d);
      float h2 = dot(h, h);
      float r2 = r * r;
      // photon geodesic in Schwarzschild space-time: a = -1.5 rs h^2 x / r^5
      vec3 acc = -1.5 * uRs * h2 * p / (r2 * r2 * r);
      vec3 dn = normalize(d + acc * dt);
      vec3 pn = p + dn * dt;
      float sa = dot(p, uDiskN), sb = dot(pn, uDiskN);
      if (sa * sb < 0.0) {
        vec3 x = mix(p, pn, sa / (sa - sb));
        float a;
        vec3 e = diskEmission(x, dn, a);
        col += tr * e;
        tr *= 1.0 - a;
        if (tr < 0.02) { done = true; break; }
      }
      p = pn;
      d = dn;
    }
    ro = p + uBH;
    rd = d;
  }
  if (!done) {
    done = traceSeg(ro, rd, 1e7, col, tr);
    if (!done) col += tr * background(rd);
  }

  // ---------- screen effects ----------
  float r = length(uv * vec2(aspect, 1.0)) / aspect;
  if (uWarp > 0.0) {
    float a = atan(uv.y, uv.x * aspect);
    float k = a * 90.0 / 3.14159;
    float id = floor(k);
    float hh = fract(sin(id * 91.7) * 4375.5);
    float dA = abs(fract(k) - 0.5);
    float f = fract(hh * 7.0 + log(r + 0.02) * 1.2 - uTime * (1.2 + hh * 2.0) * (0.4 + uWarp));
    float dash = smoothstep(0.0, 0.15, f) * smoothstep(0.75, 0.2, f);
    col += uWarp * vec3(0.55, 0.72, 1.0) * dash * smoothstep(0.12, 0.0, dA) * step(0.55, hh) * r * 1.4;
    col = mix(col, col * vec3(0.85, 0.95, 1.3), uWarp * 0.5);
  }
  col += uWarpFlash * vec3(0.7, 0.85, 1.0) * exp(-r * 2.0) * 3.0;
  if (uShield > 0.0) {
    float e = hexEdge(uv * vec2(aspect, 1.0) * 7.0);
    col += uShield * vec3(0.3, 0.6, 1.0) * (smoothstep(0.12, 0.0, e) * 0.9 + 0.12) * (0.25 + r);
  }
  col += uHull * vec3(0.8, 0.12, 0.02) * r * 1.2;
  if (uRadiation > 0.0) {
    float st = fract(sin(dot(floor(gl_FragCoord.xy * 0.5) + uTime * 37.0, vec2(12.9898, 78.233))) * 43758.5453);
    col += uRadiation * vec3(0.5, 0.7, 1.0) * st * 0.18;
  }
  col = aces(col * 1.1);
  col = pow(col, vec3(1.0 / 2.2));
  col *= 1.0 - 0.25 * r * r;
  col *= 0.96 + 0.04 * sin(gl_FragCoord.y * 1.6);
  col *= 1.0 - uFade;
  outColor = vec4(col, 1.0);
}
`;

const DUST_VS = `#version 300 es
layout(location = 0) in vec3 aBase;
layout(location = 1) in float aEnd;
uniform mat4 uVP;
uniform vec3 uOffset;
uniform float uBox;
uniform vec3 uStreak;
out float vA;
void main() {
  vec3 p = (fract(aBase - uOffset) - 0.5) * uBox;
  float fade = clamp(1.0 - length(p) / (uBox * 0.5), 0.0, 1.0);
  p -= uStreak * aEnd;
  vA = fade * (1.0 - aEnd);
  gl_Position = uVP * vec4(p, 1.0);
}`;
const DUST_FS = `#version 300 es
precision mediump float;
in float vA;
uniform vec3 uColor;
out vec4 o;
void main() { o = vec4(uColor * vA, 1.0); }`;

const SPRITE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aSize;
layout(location = 2) in vec4 aCol;
uniform mat4 uVP;
uniform mat4 uView;
uniform float uPx;
uniform float uGlow;
uniform vec3 uLight;
out vec4 vCol;
out vec3 vL;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float px = aSize * uPx / max(c.w, 0.05) * (uGlow > 0.5 ? 3.0 : 1.0);
  gl_PointSize = clamp(px, uGlow > 0.5 ? 2.0 : 1.5, 512.0);
  vCol = aCol;
  if (px < 1.5) vCol.rgb *= px / 1.5;
  vL = normalize(mat3(uView) * normalize(uLight - aPos));
}`;
const SPRITE_FS = `#version 300 es
precision highp float;
in vec4 vCol;
in vec3 vL;
uniform float uGlow;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (uGlow > 0.5) {
    float I = exp(-r2 * 6.0) + 0.3 * exp(-r2 * 1.5);
    o = vec4(vCol.rgb * I * vCol.a, 1.0);
    return;
  }
  float seed = vCol.a * 37.0;
  float ang = atan(q.y, q.x);
  float lump = 1.0 - 0.18 * (0.5 + 0.5 * sin(ang * 3.0 + seed)) * (0.5 + 0.5 * sin(ang * 5.0 + seed * 2.3));
  if (r2 > lump * lump) discard;
  vec3 n = normalize(vec3(q, sqrt(max(lump * lump - r2, 0.0))));
  float crater = 0.8 + 0.2 * sin(q.x * 9.0 + seed * 3.0) * sin(q.y * 11.0 + seed);
  float diff = max(dot(n, vL), 0.0);
  vec3 col = vCol.rgb * (diff * 1.2 + 0.04) * crater;
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

export function createViewscreen(canvas, overlay) {
  const gl = getGL(canvas);
  const space = program(gl, FULLSCREEN_VS, SPACE_FS);
  const dust = program(gl, DUST_VS, DUST_FS);
  const sprite = program(gl, SPRITE_VS, SPRITE_FS);
  const quad = fullscreenQuad(gl);
  const ctx = overlay.getContext('2d');

  // dust particles
  const NDUST = 700;
  const dustData = new Float32Array(NDUST * 2 * 4);
  for (let i = 0; i < NDUST; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    dustData.set([x, y, z, 0, x, y, z, 1], i * 8);
  }
  const dustVao = gl.createVertexArray();
  gl.bindVertexArray(dustVao);
  const dustBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dustData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  gl.bindVertexArray(null);

  // sprites
  const spriteVao = gl.createVertexArray();
  const spriteBuf = gl.createBuffer();
  gl.bindVertexArray(spriteVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);

  const dustPos = [0, 0, 0];
  let camF = null;
  let shake = 0;
  const view = mat4.create();
  const proj = mat4.create();
  const vp = mat4.create();
  const bodyPos = new Float32Array(MAXB * 3);
  const bodyRad = new Float32Array(MAXB);
  const bodyType = new Float32Array(MAXB);
  const bodyCol = new Float32Array(MAXB * 3);
  const bodyRot = new Float32Array(MAXB);
  let showLabels = true;

  function camera(world, dt) {
    const s = world.ship;
    const f = forwardOf(s.yaw, s.pitch);
    let want = f;
    if (s.view === 'aft') want = scale(f, -1);
    else if (s.view === 'target') {
      const t = targetInfo(world, s.target);
      if (t) want = norm(sub(t.pos, s.pos));
    }
    if (!camF) camF = want;
    const k = Math.min(1, dt * 5);
    camF = norm(add(scale(camF, 1 - k), scale(want, k)));
    let up = [0, 1, 0];
    if (s.view === 'forward') up = forwardOf(s.yaw, s.pitch + Math.PI / 2);
    let R = cross(camF, up);
    if (len(R) < 1e-3) R = cross(camF, [0, 0, 1]);
    R = norm(R);
    const U = cross(R, camF);
    return { F: camF, R, U };
  }

  function render(world, dt) {
    fitCanvas(canvas, 0.85);
    fitCanvas(overlay);
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    const s = world.ship;
    const cam = camera(world, dt);
    const fovY = (s.zoom > 1 ? 14 : 55) * (Math.PI / 180);
    const tanHalf = Math.tan(fovY / 2);
    const eye = s.pos;
    const fx = world.fx;

    // screen shake on hits
    shake = Math.max(shake * Math.exp(-dt * 6), fx.hullHit * 0.6, fx.shieldHit * 0.3);
    let F = cam.F;
    if (shake > 0.01) {
      const j = 0.012 * shake;
      F = norm(add(F, add(scale(cam.R, (Math.random() - 0.5) * j), scale(cam.U, (Math.random() - 0.5) * j))));
    }
    const Rv = norm(cross(F, cam.U));
    const Uv = cross(Rv, F);

    // ----- pack bodies -----
    let n = 0;
    let ringIdx = -1;
    let pulsarIdx = -1;
    let bh = null;
    for (const b of world.bodies) {
      if (b.kind === 'blackhole') {
        bh = b;
        continue;
      }
      const rel = sub(b.pos, eye);
      bodyPos.set(rel, n * 3);
      bodyRad[n] = b.R;
      bodyType[n] = b.type;
      bodyCol.set(b.color, n * 3);
      bodyRot[n] = world.t * b.spin;
      if (b.rings) ringIdx = n;
      if (b.kind === 'pulsar') pulsarIdx = n;
      n++;
    }
    const u = space.u;
    gl.useProgram(space.p);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uTime, world.t);
    gl.uniform3fv(u.uCamF, F);
    gl.uniform3fv(u.uCamR, Rv);
    gl.uniform3fv(u.uCamU, Uv);
    gl.uniform1f(u.uTanHalf, tanHalf);
    gl.uniform1i(u.uCount, n);
    gl.uniform3fv(u.uPos, bodyPos);
    gl.uniform1fv(u.uRad, bodyRad);
    gl.uniform1fv(u.uType, bodyType);
    gl.uniform3fv(u.uCol, bodyCol);
    gl.uniform1fv(u.uRot, bodyRot);
    gl.uniform3fv(u.uLight, sub(world.byId.helios.pos, eye));
    gl.uniform1i(u.uRingIdx, ringIdx);
    gl.uniform3fv(u.uRingN, norm([0.15, 1, 0.12]));
    gl.uniform1i(u.uPulsarIdx, pulsarIdx);
    gl.uniform3fv(u.uBeam, world.byId.vela.beam);
    gl.uniform3fv(u.uBH, sub(bh.pos, eye));
    gl.uniform1f(u.uRs, bh.rs);
    const N = bh.diskN;
    const E1 = norm(cross(N, [0, 0, 1]));
    const E2 = cross(N, E1);
    gl.uniform3fv(u.uDiskN, N);
    gl.uniform3fv(u.uDiskE1, E1);
    gl.uniform3fv(u.uDiskE2, E2);
    const warpVis = s.warp.engaged ? Math.min(1, s.warp.level * 1.2) * (0.5 + s.warp.factor / 18) : 0;
    gl.uniform1f(u.uWarp, warpVis);
    gl.uniform1f(u.uWarpFlash, fx.warpFlash);
    gl.uniform1f(u.uShield, fx.shieldHit);
    gl.uniform1f(u.uHull, fx.hullHit);
    gl.uniform1f(u.uRadiation, fx.radiation);
    const rbh = len(sub(eye, bh.pos));
    gl.uniform1f(u.uFade, world.gameOver ? 1 : Math.max(0, Math.min(1, (1.6 * bh.rs - rbh) / (0.6 * bh.rs))));
    gl.disable(gl.BLEND);
    quad.draw();

    // ----- 3D overlays: dust, sprites -----
    mat4.lookAt(view, [0, 0, 0], F, Uv);
    mat4.perspective(proj, fovY, W / H, 0.05, 1e5);
    mat4.multiply(vp, proj, view);

    // dust: moves at a "visual" speed so warp looks like streaking stars
    const ref = world.stats.ref;
    let relV = sub(s.vel, ref ? ref.vel : [0, 0, 0]);
    let box = 60;
    let streak = scale(relV, 0.12);
    let bright = Math.min(1, len(relV) / 6) * 0.5;
    if (s.warp.engaged) {
      const f = forwardOf(s.yaw, s.pitch);
      const vis = (40 + 25 * s.warp.factor) * s.warp.level;
      relV = scale(f, vis);
      box = 220;
      streak = scale(f, 6 + s.warp.factor * 5 * s.warp.level);
      bright = 0.9;
    }
    for (let i = 0; i < 3; i++) dustPos[i] += relV[i] * dt;
    if (bright > 0.01) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(dust.p);
      gl.uniformMatrix4fv(dust.u.uVP, false, vp);
      gl.uniform3f(dust.u.uOffset, ...dustPos.map((x) => ((x / box) % 1 + 1) % 1));
      gl.uniform1f(dust.u.uBox, box);
      gl.uniform3fv(dust.u.uStreak, streak);
      gl.uniform3f(dust.u.uColor, 0.6 * bright, 0.75 * bright, 1.0 * bright);
      gl.bindVertexArray(dustVao);
      gl.drawArrays(gl.LINES, 0, NDUST * 2);
      gl.bindVertexArray(null);
    }

    // sprites
    const rocks = [];
    const glows = [];
    for (const a of world.asteroids) {
      if (!a.alive) continue;
      const rel = sub(a.pos, eye);
      const d2 = dot(rel, rel);
      if (d2 > 2500 * 2500 || dot(rel, F) < 0) continue;
      rocks.push([d2, rel[0], rel[1], rel[2], a.r, 0.55 * a.shade, 0.5 * a.shade, 0.45 * a.shade, (a.index * 0.618) % 1]);
    }
    rocks.sort((p, q) => q[0] - p[0]);
    for (const t of world.torpedoes) {
      const rel = sub(t.pos, eye);
      glows.push([rel[0], rel[1], rel[2], 0.9, 1.0, 0.35, 0.2, 1.6 + 0.4 * Math.sin(world.t * 40)]);
    }
    for (const e of world.explosions) {
      const rel = sub(e.pos, eye);
      const k = e.t / e.life;
      glows.push([rel[0], rel[1], rel[2], e.size * (0.6 + 2.2 * k), e.color[0], e.color[1], e.color[2], 2.5 * (1 - k) * (1 - k)]);
    }
    for (const p of world.particles) {
      const rel = sub(p.pos, eye);
      const k = p.t / p.life;
      glows.push([rel[0], rel[1], rel[2], p.size, p.color[0], p.color[1], p.color[2], 1.2 * (1 - k)]);
    }
    if (world.ejectedCore) {
      const rel = sub(world.ejectedCore.pos, eye);
      glows.push([rel[0], rel[1], rel[2], 1.2, 0.4, 0.7, 1.0, 2.0 + Math.sin(world.t * 20)]);
    }
    const pxScale = H / (2 * tanHalf);
    gl.useProgram(sprite.p);
    gl.uniformMatrix4fv(sprite.u.uVP, false, vp);
    gl.uniformMatrix4fv(sprite.u.uView, false, view);
    gl.uniform1f(sprite.u.uPx, pxScale);
    gl.uniform3fv(sprite.u.uLight, sub(world.byId.helios.pos, eye));
    gl.bindVertexArray(spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    if (rocks.length) {
      const arr = new Float32Array(rocks.length * 8);
      rocks.forEach((r, i) => arr.set(r.slice(1), i * 8));
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
      gl.disable(gl.BLEND);
      gl.uniform1f(sprite.u.uGlow, 0);
      gl.drawArrays(gl.POINTS, 0, rocks.length);
    }
    if (glows.length) {
      const arr = new Float32Array(glows.length * 8);
      glows.forEach((g, i) => arr.set(g, i * 8));
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(sprite.u.uGlow, 1);
      gl.drawArrays(gl.POINTS, 0, glows.length);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    drawOverlay(world, F, Rv, Uv, tanHalf);
  }

  function project(rel, F, R, U, tanHalf) {
    const z = dot(rel, F);
    if (z <= 0.01) return null;
    const W = overlay.width, H = overlay.height;
    const x = dot(rel, R) / (z * tanHalf * (W / H));
    const y = dot(rel, U) / (z * tanHalf);
    return [(x * 0.5 + 0.5) * W, (0.5 - y * 0.5) * H, z];
  }

  function drawOverlay(world, F, R, U, tanHalf) {
    const W = overlay.width, H = overlay.height;
    ctx.clearRect(0, 0, W, H);
    const s = world.ship;
    const eye = s.pos;
    const fs = Math.max(11, Math.round(H / 42));
    ctx.font = `${fs}px Antonio, 'Arial Narrow', sans-serif`;
    ctx.textBaseline = 'middle';

    // phaser beam
    const ph = world.fx.phaser;
    if (ph) {
      const t = targetInfo(world, ph.target);
      const p = t && project(sub(t.pos, eye), F, R, U, tanHalf);
      if (p) {
        const k = ph.time / ph.total;
        const wob = 1 + 0.3 * Math.sin(world.t * 60);
        for (const sx of [0.42, 0.58]) {
          const x0 = W * sx, y0 = H * 1.02;
          ctx.save();
          ctx.lineCap = 'round';
          ctx.shadowColor = '#ff6a1a';
          ctx.shadowBlur = 25;
          ctx.strokeStyle = `rgba(255,120,40,${0.8 * k + 0.2})`;
          ctx.lineWidth = (H / 90) * wob;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(p[0], p[1]);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,240,200,0.95)';
          ctx.lineWidth = (H / 300) * wob;
          ctx.stroke();
          ctx.restore();
        }
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], H / 18);
        g.addColorStop(0, 'rgba(255,230,180,0.9)');
        g.addColorStop(1, 'rgba(255,100,30,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p[0] - H / 18, p[1] - H / 18, H / 9, H / 9);
      }
    }

    // labels for celestial bodies
    if (showLabels) {
      // nearest (and targeted) bodies get their labels first; skip ones that would overlap
      const placed = [];
      const order = world.bodies
        .map((b) => ({ b, d: len(sub(b.pos, eye)) }))
        .sort((x, y) => (x.b.id === s.target ? -1 : y.b.id === s.target ? 1 : x.d - y.d));
      ctx.textAlign = 'center';
      const pxPerRad = H / (2 * tanHalf);
      const discs = order.map(({ b, d }) => ({ d, p: project(sub(b.pos, eye), F, R, U, tanHalf), r: (b.R / d) * pxPerRad }));
      for (const [i, { b, d }] of order.entries()) {
        const p = discs[i].p;
        if (!p) continue;
        // hidden behind a nearer body?
        if (discs.some((o, j) => j !== i && o.p && o.d < d && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < o.r)) continue;
        const rpx = discs[i].r;
        const ly = p[1] - Math.max(rpx, 6) - fs * 0.9;
        if (p[0] < -50 || p[0] > W + 50 || ly < -20 || ly > H + 20) continue;
        const text = `${b.name.toUpperCase()}  ${(d / C).toFixed(1)} LS`;
        const w = ctx.measureText(text).width;
        const box = [p[0] - w / 2 - 4, ly - fs / 2 - 2, w + 8, fs + 4];
        if (placed.some((q) => box[0] < q[0] + q[2] && q[0] < box[0] + box[2] && box[1] < q[1] + q[3] && q[1] < box[1] + box[3])) continue;
        placed.push(box);
        ctx.fillStyle = b.id === s.target ? '#ffcc66' : 'rgba(153,204,255,0.85)';
        ctx.fillText(text, p[0], ly);
      }
    }

    // target bracket
    const t = targetInfo(world, s.target);
    if (t) {
      const rel = sub(t.pos, eye);
      const p = project(rel, F, R, U, tanHalf);
      const d = len(rel);
      if (p && p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40) {
        const rpx = Math.max(14, (t.R / d) * (H / (2 * tanHalf)) * 1.3 + 8);
        const c = rpx * 0.45;
        ctx.strokeStyle = '#ffaa33';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const x = p[0] + sx * rpx, y = p[1] + sy * rpx;
          ctx.moveTo(x - sx * c, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y - sy * c);
        }
        ctx.stroke();
        if (t.kind === 'asteroid' || t.kind === 'core') {
          ctx.fillStyle = '#ffaa33';
          ctx.textAlign = 'left';
          ctx.fillText(`${t.name.toUpperCase()}  ${(d / C).toFixed(2)} LS`, p[0] + rpx + 6, p[1] - rpx);
          if (t.asteroid) {
            const hp = Math.max(0, t.asteroid.hp / t.asteroid.maxHp);
            ctx.fillStyle = 'rgba(255,170,51,0.3)';
            ctx.fillRect(p[0] + rpx + 6, p[1] - rpx + fs * 0.7, 60, 5);
            ctx.fillStyle = '#ffaa33';
            ctx.fillRect(p[0] + rpx + 6, p[1] - rpx + fs * 0.7, 60 * hp, 5);
          }
        }
      } else {
        // off-screen: arrow at the edge pointing toward the target
        const a = Math.atan2(-dot(rel, U), dot(rel, R));
        const cx = W / 2 + Math.cos(a) * (W / 2 - 40);
        const cy = H / 2 + Math.sin(a) * (H / 2 - 40);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.fillStyle = '#ffaa33';
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -9);
        ctx.lineTo(-8, 9);
        ctx.fill();
        ctx.restore();
      }
    }

    // reticle
    if (s.view === 'forward') {
      ctx.strokeStyle = 'rgba(255,153,0,0.5)';
      ctx.lineWidth = 1.5;
      const cx = W / 2, cy = H / 2, r = H / 40;
      ctx.beginPath();
      ctx.moveTo(cx - r * 2, cy);
      ctx.lineTo(cx - r * 0.6, cy);
      ctx.moveTo(cx + r * 0.6, cy);
      ctx.lineTo(cx + r * 2, cy);
      ctx.moveTo(cx, cy - r * 1.2);
      ctx.lineTo(cx, cy - r * 0.6);
      ctx.moveTo(cx, cy + r * 0.6);
      ctx.lineTo(cx, cy + r * 1.2);
      ctx.stroke();
    }
  }

  return {
    render,
    setLabels(v) {
      showLabels = v;
    },
    get labels() {
      return showLabels;
    },
  };
}

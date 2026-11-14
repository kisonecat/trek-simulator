// Tactical display: a top-down sector map with gravity contours, and a 3D
// "rubber sheet" view of the gravity wells around the ship.
import { mat4, vec4 } from 'gl-matrix';
import { getGL, program, fullscreenQuad, fitCanvas, FULLSCREEN_VS } from './gl.js';
import { forwardOf, predictTrajectory, targetInfo, C } from './sim.js';

const MAXB = 8;

const MAP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes;
uniform vec2 uCenter;   // world x,z at the screen center
uniform float uScale;   // world units per half-height
uniform int uCount;
uniform vec3 uB[${MAXB}];   // x, z, GM
uniform float uSoft[${MAXB}];
void main() {
  vec2 p = uCenter + vUv * vec2(uRes.x / uRes.y, 1.0) * uScale;
  float phi = 0.0;
  for (int i = 0; i < ${MAXB}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uB[i].xy;
    phi += uB[i].z / sqrt(dot(d, d) + uSoft[i] * uSoft[i]);
  }
  float v = log(phi + 1.0);
  float px = uScale * 2.0 / uRes.y;
  // contour lines of gravitational potential
  float fw = fwidth(v * 3.0);
  float c = abs(fract(v * 3.0) - 0.5);
  float line = smoothstep(fw * 1.5, 0.0, 0.5 - c);
  vec3 col = mix(vec3(0.02, 0.02, 0.06), vec3(0.18, 0.08, 0.28), clamp(v / 8.0, 0.0, 1.0));
  col += line * mix(vec3(0.6, 0.4, 1.0), vec3(1.0, 0.6, 0.2), clamp(v / 7.0, 0.0, 1.0)) * 0.55;
  // grid
  float g = pow(10.0, floor(log(uScale) / log(10.0)));
  vec2 gg = abs(fract(p / g + 0.5) - 0.5) * g;
  float grid = smoothstep(px * 1.2, 0.0, min(gg.x, gg.y));
  col += grid * vec3(0.12, 0.16, 0.3);
  o = vec4(col, 1.0);
}`;

const WELL_VS = `#version 300 es
layout(location = 0) in vec2 aGrid;
uniform mat4 uVP;
uniform vec2 uCenter;
uniform float uExtent;
uniform float uPhiRef;
uniform int uCount;
uniform vec3 uB[${MAXB}];
uniform float uSoft[${MAXB}];
out float vH;
out float vEdge;
void main() {
  vec2 w = uCenter + aGrid * uExtent;
  float phi = 0.0;
  for (int i = 0; i < ${MAXB}; i++) {
    if (i >= uCount) break;
    vec2 d = w - uB[i].xy;
    phi += uB[i].z / sqrt(dot(d, d) + uSoft[i] * uSoft[i]);
  }
  // depth relative to the potential at the edge of the view, so wells look
  // like funnels at every zoom level
  float hn = max(phi / uPhiRef - 1.0, 0.0);
  float h = -uExtent * 0.8 * hn / (hn + 2.5);
  vH = -h / uExtent * 1.6;
  vEdge = 1.0 - smoothstep(0.85, 1.0, max(abs(aGrid.x), abs(aGrid.y)));
  gl_Position = uVP * vec4(aGrid.x * uExtent, h, aGrid.y * uExtent, 1.0);
}`;
const WELL_FS = `#version 300 es
precision mediump float;
in float vH;
in float vEdge;
out vec4 o;
void main() {
  vec3 c = mix(vec3(1.0, 0.6, 0.2), vec3(0.6, 0.4, 1.0), clamp(vH * 2.0, 0.0, 1.0));
  c = mix(c, vec3(0.9, 0.2, 0.3), clamp(vH - 0.6, 0.0, 1.0));
  o = vec4(c * (0.35 + 0.65 * vEdge) * vEdge, 1.0);
}`;

export function createTactical(canvas, overlay) {
  const gl = getGL(canvas, { antialias: true });
  const mapProg = program(gl, FULLSCREEN_VS, MAP_FS);
  const wellProg = program(gl, WELL_VS, WELL_FS);
  const quad = fullscreenQuad(gl);
  const ctx = overlay.getContext('2d');

  // grid lines for the gravity well
  const N = 64;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      const a = -1 + (2 * i) / N, b0 = -1 + (2 * j) / N, b1 = -1 + (2 * (j + 1)) / N;
      pts.push(a, b0, a, b1); // along z
      pts.push(b0, a, b1, a); // along x
    }
  }
  const wellCount = pts.length / 2;
  const wellVao = gl.createVertexArray();
  gl.bindVertexArray(wellVao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const state = { mode: 'map', zoom: 3 };
  const ZOOMS = [40, 90, 200, 450, 1000, 2200, 4500];
  const B = new Float32Array(MAXB * 3);
  const soft = new Float32Array(MAXB);
  let trajectory = [];
  let trajTimer = 0;
  const vp = mat4.create();
  let orbitAngle = 0;

  function packBodies(world, cx, cz, minSoft = 0) {
    let n = 0;
    for (const b of world.bodies) {
      B[n * 3] = b.pos[0] - cx;
      B[n * 3 + 1] = b.pos[2] - cz;
      B[n * 3 + 2] = b.GM;
      soft[n] = Math.max(minSoft, b.kind === 'blackhole' ? b.rs * 0.6 : Math.max(b.R * 0.8, 3));
      n++;
    }
    return n;
  }

  function render(world, dt) {
    fitCanvas(canvas);
    fitCanvas(overlay);
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    const s = world.ship;
    const scale = ZOOMS[state.zoom];
    const cx = s.pos[0], cz = s.pos[2];
    const n = packBodies(world, cx, cz, state.mode === 'well' ? scale * 0.03 : 0);

    trajTimer -= dt;
    if (trajTimer <= 0) {
      trajTimer = 0.25;
      const secs = Math.min(240, Math.max(20, scale / 3));
      trajectory = predictTrajectory(world, secs, 240);
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (state.mode === 'map') {
      gl.useProgram(mapProg.p);
      gl.uniform2f(mapProg.u.uRes, W, H);
      gl.uniform2f(mapProg.u.uCenter, 0, 0);
      gl.uniform1f(mapProg.u.uScale, scale);
      gl.uniform1i(mapProg.u.uCount, n);
      gl.uniform3fv(mapProg.u.uB, B);
      gl.uniform1fv(mapProg.u.uSoft, soft);
      quad.draw();
      drawMapOverlay(world, scale);
    } else {
      const extent = scale * 1.1;
      orbitAngle += dt * 0.05;
      const yaw = s.yaw + Math.PI + Math.sin(orbitAngle) * 0.5;
      const dist = extent * 2.1;
      const eye = [Math.sin(yaw) * dist * 0.85, extent * 0.4, -Math.cos(yaw) * dist * 0.85];
      const view = mat4.lookAt(mat4.create(), eye, [0, -extent * 0.3, 0], [0, 1, 0]);
      const proj = mat4.perspective(mat4.create(), 0.8, W / H, extent * 0.05, extent * 10);
      mat4.multiply(vp, proj, view);
      gl.useProgram(wellProg.p);
      gl.uniformMatrix4fv(wellProg.u.uVP, false, vp);
      gl.uniform2f(wellProg.u.uCenter, 0, 0);
      gl.uniform1f(wellProg.u.uExtent, extent);
      let phiRef = Infinity;
      for (const [x, z] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        phiRef = Math.min(phiRef, phiAt(x * extent, z * extent, n));
      }
      phiRef = Math.max(phiRef, 1e-3);
      gl.uniform1f(wellProg.u.uPhiRef, phiRef);
      gl.uniform1i(wellProg.u.uCount, n);
      gl.uniform3fv(wellProg.u.uB, B);
      gl.uniform1fv(wellProg.u.uSoft, soft);
      gl.bindVertexArray(wellVao);
      gl.drawArrays(gl.LINES, 0, wellCount);
      gl.bindVertexArray(null);
      drawWellOverlay(world, extent, phiRef, n);
    }
  }

  // ---------- map overlay ----------
  function drawMapOverlay(world, scale) {
    const W = overlay.width, H = overlay.height;
    ctx.clearRect(0, 0, W, H);
    const s = world.ship;
    const k = H / 2 / scale;
    const toScreen = (p) => [W / 2 + (p[0] - s.pos[0]) * k, H / 2 + (p[2] - s.pos[2]) * k];
    const fs = Math.max(10, Math.round(H / 34));
    ctx.font = `${fs}px Antonio, 'Arial Narrow', sans-serif`;
    ctx.textBaseline = 'middle';

    // planetary orbits
    const helios = world.byId.helios;
    const hc = toScreen(helios.pos);
    ctx.strokeStyle = 'rgba(153,153,255,0.25)';
    ctx.lineWidth = 1;
    for (const b of world.bodies) {
      if (!b.a) continue;
      ctx.beginPath();
      ctx.arc(hc[0], hc[1], b.a * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // asteroid belt
    for (const a of world.asteroids) {
      if (!a.alive) continue;
      const p = toScreen(a.pos);
      if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) continue;
      ctx.fillStyle = `ast:${a.index}` === s.target ? '#ffaa33' : 'rgba(200,180,160,0.7)';
      const r = Math.max(1, a.r * k);
      ctx.fillRect(p[0] - r / 2, p[1] - r / 2, r, r);
    }
    // black hole disk / zones
    const bh = world.byId.abyss;
    const bp = toScreen(bh.pos);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,80,80,0.7)';
    ctx.beginPath();
    ctx.arc(bp[0], bp[1], 3 * bh.rs * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,160,60,0.5)';
    ctx.beginPath();
    ctx.arc(bp[0], bp[1], 90 * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // pulsar beam
    const vela = world.byId.vela;
    const vp2 = toScreen(vela.pos);
    ctx.strokeStyle = 'rgba(140,180,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vp2[0] - vela.beam[0] * 700 * k, vp2[1] - vela.beam[2] * 700 * k);
    ctx.lineTo(vp2[0] + vela.beam[0] * 700 * k, vp2[1] + vela.beam[2] * 700 * k);
    ctx.stroke();

    // bodies
    for (const b of world.bodies) {
      const p = toScreen(b.pos);
      const r = Math.max(3, b.R * k);
      if (p[0] < -r - 100 || p[0] > W + r + 100 || p[1] < -r - 30 || p[1] > H + r + 30) continue;
      if (b.kind === 'blackhole') {
        const g = ctx.createRadialGradient(p[0], p[1], r, p[0], p[1], Math.max(r * 11, 6));
        g.addColorStop(0, 'rgba(255,180,90,0.9)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.max(r * 11, 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const c = b.color;
        ctx.fillStyle = `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fill();
        if (b.rings) {
          ctx.strokeStyle = 'rgba(230,210,170,0.7)';
          ctx.beginPath();
          ctx.ellipse(p[0], p[1], r * 2.2, r * 0.6, -0.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = b.id === s.target ? '#ffcc66' : '#99ccff';
      ctx.textAlign = 'left';
      ctx.fillText(b.name.toUpperCase(), p[0] + r + 4, p[1] - r - 2);
    }

    // predicted path (where we would coast with engines off)
    if (trajectory.length > 1) {
      ctx.strokeStyle = 'rgba(102,255,153,0.8)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      trajectory.forEach((q, i) => {
        const p = toScreen(q);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // autopilot course
    if (s.autopilot) {
      const t = targetInfo(world, s.autopilot.target);
      if (t) {
        const p = toScreen(t.pos);
        ctx.strokeStyle = 'rgba(255,204,102,0.6)';
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(W / 2, H / 2);
        ctx.lineTo(p[0], p[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // torpedoes
    ctx.fillStyle = '#ff6644';
    for (const t of world.torpedoes) {
      const p = toScreen(t.pos);
      ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
    }

    // target box
    const t = targetInfo(world, s.target);
    if (t) {
      const p = toScreen(t.pos);
      const r = Math.max(8, t.R * k + 5);
      ctx.strokeStyle = '#ffaa33';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p[0] - r, p[1] - r, r * 2, r * 2);
    }

    // ship
    drawShip(W / 2, H / 2, s.yaw, fs);

    // scale bar
    const barSu = scale / 2;
    ctx.strokeStyle = '#ff9900';
    ctx.fillStyle = '#ff9900';
    ctx.lineWidth = 2;
    const bx = 12, by = H - 14;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barSu * k, by);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText(`${(barSu / C).toFixed(barSu / C < 10 ? 1 : 0)} LIGHT-SECONDS`, bx, by - fs * 0.8);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(102,255,153,0.9)';
    ctx.fillText('- - COASTING PATH', W - 10, H - 14);
  }

  function drawShip(x, y, yaw, fs) {
    // map: +x right, +z down; heading vector (sin yaw, -cos yaw)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(yaw);
    const sz = fs * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff9900';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -sz);
    ctx.lineTo(sz * 0.65, sz * 0.7);
    ctx.lineTo(0, sz * 0.35);
    ctx.lineTo(-sz * 0.65, sz * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------- gravity well overlay ----------
  function phiAt(x, z, n) {
    let phi = 0;
    for (let i = 0; i < n; i++) {
      const dx = x - B[i * 3], dz = z - B[i * 3 + 1];
      phi += B[i * 3 + 2] / Math.sqrt(dx * dx + dz * dz + soft[i] * soft[i]);
    }
    return phi;
  }
  function project3(p) {
    const v = vec4.transformMat4(vec4.create(), [p[0], p[1], p[2], 1], vp);
    if (v[3] <= 0) return null;
    return [(v[0] / v[3] * 0.5 + 0.5) * overlay.width, (0.5 - (v[1] / v[3]) * 0.5) * overlay.height];
  }
  function drawWellOverlay(world, extent, phiRef, n) {
    const W = overlay.width, H = overlay.height;
    ctx.clearRect(0, 0, W, H);
    const s = world.ship;
    const fs = Math.max(10, Math.round(H / 34));
    ctx.font = `${fs}px Antonio, 'Arial Narrow', sans-serif`;
    ctx.textBaseline = 'middle';
    const height = (x, z) => {
      const hn = Math.max(phiAt(x, z, n) / phiRef - 1, 0);
      return (-extent * 0.8 * hn) / (hn + 2.5);
    };
    for (const b of world.bodies) {
      const x = b.pos[0] - s.pos[0], z = b.pos[2] - s.pos[2];
      if (Math.abs(x) > extent || Math.abs(z) > extent) continue;
      const p = project3([x, height(x, z), z]);
      if (!p) continue;
      const c = b.kind === 'blackhole' ? [1, 0.4, 0.3] : b.color;
      ctx.fillStyle = `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#99ccff';
      ctx.textAlign = 'center';
      ctx.fillText(b.name.toUpperCase(), p[0], p[1] - fs);
    }
    const sp = project3([0, height(0, 0), 0]);
    if (sp) {
      const f = forwardOf(s.yaw, 0);
      const tip = project3([f[0] * extent * 0.08, height(f[0] * extent * 0.08, f[2] * extent * 0.08), f[2] * extent * 0.08]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      if (tip) {
        ctx.beginPath();
        ctx.moveTo(sp[0], sp[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffcc66';
      ctx.textAlign = 'center';
      ctx.fillText('YOU ARE HERE', sp[0], sp[1] + fs);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff9900';
    ctx.fillText('GRAVITY WELLS: HEAVY OBJECTS DENT SPACE-TIME', 10, H - 14);
  }

  return {
    state,
    zoomIn() {
      state.zoom = Math.max(0, state.zoom - 1);
    },
    zoomOut() {
      state.zoom = Math.min(ZOOMS.length - 1, state.zoom + 1);
    },
    setMode(m) {
      state.mode = m;
    },
    render,
  };
}

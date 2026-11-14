// Warp core display: the glowing matter/antimatter reaction column.
import { getGL, program, fullscreenQuad, fitCanvas, FULLSCREEN_VS } from './gl.js';

const CORE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes;
uniform float uTime, uOutput, uTemp, uOnline, uPhase, uBreach;
void main() {
  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0);
  float x = abs(p.x);
  float y = p.y;
  // casing
  float tubeW = 0.16;
  vec3 col = vec3(0.0);
  float casing = smoothstep(tubeW + 0.09, tubeW + 0.08, x) * smoothstep(0.96, 0.95, abs(y));
  float ribs = step(0.5, fract(y * 9.0));
  col += casing * vec3(0.12, 0.12, 0.16) * (0.7 + 0.3 * ribs);
  // chamber in the middle
  float chamber = smoothstep(0.32, 0.3, length(vec2(p.x * 0.9, y * 1.6)));
  col = mix(col, vec3(0.1, 0.1, 0.14), chamber);
  // glowing column
  float inside = smoothstep(tubeW, tubeW - 0.02, x) * smoothstep(0.95, 0.93, abs(y));
  vec3 hot = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.35, 0.1), smoothstep(70.0, 100.0, uTemp));
  float pulseSpeed = 0.6 + 2.4 * uOutput;
  float pulse = pow(0.5 + 0.5 * sin((abs(y) * 14.0 + uPhase * pulseSpeed * 6.0)), 6.0);
  float base = 0.18 + 0.55 * uOutput;
  float I = inside * uOnline * (base + pulse * (0.5 + uOutput)) * (1.0 - 0.6 * x / tubeW);
  // center reaction
  float core = exp(-dot(vec2(p.x * 2.0, y * 2.8), vec2(p.x * 2.0, y * 2.8)) * 8.0) * uOnline * (0.6 + uOutput * 1.4);
  core *= 0.85 + 0.15 * sin(uTime * 23.0);
  col += hot * (I + core * 2.0);
  // halo
  col += hot * uOnline * exp(-x * 10.0) * 0.15 * (0.5 + uOutput) * step(abs(y), 0.95);
  // breach flicker
  col *= 1.0 + uBreach * (0.6 * sin(uTime * 30.0));
  col = 1.0 - exp(-col * 1.6);
  o = vec4(col, 1.0);
}`;

export function createCore(canvas) {
  const gl = getGL(canvas);
  const prog = program(gl, FULLSCREEN_VS, CORE_FS);
  const quad = fullscreenQuad(gl);
  let phase = 0;
  return {
    render(world, dt) {
      fitCanvas(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const r = world.ship.reactor;
      const on = r.online && !r.ejected ? 1 : 0;
      phase += dt;
      gl.useProgram(prog.p);
      gl.uniform2f(prog.u.uRes, canvas.width, canvas.height);
      gl.uniform1f(prog.u.uTime, world.t);
      gl.uniform1f(prog.u.uPhase, phase);
      gl.uniform1f(prog.u.uOutput, r.output);
      gl.uniform1f(prog.u.uTemp, r.temp);
      gl.uniform1f(prog.u.uOnline, on);
      gl.uniform1f(prog.u.uBreach, r.breach >= 0 ? 1 : 0);
      quad.draw();
    },
  };
}

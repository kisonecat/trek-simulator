# Starship Bridge Simulator

An LCARS-style starship bridge for young space cadets. Fly with impulse and warp
engines, run the warp core, raise shields, fire phasers, and explore a sector with
real-ish physics: orbits, gravity wells, a pulsar, a red giant, and a black hole
that bends light.

## Build

```sh
npm install
npm run build      # -> dist/index.html (one self-contained file, works offline)
npm run dev        # live-reload development server
```

Open `dist/index.html` in any modern browser (WebGL2 required).

## What is simulated

- **Gravity**: Newtonian gravity from every body; planets follow Kepler orbits.
  The black hole uses the Paczyński–Wiita potential, so orbits inside 3
  Schwarzschild radii are unstable, as in general relativity.
- **Light bending**: the viewscreen ray-traces photon paths around the black hole
  (Schwarzschild geodesics) with a Doppler-beamed accretion disk.
- **Time dilation**: shown live as you approach the black hole.
- **Standard orbit** turns the engines off; the ship then really orbits under gravity.
- **Tactical display**: gravity-potential contour map with predicted coasting path,
  or a 3D "rubber sheet" gravity-well view.

Source layout: `src/sim.js` (physics and ship systems), `src/viewscreen.js`
(main WebGL ray tracer), `src/tactical.js`, `src/core.js`, `src/audio.js`,
`src/main.js` (LCARS UI wiring).

// Starship simulation: celestial bodies, gravity, ship systems, weapons, missions.
// Distances are in "spatial units" (su). Light travels C su per second.

export const C = 70;
export const G_UNIT = 800 / 49; // surface gravity of Aurelia == 1 g
export const SOLAR_GM = 12000; // Helios == 1 solar mass
export const IMPULSE_MAX = 0.25 * C;

export function warpSpeed(w) {
  return 50 * Math.pow(w, 1.7);
}
// The classic Star Trek warp scale: speed = c * w^(10/3)
export function warpTimesLight(w) {
  return Math.pow(w, 10 / 3);
}

// ---------- tiny vector helpers (plain arrays) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vec = { sub, add, scale, dot, len, norm, cross };

export function forwardOf(yaw, pitch) {
  return [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
}
export function yawPitchOf(d) {
  const n = norm(d);
  return [Math.atan2(n[0], -n[2]), Math.asin(Math.max(-1, Math.min(1, n[1])))];
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the sector ----------
const BODY_DEFS = [
  {
    id: 'helios', name: 'Helios', kind: 'star', type: 0, R: 25, GM: SOLAR_GM,
    fixed: [0, 0, 0], soi: 1500, color: [1.0, 0.8, 0.5], spin: 0.03,
    blurb: 'A yellow star like our Sun. It is a giant ball of hot gas, squeezing hydrogen into helium deep inside. That makes the light and heat that warm its planets.',
  },
  {
    id: 'aurelia', name: 'Aurelia', kind: 'planet', type: 1, R: 7, GM: 800,
    a: 150, phase: 0.6, color: [0.35, 0.55, 0.95], spin: 0.12,
    blurb: 'A blue world with oceans, clouds and green continents, like Earth. It is in the "Goldilocks zone": not too hot, not too cold, so water can stay liquid.',
  },
  {
    id: 'ares', name: 'Ares Prime', kind: 'planet', type: 2, R: 5.5, GM: 450,
    a: 240, phase: 2.4, color: [0.85, 0.45, 0.3], spin: 0.1,
    blurb: 'A cold, dusty red desert planet, like Mars. Its color comes from rust (iron oxide) in the soil!',
  },
  {
    id: 'titanus', name: 'Titanus', kind: 'planet', type: 3, R: 22, GM: 4000,
    a: 480, phase: 4.1, color: [0.9, 0.75, 0.55], spin: 0.25, rings: true,
    blurb: 'A gas giant like Saturn. It has no solid ground at all, just thicker and thicker gas. Its rings are made of billions of chunks of ice and rock, all orbiting the planet.',
  },
  {
    id: 'antares', name: 'Antares Major', kind: 'star', type: 0, R: 110, GM: 30000,
    fixed: [-1500, 60, -3400], soi: 1300, color: [1.0, 0.4, 0.2], spin: 0.01,
    blurb: 'A red giant: an old star that has puffed up to enormous size. It is cooler than Helios (that is why it looks red), but so big it gives off far more light.',
  },
  {
    id: 'vela', name: 'Vela Pulsar', kind: 'pulsar', type: 4, R: 3, GM: 16000,
    fixed: [-2600, -30, 1500], soi: 900, color: [0.7, 0.85, 1.0], spin: 0,
    blurb: 'A neutron star: what is left after a giant star explodes as a supernova. It is only about as wide as a city, but heavier than our Sun! It spins fast and sweeps beams of radiation around like a lighthouse.',
  },
  {
    id: 'abyss', name: 'Cygnus Abyss', kind: 'blackhole', type: 5, GM: 40000,
    fixed: [2800, -40, -1600], soi: 1200,
    blurb: 'A black hole: so much mass squeezed into so little space that nothing, not even light, can escape once it crosses the event horizon. Its gravity bends light, so stars behind it look stretched into rings. The glowing disk is gas swirling around it, heated to millions of degrees.',
  },
];

const ASTEROID_COUNT = 150;
const SECTOR_EDGE = 7000;
const leavingSector = (p, f) => len(p) > SECTOR_EDGE && dot(p, f) > 0;
const BELT_IN = 330;
const BELT_OUT = 395;

export const MISSIONS = [
  { id: 'shields', text: 'Raise the shields.' },
  { id: 'impulse', text: 'Fly with the impulse engines (go faster than a quarter of full impulse).' },
  { id: 'orbit', text: 'Enter standard orbit around the planet Aurelia.' },
  { id: 'asteroid', text: 'Break up an asteroid in the asteroid belt with phasers or a torpedo.' },
  { id: 'warp', text: 'Travel at warp factor 5 or faster.' },
  { id: 'titanus', text: 'Orbit the ringed gas giant Titanus.' },
  { id: 'antares', text: 'Visit the red giant star Antares Major.' },
  { id: 'pulsar', text: 'Visit the Vela Pulsar (watch out for its radiation beams!).' },
  { id: 'dilation', text: 'Fly close enough to the black hole that your clock runs 10% slow.' },
  { id: 'core', text: 'Engineering drill: overheat the warp core, then save the ship!' },
];

export function createWorld() {
  const rng = mulberry32(1701);
  const bodies = BODY_DEFS.map((d) => {
    const b = { ...d, pos: [0, 0, 0], vel: [0, 0, 0] };
    if (b.kind === 'blackhole') {
      b.rs = (2 * b.GM) / (C * C);
      b.R = b.rs;
      b.diskN = norm([0.18, 1, 0.28]);
    }
    if (b.kind === 'pulsar') {
      b.spinAxis = norm([0.25, 1, -0.1]);
      b.beamTilt = 1.05; // radians between spin axis and beam
      b.period = 1.6; // seconds per rotation (slowed down so we can see it)
      b.beam = [0, 1, 0];
    }
    if (b.a) {
      b.omega = Math.sqrt(SOLAR_GM / (b.a * b.a * b.a));
      b.hill = b.a * Math.cbrt(b.GM / (3 * SOLAR_GM));
    }
    return b;
  });
  const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));

  const asteroids = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const a = BELT_IN + (BELT_OUT - BELT_IN) * rng();
    const r = 0.7 + Math.pow(rng(), 2.5) * 3.2;
    asteroids.push({
      index: i,
      a,
      th0: rng() * Math.PI * 2,
      y: (rng() - 0.5) * 12,
      omega: Math.sqrt(SOLAR_GM / (a * a * a)),
      r,
      maxHp: 15 + r * 25,
      hp: 15 + r * 25,
      alive: true,
      respawn: 0,
      shade: 0.6 + rng() * 0.4,
      pos: [0, 0, 0],
    });
  }

  const world = {
    t: 0,
    bodies,
    byId,
    asteroids,
    torpedoes: [],
    particles: [],
    explosions: [],
    events: [],
    fx: { shieldHit: 0, hullHit: 0, warpFlash: 0, phaser: null, radiation: 0 },
    missions: Object.fromEntries(MISSIONS.map((m) => [m.id, false])),
    gameOver: null,
    warnTimes: {},
    ship: null,
    stats: {},
  };
  world.updateBodies = (t) => updateBodies(world, t);
  world.updateBodies(0);

  // Start the ship parked near Aurelia, on the sunlit side, looking at the planet.
  const au = byId.aurelia;
  const out = norm(au.pos);
  const tangent = norm(au.vel);
  const start = add(au.pos, scale(norm(add(add(scale(out, -0.55), tangent), [0, 0.15, 0])), 26));
  const [yaw, pitch] = yawPitchOf(sub(au.pos, start));
  world.ship = {
    pos: start,
    vel: [...au.vel],
    yaw,
    pitch,
    throttle: 0,
    assist: true,
    orbiting: null,
    orbitTime: 0,
    turn: { yaw: 0, pitch: 0 },
    warp: { factor: 5, engaged: false, level: 0 },
    shields: { up: false, strength: 100 },
    hull: 100,
    lastDamage: -100,
    reactor: { online: true, output: 0.75, intermix: 1.0, temp: 50, ejected: false, breach: -1, installTimer: 0, hadBreachAlarm: false },
    power: { engines: 34, shields: 33, weapons: 33 },
    phaser: 100,
    torpedoes: 10,
    target: 'aurelia',
    autopilot: null,
    alert: 'green',
    view: 'forward',
    zoom: 1,
  };
  updateStats(world);
  return world;
}

function updateBodies(world, t) {
  for (const b of world.bodies) {
    if (b.fixed) {
      b.pos = b.fixed;
      b.vel = [0, 0, 0];
    } else {
      const th = b.phase + b.omega * t;
      b.pos = [b.a * Math.cos(th), 0, b.a * Math.sin(th)];
      b.vel = [-b.a * b.omega * Math.sin(th), 0, b.a * b.omega * Math.cos(th)];
    }
    if (b.kind === 'pulsar') {
      // beam direction sweeps around the spin axis
      const ax = b.spinAxis;
      const e1 = norm(cross(ax, [1, 0, 0]));
      const e2 = cross(ax, e1);
      const ph = (t / b.period) * Math.PI * 2;
      const s = Math.sin(b.beamTilt);
      b.beam = norm(add(scale(ax, Math.cos(b.beamTilt)), add(scale(e1, s * Math.cos(ph)), scale(e2, s * Math.sin(ph)))));
    }
  }
  for (const a of world.asteroids) {
    const th = a.th0 + a.omega * t;
    a.pos = [a.a * Math.cos(th), a.y, a.a * Math.sin(th)];
  }
}

export function asteroidVel(a) {
  return [-a.pos[2] * a.omega, 0, a.pos[0] * a.omega];
}

// ---------- gravity ----------
function gravityFrom(b, p) {
  const d = sub(b.pos, p);
  const r = len(d);
  let soft = b.kind === 'blackhole' ? 0 : b.R * 0.5;
  let g;
  if (b.kind === 'blackhole') {
    // Paczynski-Wiita potential: mimics general relativity (unstable orbits inside 3 rs)
    const rr = Math.max(r - b.rs, b.rs * 0.05);
    g = b.GM / (rr * rr);
  } else {
    const rr = Math.max(r, soft);
    g = b.GM / (rr * rr);
  }
  if (b.soi) {
    // patched-conic style: far stars only pull inside their sphere of influence
    const f = Math.min(1, Math.max(0, (1.3 * b.soi - r) / (0.3 * b.soi)));
    g *= f;
  }
  return scale(d, g / (r || 1));
}

export function referenceBody(world, p) {
  for (const b of world.bodies) {
    if (b.kind === 'planet' && len(sub(p, b.pos)) < b.hill) return b;
  }
  return null;
}

// Gravitational acceleration on the ship. When near a planet, we treat the planet's
// frame consistently (planets move on fixed orbits around Helios).
export function shipGravity(world, p) {
  let a = [0, 0, 0];
  for (const b of world.bodies) a = add(a, gravityFrom(b, p));
  const ref = referenceBody(world, p);
  if (ref) {
    for (const b of world.bodies) {
      if (b === ref || b.id === 'helios') continue;
      a = sub(a, gravityFrom(b, ref.pos));
    }
  }
  return a;
}

// ---------- power and limits ----------
export function powerFactors(ship) {
  const r = ship.reactor;
  const avail = r.online ? 0.3 + 0.7 * r.output : 0.35;
  const f = (p) => avail * (0.4 + 1.8 * (p / 100));
  return { avail, engines: f(ship.power.engines), shields: f(ship.power.shields), weapons: f(ship.power.weapons) };
}
export function maxWarp(ship) {
  if (!ship.reactor.online) return 0;
  return Math.max(0, Math.min(9, Math.floor(powerFactors(ship).engines * 9 + 0.05)));
}

export function setPower(ship, key, value) {
  value = Math.max(0, Math.min(100, value));
  const others = Object.keys(ship.power).filter((k) => k !== key);
  const rest = 100 - value;
  const otherSum = others.reduce((s, k) => s + ship.power[k], 0);
  ship.power[key] = value;
  for (const k of others) ship.power[k] = otherSum > 0 ? (ship.power[k] / otherSum) * rest : rest / others.length;
}

// ---------- events ----------
function log(world, text, level = 'info', speak = false) {
  world.events.push({ type: 'log', text, level, speak });
}
function sfx(world, name) {
  world.events.push({ type: 'sfx', name });
}
function warnOnce(world, key, text, every = 8, level = 'warn', speak = true) {
  const last = world.warnTimes[key] ?? -1e9;
  if (world.t - last > every) {
    world.warnTimes[key] = world.t;
    log(world, text, level, speak);
    sfx(world, 'warning');
  }
}
function completeMission(world, id) {
  if (world.missions[id]) return;
  world.missions[id] = true;
  const m = MISSIONS.find((x) => x.id === id);
  log(world, `Mission complete: ${m.text}`, 'good', false);
  sfx(world, 'chime');
  world.events.push({ type: 'mission', id });
}

// ---------- targets ----------
export function targetInfo(world, id) {
  if (!id) return null;
  if (id.startsWith('ast:')) {
    const a = world.asteroids[+id.slice(4)];
    if (!a || !a.alive) return null;
    return { id, name: `Asteroid ${1000 + a.index}`, kind: 'asteroid', pos: a.pos, vel: asteroidVel(a), R: a.r, asteroid: a };
  }
  if (id === 'core') {
    const c = world.ejectedCore;
    return c ? { id, name: 'Ejected warp core', kind: 'core', pos: c.pos, vel: c.vel, R: 1 } : null;
  }
  const b = world.byId[id];
  return b ? { id, name: b.name, kind: b.kind, pos: b.pos, vel: b.vel, R: b.R, body: b } : null;
}

export function arriveDistance(t) {
  if (!t) return 30;
  if (t.kind === 'planet') return t.body.rings ? t.R * 3 : Math.min(t.R * 4, t.body.hill * 0.6);
  if (t.kind === 'star') return t.R * 3;
  if (t.kind === 'pulsar') return 120;
  if (t.kind === 'blackhole') return t.body.rs * 9;
  return 25;
}

export function nearestAsteroid(world, maxDist = Infinity) {
  let best = null;
  let bd = maxDist;
  for (const a of world.asteroids) {
    if (!a.alive) continue;
    const d = len(sub(a.pos, world.ship.pos));
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

// ---------- commands (called from the UI) ----------
export const commands = {
  setThrottle(world, v) {
    const s = world.ship;
    s.throttle = v;
    s.autopilot = null;
    if (s.warp.engaged) commands.dropOut(world);
    if (s.orbiting && v > 0) leaveOrbit(world);
    sfx(world, 'beep');
  },
  toggleAssist(world) {
    const s = world.ship;
    s.assist = !s.assist;
    if (s.assist) leaveOrbit(world, true);
    log(world, s.assist
      ? 'Helm assist ON: the computer fires thrusters to hold your speed, even against gravity.'
      : 'Helm assist OFF: Newtonian flight! The ship now coasts and falls just like a real spacecraft.');
    sfx(world, 'beep');
  },
  engageWarp(world, factor) {
    const s = world.ship;
    if (factor) s.warp.factor = factor;
    if (s.warp.engaged) return;
    const mw = maxWarp(s);
    if (s.reactor.ejected) {
      log(world, 'Unable to engage: there is no warp core! Install the spare core in Engineering.', 'warn', true);
      sfx(world, 'deny');
      return false;
    }
    if (mw === 0) {
      log(world, 'Unable to engage: warp core is offline.', 'warn', true);
      sfx(world, 'deny');
      return false;
    }
    const bh = world.byId.abyss;
    if (len(sub(s.pos, bh.pos)) < bh.rs * 3) {
      log(world, 'Unable to form a warp field: space-time is too curved this close to the black hole!', 'alert', true);
      sfx(world, 'deny');
      return false;
    }
    const ahead = warpProximity(world, s.pos, forwardOf(s.yaw, s.pitch), 150);
    if (leavingSector(s.pos, forwardOf(s.yaw, s.pitch))) {
      log(world, 'We are at the edge of the charted sector. Turn back, or set a course in NAVIGATION.', 'warn', true);
      sfx(world, 'deny');
      return false;
    }
    if (ahead) {
      log(world, `Can't engage warp: ${ahead.name} is dead ahead and too close! Turn the ship or back away first.`, 'warn', true);
      sfx(world, 'deny');
      return false;
    }
    if (s.warp.factor > mw) {
      log(world, `Warp ${s.warp.factor} needs more power. Maximum warp right now is ${mw}. Raise reactor output or send more power to the engines.`, 'warn', true);
      s.warp.factor = mw;
    }
    s.warp.engaged = true;
    s.warp.level = 0;
    leaveOrbit(world, true);
    world.fx.warpFlash = 1;
    sfx(world, 'warp');
    log(world, `Warp ${s.warp.factor}: about ${Math.round(warpTimesLight(s.warp.factor))} times the speed of light. Engage!`, 'info', false);
    if (s.warp.factor >= 5) completeMission(world, 'warp');
    return true;
  },
  dropOut(world, reason) {
    const s = world.ship;
    if (!s.warp.engaged) return;
    s.warp.engaged = false;
    s.warp.level = 0;
    const ref = referenceBody(world, s.pos);
    s.vel = ref ? [...ref.vel] : [0, 0, 0];
    s.throttle = 0;
    world.fx.warpFlash = 0.8;
    sfx(world, 'warpout');
    log(world, reason || 'Dropping out of warp.', reason ? 'warn' : 'info', !!reason);
  },
  toggleWarp(world) {
    const s = world.ship;
    s.autopilot = null;
    if (s.warp.engaged) commands.dropOut(world);
    else commands.engageWarp(world);
  },
  fullStop(world) {
    const s = world.ship;
    s.autopilot = null;
    if (s.warp.engaged) commands.dropOut(world);
    s.throttle = 0;
    s.assist = true;
    leaveOrbit(world, true);
    log(world, 'All stop.');
    sfx(world, 'beep');
  },
  standardOrbit(world) {
    const s = world.ship;
    let best = null;
    let bd = Infinity;
    for (const b of world.bodies) {
      if (b.kind !== 'planet') continue;
      const d = len(sub(s.pos, b.pos));
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    const minR = best.rings ? best.R * 2.7 : best.R * 2.2;
    const maxR = Math.min(best.R * 6, best.hill * 0.45);
    if (bd > Math.max(maxR * 1.6, best.R * 9)) {
      log(world, `Too far from any planet for orbit. The nearest is ${best.name}. Use NAV to fly there first.`, 'warn', true);
      sfx(world, 'deny');
      return;
    }
    if (s.warp.engaged) commands.dropOut(world);
    s.autopilot = null;
    const rOrb = Math.max(minR, Math.min(maxR, bd));
    const radial = norm(sub(s.pos, best.pos));
    let tang = sub(forwardOf(s.yaw, s.pitch), scale(radial, dot(forwardOf(s.yaw, s.pitch), radial)));
    if (len(tang) < 0.1) tang = cross([0, 1, 0], radial);
    tang = norm(tang);
    // flatten toward the planet's equator a bit for a nicer view of rings
    s.pos = add(best.pos, scale(radial, rOrb));
    const v = Math.sqrt(best.GM / rOrb);
    s.vel = add(best.vel, scale(tang, v));
    s.assist = false;
    s.throttle = 0;
    s.orbiting = best.id;
    s.orbitTime = 0;
    s.target = best.id;
    s.view = 'target';
    const period = (2 * Math.PI * rOrb) / v;
    log(world, `Standard orbit around ${best.name}. Engines are off: the ship is falling around the planet, always missing it! One orbit takes ${period.toFixed(0)} seconds.`, 'good', true);
    sfx(world, 'beep');
  },
  setCourse(world, id, engage = true) {
    const s = world.ship;
    const t = targetInfo(world, id);
    if (!t) return;
    s.target = id;
    if (s.warp.engaged) commands.dropOut(world);
    leaveOrbit(world, true);
    s.assist = true;
    s.autopilot = { target: id, phase: 'align', engage };
    log(world, engage ? `Course laid in for ${t.name}. Engaging autopilot.` : `Turning to face ${t.name}.`);
    sfx(world, 'beep');
  },
  toggleShields(world) {
    const sh = world.ship.shields;
    sh.up = !sh.up;
    log(world, sh.up ? 'Shields up!' : 'Shields lowered.', 'info', true);
    sfx(world, sh.up ? 'shieldsUp' : 'shieldsDown');
    if (sh.up) completeMission(world, 'shields');
  },
  setAlert(world, level) {
    const s = world.ship;
    s.alert = level;
    if (level === 'red') {
      if (!s.shields.up) commands.toggleShields(world);
      log(world, 'Red alert! All hands to battle stations.', 'alert', true);
    } else if (level === 'yellow') {
      log(world, 'Yellow alert.', 'warn', true);
    } else {
      log(world, 'Condition green. Standing down.', 'info', false);
    }
    world.events.push({ type: 'alert', level });
  },
  firePhasers(world) {
    const s = world.ship;
    const t = targetInfo(world, s.target);
    if (!t) {
      log(world, 'No target selected. Try TARGET NEAREST ASTEROID.', 'warn');
      sfx(world, 'deny');
      return;
    }
    if (t.kind !== 'asteroid' && t.kind !== 'core') {
      log(world, `Phasers can't do anything to ${t.name}! It is far too big. Target an asteroid instead.`, 'warn', true);
      sfx(world, 'deny');
      return;
    }
    if (s.warp.engaged) {
      log(world, 'Cannot fire phasers at warp.', 'warn');
      sfx(world, 'deny');
      return;
    }
    const d = len(sub(t.pos, s.pos));
    if (d > 300) {
      log(world, `Target out of phaser range (${(d / C).toFixed(1)} light-seconds). Get within ${(300 / C).toFixed(1)}.`, 'warn');
      sfx(world, 'deny');
      return;
    }
    if (s.phaser < 20) {
      log(world, 'Phaser banks recharging...', 'warn');
      sfx(world, 'deny');
      return;
    }
    s.phaser -= 20;
    world.fx.phaser = { target: t.id, time: 0.9, total: 0.9 };
    sfx(world, 'phaser');
  },
  fireTorpedo(world) {
    const s = world.ship;
    if (s.warp.engaged) {
      log(world, 'Cannot fire torpedoes at warp.', 'warn');
      sfx(world, 'deny');
      return;
    }
    if (s.torpedoes <= 0) {
      log(world, 'Torpedo bay empty. Reloading from storage...', 'warn');
      sfx(world, 'deny');
      return;
    }
    s.torpedoes--;
    const f = forwardOf(s.yaw, s.pitch);
    const t = targetInfo(world, s.target);
    world.torpedoes.push({
      pos: add(s.pos, scale(f, 1.5)),
      vel: add(s.vel, scale(f, 60)),
      target: t && (t.kind === 'asteroid' || t.kind === 'core') ? t.id : null,
      life: 10,
    });
    sfx(world, 'torpedo');
  },
  targetNearestAsteroid(world) {
    const a = nearestAsteroid(world);
    if (a) {
      world.ship.target = 'ast:' + a.index;
      const d = len(sub(a.pos, world.ship.pos));
      log(world, `Targeting asteroid ${1000 + a.index}, ${(d / C).toFixed(1)} light-seconds away.`);
      sfx(world, 'beep');
    }
  },
  setReactorOnline(world, on) {
    const r = world.ship.reactor;
    if (r.ejected) {
      log(world, 'There is no warp core to bring online!', 'warn', true);
      sfx(world, 'deny');
      return;
    }
    r.online = on;
    if (!on && world.ship.warp.engaged) commands.dropOut(world, 'Warp core offline: dropping out of warp.');
    log(world, on ? 'Warp core online. Matter and antimatter are meeting in the reaction chamber.' : 'Warp core shut down. Running on auxiliary power.', 'info', true);
    sfx(world, on ? 'powerUp' : 'powerDown');
  },
  ejectCore(world) {
    const s = world.ship;
    const r = s.reactor;
    if (r.ejected) return;
    if (s.warp.engaged) commands.dropOut(world);
    const wasBreaching = r.breach >= 0;
    r.ejected = true;
    r.online = false;
    r.breach = -1;
    const back = scale(forwardOf(s.yaw, s.pitch), -1);
    world.ejectedCore = { pos: add(s.pos, scale(back, 2)), vel: add(s.vel, scale(back, 14)), timer: 6 };
    log(world, 'Warp core ejected!', 'alert', true);
    sfx(world, 'eject');
    if (wasBreaching) completeMission(world, 'core');
  },
  installCore(world) {
    const r = world.ship.reactor;
    if (!r.ejected || r.installTimer > 0) return;
    r.installTimer = 15;
    log(world, 'Engineering crew installing the spare warp core. Estimated time: 15 seconds.', 'info', true);
    sfx(world, 'beep');
  },
};

function leaveOrbit(world, silent) {
  const s = world.ship;
  if (!s.orbiting) return;
  if (!silent) log(world, `Leaving orbit of ${world.byId[s.orbiting].name}.`);
  s.orbiting = null;
}

// ---------- damage ----------
function damage(world, amount, cause) {
  const s = world.ship;
  if (world.gameOver) return;
  s.lastDamage = world.t;
  if (s.shields.up && s.shields.strength > 0) {
    s.shields.strength -= amount;
    world.fx.shieldHit = Math.min(1, world.fx.shieldHit + Math.max(0.25, amount * 0.05));
    if (s.shields.strength < 0) {
      s.hull += s.shields.strength;
      s.shields.strength = 0;
      log(world, 'Shields have collapsed!', 'alert', true);
    }
  } else {
    s.hull -= amount;
    world.fx.hullHit = Math.min(1, world.fx.hullHit + Math.max(0.3, amount * 0.05));
  }
  if (amount > 3) sfx(world, 'hit');
  if (s.hull <= 0) {
    s.hull = 0;
    endProgram(world, 'The ship was destroyed', cause);
  }
}

function endProgram(world, title, text) {
  if (world.gameOver) return;
  world.gameOver = { title, text };
  sfx(world, 'explosion');
  world.events.push({ type: 'gameover' });
}

function explode(world, pos, size, vel = [0, 0, 0], color = [1, 0.6, 0.25]) {
  world.explosions.push({ pos: [...pos], vel: [...vel], t: 0, life: 1.2 + size * 0.1, size, color });
  const n = Math.min(40, 8 + size * 6);
  for (let i = 0; i < n; i++) {
    const d = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    const sp = (2 + Math.random() * 6) * Math.sqrt(size);
    world.particles.push({
      pos: [...pos],
      vel: add(vel, scale(d, sp)),
      life: 1 + Math.random() * 2.5,
      t: 0,
      size: 0.15 + Math.random() * 0.35 * size,
      color: Math.random() < 0.5 ? [1, 0.7, 0.3] : [0.75, 0.65, 0.55],
    });
  }
}

function destroyAsteroid(world, a, by) {
  if (!a.alive) return;
  a.alive = false;
  a.respawn = 90;
  explode(world, a.pos, a.r, asteroidVel(a));
  sfx(world, 'explosion');
  if (by) {
    log(world, `Asteroid ${1000 + a.index} broken into rubble!`, 'good');
    completeMission(world, 'asteroid');
  }
  if (world.ship.target === 'ast:' + a.index) world.ship.target = null;
}

// ---------- the main step ----------
function rotateToward(s, dir, maxRate, dt) {
  const [ty, tp] = yawPitchOf(dir);
  let dy = ty - s.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const dp = tp - s.pitch;
  const m = maxRate * dt;
  const mag = Math.hypot(dy, dp);
  const k = mag > m ? m / mag : 1;
  s.yaw += dy * k;
  s.pitch += dp * k;
  return mag;
}

// How close the autopilot is willing to pass each kind of body.
function clearance(b) {
  if (b.kind === 'star') return b.R * 3;
  if (b.kind === 'planet') return b.R * 5;
  if (b.kind === 'pulsar') return 80;
  return b.rs * 8;
}

// If the straight path from p to goal passes too close to a body, return a
// waypoint that steers around it (the nearest such body along the path).
function routeAround(world, p, goal, excludeId) {
  const seg = sub(goal, p);
  const L = len(seg);
  if (L < 1) return null;
  const dir = scale(seg, 1 / L);
  let best = null;
  let bestS = Infinity;
  for (const b of world.bodies) {
    if (b.id === excludeId) continue;
    const rel = sub(b.pos, p);
    const sAlong = dot(rel, dir);
    const c = clearance(b);
    if (sAlong < 0 || sAlong > L - c * 0.5) continue;
    const perpVec = sub(rel, scale(dir, sAlong));
    const perp = len(perpVec);
    if (perp < c && sAlong < bestS) {
      let away = perp > 1e-3 ? scale(perpVec, -1 / perp) : norm(cross(dir, [0, 1, 0]));
      best = add(b.pos, scale(away, c * 1.6));
      bestS = sAlong;
    }
  }
  return best;
}

function autopilotStep(world, dt) {
  const s = world.ship;
  const ap = s.autopilot;
  const t = targetInfo(world, ap.target);
  if (!t) {
    s.autopilot = null;
    return;
  }
  if (ap.engage && ap.phase === 'align' && !ap.waypoint) {
    ap.waypoint = routeAround(world, s.pos, t.pos, t.id);
    if (ap.waypoint) log(world, 'Plotting a course around an obstacle.');
  }
  const goal = ap.waypoint || t.pos;
  const arrive = ap.waypoint ? 0 : arriveDistance(t);
  ap.goal = goal;
  ap.arrive = arrive;
  const toT = sub(goal, s.pos);
  const dist = len(toT);
  const ang = rotateToward(s, toT, s.warp.engaged ? 0.5 : 1.1, dt);
  if (!ap.engage) {
    if (ang < 0.01) {
      s.autopilot = null;
      log(world, `Now facing ${t.name}.`);
    }
    return;
  }
  const reachedWaypoint = () => {
    ap.waypoint = null;
    ap.phase = 'align';
  };
  if (ap.phase === 'align') {
    s.throttle = 0;
    if (ang < 0.03) {
      if (dist - arrive > 250 && maxWarp(s) > 0 && !s.reactor.ejected) {
        const want = s.warp.factor || 5;
        if (commands.engageWarp(world, Math.min(want, maxWarp(s)))) ap.phase = 'warp';
        else ap.phase = 'impulse';
      } else ap.phase = 'impulse';
    }
  } else if (ap.phase === 'warp') {
    if (!s.warp.engaged) {
      ap.phase = 'impulse';
    } else if (dist - arrive < 12) {
      commands.dropOut(world);
      if (ap.waypoint) reachedWaypoint();
      else ap.phase = 'impulse';
    }
  } else if (ap.phase === 'impulse') {
    const ref = referenceBody(world, s.pos);
    s.assist = true;
    s.throttle = Math.max(0, Math.min(1, (dist - arrive) / 80));
    if (ang > 0.5) s.throttle = 0; // turn first, then go
    if (ap.waypoint) {
      if (dist < 8) reachedWaypoint();
      return;
    }
    // keep pace with a moving target
    const relSpeed = len(sub(s.vel, ref ? ref.vel : [0, 0, 0]));
    if (dist < arrive + 3 && relSpeed < 4) {
      s.throttle = 0;
      s.autopilot = null;
      if (t.kind === 'planet') {
        log(world, `Arrived at ${t.name}.`, 'good');
        commands.standardOrbit(world);
      } else {
        log(world, `Arrived at ${t.name}. Holding position.`, 'good', true);
      }
    }
  }
}

// Is there a body on a collision course within `lookahead` along direction f?
function warpProximity(world, p, f, lookahead = 60) {
  for (const b of world.bodies) {
    const danger = b.kind === 'star' ? b.R * 2 : b.kind === 'planet' ? b.R * 2 : b.kind === 'pulsar' ? 35 : b.rs * 4;
    const rel = sub(b.pos, p);
    const sAlong = dot(rel, f);
    if (sAlong <= 0 || sAlong > lookahead + danger) continue;
    if (len(sub(rel, scale(f, sAlong))) < danger) return b;
  }
  return null;
}

export function step(world, dt) {
  if (world.gameOver) return;
  const s = world.ship;
  world.t += dt;
  world.updateBodies(world.t);
  const pf = powerFactors(s);

  // ----- reactor -----
  const r = s.reactor;
  if (r.ejected) {
    r.temp += (15 - r.temp) * 0.5 * dt;
    if (r.installTimer > 0) {
      r.installTimer -= dt;
      if (r.installTimer <= 0) {
        r.installTimer = 0;
        r.ejected = false;
        r.online = false;
        r.intermix = 1;
        r.output = 0.6;
        log(world, 'Spare warp core installed. Bring it online in Engineering.', 'good', true);
        sfx(world, 'chime');
      }
    }
  } else {
    const eq = r.online ? 25 + r.output * 55 + Math.abs(r.intermix - 1) * r.output * 170 : 20;
    r.temp += (eq - r.temp) * 0.09 * dt;
    if (r.temp > 100 && r.breach < 0) {
      r.breach = 20;
      r.hadBreachAlarm = true;
      log(world, 'Warning! Warp core breach in 20 seconds! Fix the matter/antimatter mix, shut down the core, or eject it!', 'alert', true);
      sfx(world, 'klaxon');
      if (s.alert !== 'red') commands.setAlert(world, 'red');
    }
    if (r.breach >= 0) {
      r.breach -= dt;
      const sec = Math.ceil(r.breach);
      if (sec <= 10 && sec !== world._lastBreachSec) {
        world._lastBreachSec = sec;
        log(world, `Core breach in ${sec}...`, 'alert', sec % 5 === 0 || sec <= 3);
      }
      if (r.temp < 96) {
        r.breach = -1;
        log(world, 'Warp core stabilized. Nice work, engineer!', 'good', true);
        completeMission(world, 'core');
      } else if (r.breach <= 0) {
        endProgram(world, 'Warp core breach', 'The matter and antimatter got out of balance and the warp core overloaded. Next time, watch the core temperature and balance the intermix ratio — or eject the core!');
        return;
      }
    }
  }

  // ----- systems recharge -----
  s.shields.strength = Math.min(100, s.shields.strength + 5 * pf.shields * dt);
  s.phaser = Math.min(100, s.phaser + 14 * pf.weapons * dt);
  if (s.torpedoes < 10) {
    world._torpReload = (world._torpReload || 0) + dt;
    if (world._torpReload > 12) {
      world._torpReload = 0;
      s.torpedoes++;
    }
  }
  if (world.t - s.lastDamage > 8 && s.hull < 100) s.hull = Math.min(100, s.hull + 0.4 * dt);

  // ----- helm -----
  if (s.autopilot) autopilotStep(world, dt);
  const turnRate = s.warp.engaged ? 0.35 : 0.9;
  if (s.turn.yaw || s.turn.pitch) {
    s.autopilot = null;
    s.yaw += s.turn.yaw * turnRate * dt;
    s.pitch += s.turn.pitch * turnRate * dt;
  }
  s.pitch = Math.max(-1.45, Math.min(1.45, s.pitch));
  s.yaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
  const f = forwardOf(s.yaw, s.pitch);

  if (s.warp.engaged) {
    s.warp.level = Math.min(1, s.warp.level + dt * 1.2);
    let speed = warpSpeed(s.warp.factor) * (0.05 + 0.95 * s.warp.level * s.warp.level);
    if (s.autopilot && s.autopilot.phase === 'warp') {
      const ap = s.autopilot;
      if (ap.goal) speed = Math.min(speed, Math.max(30, (len(sub(ap.goal, s.pos)) - ap.arrive) * 2.5));
    }
    world.stats.warpSpeed = speed;
    const n = Math.ceil((speed * dt) / 4);
    const h = dt / n;
    s.vel = scale(f, speed);
    for (let i = 0; i < n; i++) {
      s.pos = add(s.pos, scale(f, speed * h));
      const near = warpProximity(world, s.pos, f, speed * 0.05);
      if (near) {
        commands.dropOut(world, `Proximity alert! Dropped out of warp near ${near.name}.`);
        break;
      }
      if (leavingSector(s.pos, f)) {
        commands.dropOut(world, 'Reached the edge of the charted sector. Dropping out of warp.');
        break;
      }
    }
  } else {
    const g = shipGravity(world, s.pos);
    const maxAccel = 10 * Math.max(pf.engines, 0.3);
    let thrust;
    if (s.assist) {
      const ref = referenceBody(world, s.pos);
      const desired = add(ref ? ref.vel : [0, 0, 0], scale(f, s.throttle * IMPULSE_MAX));
      thrust = sub(scale(sub(desired, s.vel), 1.5), g);
      const tl = len(thrust);
      if (tl > maxAccel) thrust = scale(thrust, maxAccel / tl);
      world.stats.overpowered = tl > maxAccel * 1.02 && len(g) > maxAccel * 0.9;
    } else {
      thrust = scale(f, s.throttle * maxAccel);
      world.stats.overpowered = false;
    }
    world.stats.thrust = len(thrust);
    // semi-implicit Euler (stable for orbits at this step size)
    s.vel = add(s.vel, scale(add(g, thrust), dt));
    s.pos = add(s.pos, scale(s.vel, dt));
  }

  // ----- ejected core -----
  if (world.ejectedCore) {
    const c = world.ejectedCore;
    c.pos = add(c.pos, scale(c.vel, dt));
    c.timer -= dt;
    if (c.timer <= 0) {
      explode(world, c.pos, 14, c.vel, [0.6, 0.8, 1.0]);
      world.fx.warpFlash = Math.max(world.fx.warpFlash, 0.6);
      sfx(world, 'bigExplosion');
      const d = len(sub(c.pos, s.pos));
      if (d < 60) damage(world, (60 - d) * 1.2, 'You were too close when the ejected warp core exploded.');
      log(world, 'The ejected warp core has detonated safely away from the ship.', 'info');
      world.ejectedCore = null;
    }
  }

  hazards(world, dt);
  weapons(world, dt, pf);
  particles(world, dt);
  missions(world, dt);
  updateStats(world);
}

function hazards(world, dt) {
  const s = world.ship;
  world.fx.radiation = Math.max(0, world.fx.radiation - dt * 2);
  for (const b of world.bodies) {
    const d = sub(s.pos, b.pos);
    const r = len(d);
    if (b.kind === 'star') {
      if (r < b.R) {
        endProgram(world, `Flew into ${b.name}`, `The surface of a star is thousands of degrees, hotter than anything a starship can survive. ${b.name} vaporized the ship!`);
        return;
      }
      if (r < b.R * 2) {
        damage(world, 25 * ((b.R * 2 - r) / b.R) * dt, `The heat of ${b.name} was too much for the ship.`);
        warnOnce(world, 'heat' + b.id, `Warning: hull temperature critical! Move away from ${b.name}!`);
      }
    } else if (b.kind === 'planet') {
      if (r < b.R) {
        s.pos = add(b.pos, scale(norm(d), b.R * 1.7));
        s.vel = [...b.vel];
        s.assist = true;
        s.throttle = 0;
        s.autopilot = null;
        damage(world, 25, `The ship crashed into ${b.name}.`);
        log(world, `Collision with ${b.name}! The ship bounced off the atmosphere.`, 'alert', true);
        if (s.orbiting) s.orbiting = null;
      }
    } else if (b.kind === 'pulsar') {
      if (r < 45) {
        damage(world, 18 * (1 - r / 45) * dt + 0.5 * dt, 'The radiation near the pulsar was too intense.');
        warnOnce(world, 'pulsarNear', 'Radiation alert! Too close to the neutron star!', 8, 'alert');
        world.fx.radiation = 1;
      }
      // inside a sweeping beam?
      const along = Math.abs(dot(d, b.beam));
      const perp = Math.sqrt(Math.max(0, r * r - along * along));
      const w = 1.5 + along * 0.06;
      if (r < 700 && perp < w * 1.5) {
        damage(world, 40 * dt * (1 - r / 700), 'The pulsar beam blasted the ship with radiation.');
        world.fx.radiation = 1;
        warnOnce(world, 'beam', 'Pulsar beam sweeping over us! Radiation spike!', 6, 'alert');
      }
    } else if (b.kind === 'blackhole') {
      if (r < b.rs) {
        endProgram(world, 'Crossed the event horizon', `The ship fell into ${b.name}. Once you cross the event horizon, every direction points toward the center, even for light. Nothing can ever come back out!`);
        return;
      }
      if (r < b.rs * 3.5) {
        damage(world, 10 * ((b.rs * 3.5 - r) / b.rs) * dt, 'Tidal forces stretched the ship apart (scientists call it "spaghettification"!).');
        warnOnce(world, 'tidal', 'Warning! Tidal forces are stretching the hull!', 7, 'alert');
      } else if (r < 90 && !s.warp.engaged) {
        warnOnce(world, 'bhgrav', 'Warning: gravity is stronger than our impulse engines! Engage warp to escape!', 12, 'alert');
      }
    }
  }
  // asteroid collisions
  for (const a of world.asteroids) {
    if (!a.alive) continue;
    const dd = len(sub(a.pos, s.pos));
    if (dd < a.r + 1.2) {
      const rel = len(sub(s.vel, asteroidVel(a)));
      destroyAsteroid(world, a, false);
      damage(world, 4 + rel * 1.5 + a.r * 3, 'An asteroid smashed into the ship.');
      log(world, s.shields.up ? 'Asteroid impact! Shields absorbed the hit.' : 'Asteroid impact on the hull! Raise the shields!', 'alert', !s.shields.up);
    }
  }
}

function weapons(world, dt, pf) {
  const ph = world.fx.phaser;
  if (ph) {
    ph.time -= dt;
    const t = targetInfo(world, ph.target);
    if (!t || ph.time <= 0) world.fx.phaser = null;
    else if (t.asteroid) {
      t.asteroid.hp -= 60 * (0.5 + pf.weapons) * dt;
      if (Math.random() < dt * 30) {
        world.particles.push({ pos: [...t.pos], vel: add(t.vel, scale(norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), 4)), life: 0.6, t: 0, size: 0.3, color: [1, 0.6, 0.3] });
      }
      if (t.asteroid.hp <= 0) {
        destroyAsteroid(world, t.asteroid, true);
        world.fx.phaser = null;
      }
    } else if (t.kind === 'core') {
      world.ejectedCore.timer = Math.min(world.ejectedCore.timer, 0.01);
    }
  }
  for (const tp of world.torpedoes) {
    tp.life -= dt;
    const t = targetInfo(world, tp.target);
    if (t) {
      const want = scale(norm(sub(t.pos, tp.pos)), 70);
      const desired = add(t.vel, want);
      const dv = sub(desired, tp.vel);
      const k = Math.min(1, dt * 3);
      tp.vel = add(tp.vel, scale(dv, k));
    }
    tp.pos = add(tp.pos, scale(tp.vel, dt));
    let boom = tp.life <= 0;
    for (const a of world.asteroids) {
      if (a.alive && len(sub(a.pos, tp.pos)) < a.r + 1.5) {
        destroyAsteroid(world, a, true);
        boom = true;
      }
    }
    if (t && t.kind === 'core' && len(sub(t.pos, tp.pos)) < 3) {
      world.ejectedCore.timer = 0.01;
      boom = true;
    }
    if (boom) {
      tp.dead = true;
      explode(world, tp.pos, 3, [0, 0, 0], [1, 0.5, 0.3]);
      sfx(world, 'explosion');
    }
  }
  world.torpedoes = world.torpedoes.filter((t) => !t.dead);
  for (const a of world.asteroids) {
    if (!a.alive) {
      a.respawn -= dt;
      if (a.respawn <= 0) {
        a.alive = true;
        a.hp = a.maxHp;
      }
    }
  }
}

function particles(world, dt) {
  for (const p of world.particles) {
    p.t += dt;
    p.pos = add(p.pos, scale(p.vel, dt));
  }
  world.particles = world.particles.filter((p) => p.t < p.life);
  for (const e of world.explosions) {
    e.t += dt;
    e.pos = add(e.pos, scale(e.vel, dt));
  }
  world.explosions = world.explosions.filter((e) => e.t < e.life);
  const fx = world.fx;
  fx.shieldHit = Math.max(0, fx.shieldHit - dt * 1.5);
  fx.hullHit = Math.max(0, fx.hullHit - dt * 1.5);
  fx.warpFlash = Math.max(0, fx.warpFlash - dt * 1.4);
}

function missions(world, dt) {
  const s = world.ship;
  const st = world.stats;
  if (!s.warp.engaged && st.relSpeed > IMPULSE_MAX * 0.25) completeMission(world, 'impulse');
  if (s.orbiting) {
    s.orbitTime += dt;
    const b = world.byId[s.orbiting];
    const r = len(sub(s.pos, b.pos));
    if (r > b.hill) {
      log(world, `We have drifted out of ${b.name}'s orbit.`, 'warn');
      s.orbiting = null;
    } else if (s.orbitTime > 8) {
      if (b.id === 'aurelia') completeMission(world, 'orbit');
      if (b.id === 'titanus') completeMission(world, 'titanus');
    }
  }
  const dist = (id) => len(sub(world.byId[id].pos, s.pos));
  if (dist('antares') < world.byId.antares.R * 4) completeMission(world, 'antares');
  if (dist('vela') < 200) completeMission(world, 'pulsar');
  if (st.dilation <= 0.9) completeMission(world, 'dilation');
}

export function updateStats(world) {
  const s = world.ship;
  const st = world.stats;
  const ref = referenceBody(world, s.pos);
  st.ref = ref;
  st.relSpeed = s.warp.engaged ? world.stats.warpSpeed || 0 : len(sub(s.vel, ref ? ref.vel : [0, 0, 0]));
  const g = shipGravity(world, s.pos);
  st.gravity = len(g) / G_UNIT;
  const bh = world.byId.abyss;
  const rbh = len(sub(s.pos, bh.pos));
  st.bhDist = rbh;
  st.dilation = Math.sqrt(Math.max(0, 1 - bh.rs / Math.max(rbh, bh.rs)));
  st.maxWarp = maxWarp(s);
  // the body with the strongest pull
  let best = null;
  let bg = -1;
  for (const b of world.bodies) {
    const gg = len(gravityFrom(b, s.pos));
    if (gg > bg) {
      bg = gg;
      best = b;
    }
  }
  st.dominant = best;
}

// Escape speed and circular orbit speed around body b at distance r
export function orbitalNumbers(b, r) {
  const rr = b.kind === 'blackhole' ? Math.max(r - b.rs, 0.01) : r;
  return { escape: Math.sqrt((2 * b.GM) / rr), circular: Math.sqrt(b.GM / rr) };
}

// Predict where the ship will coast with engines off (for the tactical display).
export function predictTrajectory(world, seconds = 60, n = 300) {
  const s = world.ship;
  const out = [];
  if (s.warp.engaged) return out;
  const saveT = world.t;
  let p = [...s.pos];
  let v = [...s.vel];
  const dt = seconds / n;
  const ref0 = referenceBody(world, p);
  const sub2 = 4;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < sub2; k++) {
      const tt = saveT + (i * sub2 + k) * (dt / sub2);
      world.updateBodies(tt);
      const g = shipGravity(world, p);
      v = add(v, scale(g, dt / sub2));
      p = add(p, scale(v, dt / sub2));
    }
    // express relative to the starting reference body, so orbits draw as loops
    const rel = ref0 ? sub(p, ref0.pos) : p;
    out.push(rel);
    if (world.bodies.some((b) => len(sub(p, b.pos)) < (b.R || 1))) break;
  }
  world.updateBodies(saveT);
  if (ref0) return out.map((q) => add(q, ref0.pos));
  return out;
}

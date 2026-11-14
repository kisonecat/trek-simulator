import '@fontsource/antonio/latin-400.css';
import '@fontsource/antonio/latin-700.css';
import './style.css';
import {
  createWorld, step, commands, MISSIONS, targetInfo, setPower, maxWarp, powerFactors,
  warpTimesLight, orbitalNumbers, C, G_UNIT, SOLAR_GM, IMPULSE_MAX, vec,
} from './sim.js';
import { createViewscreen } from './viewscreen.js';
import { createTactical } from './tactical.js';
import { createCore } from './core.js';
import { audio, speak } from './audio.js';
import { FACTS } from './facts.js';

const $ = (id) => document.getElementById(id);
const { sub, len } = vec;

// ---------- persistent bits ----------
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('bridge.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('bridge.' + k, JSON.stringify(v));
    } catch {
      /* storage may be unavailable */
    }
  },
};

let world = createWorld();
Object.assign(world.missions, store.get('missions', {}));
let started = false;

const viewscreen = createViewscreen($('view'), $('viewOverlay'));
const tactical = createTactical($('tac'), $('tacOverlay'));
const core = createCore($('core'));

const CLASSES = {
  helios: 'YELLOW STAR',
  aurelia: 'EARTH-LIKE PLANET',
  ares: 'DESERT PLANET',
  titanus: 'RINGED GAS GIANT',
  antares: 'RED GIANT STAR',
  vela: 'NEUTRON STAR (PULSAR)',
  abyss: 'BLACK HOLE',
};
const DEST_COLORS = { star: 'c-gold', planet: 'c-blue', pulsar: 'c-lilac', blackhole: 'c-red' };

// ---------- helpers ----------
function fmtLs(su) {
  const ls = su / C;
  return ls < 10 ? ls.toFixed(2) : ls < 100 ? ls.toFixed(1) : ls.toFixed(0);
}
function headingText(s) {
  let y = Math.round(((s.yaw * 180) / Math.PI + 360) % 360);
  const p = Math.round((s.pitch * 180) / Math.PI);
  return `${String(y).padStart(3, '0')} MARK ${p >= 0 ? '' : '−'}${String(Math.abs(p)).padStart(2, '0')}`;
}
function throttleName(t) {
  return { 0: 'STOP', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4', 1: 'FULL' }[t] ?? `${Math.round(t * 100)}%`;
}
function speedText(world) {
  const s = world.ship;
  if (s.warp.engaged) return `WARP ${s.warp.factor} · ${Math.round(warpTimesLight(s.warp.factor)).toLocaleString()}× LIGHT SPEED`;
  const v = world.stats.relSpeed;
  return `${(v / C).toFixed(3)} c  (${Math.round((v / IMPULSE_MAX) * 100)}% IMPULSE)`;
}
function setText(el, html) {
  if (el._last !== html) {
    el.innerHTML = html;
    el._last = html;
  }
}

// ---------- log ----------
function addLog(text, level = 'info') {
  const el = document.createElement('div');
  el.className = level;
  el.textContent = text;
  const log = $('log');
  log.appendChild(el);
  while (log.children.length > 30) log.firstChild.remove();
}

function drainEvents() {
  const evs = world.events;
  world.events = [];
  for (const e of evs) {
    if (e.type === 'log') {
      addLog(e.text, e.level);
      if (e.speak && started) speak(e.text);
    } else if (e.type === 'sfx') {
      if (started) audio.play(e.name);
    } else if (e.type === 'alert') {
      audio.redAlert(e.level === 'red');
    } else if (e.type === 'mission') {
      store.set('missions', world.missions);
      renderMissions();
      const done = Object.values(world.missions).filter(Boolean).length;
      if (started) speak(done === MISSIONS.length ? 'All missions complete. Congratulations, Captain!' : 'Mission complete.');
    } else if (e.type === 'gameover') {
      $('goTitle').textContent = world.gameOver.title.toUpperCase();
      $('goText').textContent = world.gameOver.text;
      $('gameover').hidden = false;
      audio.redAlert(false);
      if (started) speak('Program ended. ' + world.gameOver.title + '.');
    }
  }
}

// ---------- panel switching ----------
function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== 'panel-' + name));
  document.querySelectorAll('.side[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
}
document.querySelectorAll('.side[data-panel]').forEach((b) =>
  b.addEventListener('click', () => {
    showPanel(b.dataset.panel);
    audio.play('beep');
  }),
);
showPanel('helm');

// ---------- HELM ----------
document.querySelectorAll('[data-throttle]').forEach((b) =>
  b.addEventListener('click', () => commands.setThrottle(world, +b.dataset.throttle)),
);
$('btnAssist').onclick = () => commands.toggleAssist(world);
$('btnOrbit').onclick = () => commands.standardOrbit(world);
$('btnWarp').onclick = () => commands.toggleWarp(world);

function selectWarp(n) {
  const s = world.ship;
  const mw = maxWarp(s);
  if (n > mw) {
    world.events.push({ type: 'log', text: `Warp ${n} needs more power: maximum warp is ${mw}. Raise reactor output or move power to the engines in ENGINEERING.`, level: 'warn', speak: true });
    world.events.push({ type: 'sfx', name: 'deny' });
    return;
  }
  s.warp.factor = n;
  audio.play('beep');
  if (s.warp.engaged) world.events.push({ type: 'log', text: `Warp ${n}.`, level: 'info' });
}
document.querySelectorAll('[data-warp-select]').forEach((g) => {
  for (let i = 1; i <= 9; i++) {
    const b = document.createElement('button');
    b.textContent = i;
    b.dataset.w = i;
    b.onclick = () => selectWarp(i);
    g.appendChild(b);
  }
});

function holdTurn(el, axis, dir) {
  const stop = () => (world.ship.turn[axis] = 0);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    world.ship.turn[axis] = dir;
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('lostpointercapture', stop);
}
document.querySelectorAll('[data-turn]').forEach((b) => {
  const [axis, dir] = b.dataset.turn.split(':');
  holdTurn(b, axis, +dir);
});

// ---------- NAV ----------
function buildDestinations() {
  const list = $('destList');
  list.innerHTML = '';
  const entries = world.bodies.map((b) => ({ id: b.id, name: b.name, kind: CLASSES[b.id], cls: DEST_COLORS[b.kind] }));
  entries.push({ id: '@asteroid', name: 'Asteroid Belt', kind: 'NEAREST ASTEROID', cls: 'c-tan' });
  for (const d of entries) {
    const b = document.createElement('button');
    b.className = `dest ${d.cls}`;
    b.dataset.id = d.id;
    b.innerHTML = `<span class="n">${d.name}</span><span class="k">${d.kind} · <i></i></span>`;
    b.onclick = () => {
      if (d.id === '@asteroid') commands.targetNearestAsteroid(world);
      else {
        world.ship.target = d.id;
        audio.play('beep');
      }
    };
    list.appendChild(b);
  }
}
buildDestinations();
$('btnEngageCourse').onclick = () => {
  if (!targetInfo(world, world.ship.target)) return commands.targetNearestAsteroid(world);
  commands.setCourse(world, world.ship.target, true);
};
$('btnFace').onclick = () => commands.setCourse(world, world.ship.target, false);
$('btnAllStop').onclick = () => commands.fullStop(world);

// ---------- ENGINEERING ----------
$('btnCore').onclick = () => commands.setReactorOnline(world, !world.ship.reactor.online);
let ejectArmed = 0;
$('btnEject').onclick = () => {
  if (world.ship.reactor.ejected) return;
  if (performance.now() - ejectArmed < 3000) {
    ejectArmed = 0;
    commands.ejectCore(world);
  } else {
    ejectArmed = performance.now();
    audio.play('warning');
    addLog('Press EJECT CORE again to confirm.', 'warn');
  }
};
$('btnInstall').onclick = () => commands.installCore(world);
$('sOutput').addEventListener('input', (e) => (world.ship.reactor.output = e.target.value / 100));
$('sMix').addEventListener('input', (e) => (world.ship.reactor.intermix = e.target.value / 100));
const powerSliders = { engines: $('pEng'), shields: $('pSh'), weapons: $('pWp') };
for (const [k, el] of Object.entries(powerSliders)) {
  el.addEventListener('input', () => setPower(world.ship, k, +el.value));
}

// ---------- TACTICAL ----------
$('btnShields').onclick = () => commands.toggleShields(world);
document.querySelectorAll('[data-alert]').forEach((b) => (b.onclick = () => commands.setAlert(world, b.dataset.alert)));
$('btnTargetAst').onclick = () => commands.targetNearestAsteroid(world);
$('btnPhaser').onclick = () => commands.firePhasers(world);
$('btnTorpedo').onclick = () => commands.fireTorpedo(world);

// ---------- viewscreen & displays ----------
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    world.ship.view = b.dataset.view;
    audio.play('beep');
  }),
);
$('btnZoom').onclick = () => {
  world.ship.zoom = world.ship.zoom > 1 ? 1 : 4;
  audio.play('beep');
};
$('btnLabels').onclick = () => {
  viewscreen.setLabels(!viewscreen.labels);
  audio.play('beep');
};
$('btnMap').onclick = () => {
  tactical.setMode('map');
  audio.play('beep');
};
$('btnWell').onclick = () => {
  tactical.setMode('well');
  audio.play('beep');
};
$('btnZoomIn').onclick = () => {
  tactical.zoomIn();
  audio.play('beep');
};
$('btnZoomOut').onclick = () => {
  tactical.zoomOut();
  audio.play('beep');
};
$('btnSound').onclick = () => {
  audio.setEnabled(!audio.enabled);
  $('btnSound').firstChild.textContent = audio.enabled ? 'SOUND ON' : 'SOUND OFF';
  store.set('sound', audio.enabled);
};
$('btnVoice').onclick = () => {
  audio.setVoice(!audio.voice);
  $('btnVoice').firstChild.textContent = audio.voice ? 'VOICE ON' : 'VOICE OFF';
  store.set('voice', audio.voice);
  audio.play('beep');
};
if (!store.get('sound', true)) $('btnSound').click();
if (!store.get('voice', true)) {
  audio.setVoice(false);
  $('btnVoice').firstChild.textContent = 'VOICE OFF';
}
$('btnRedAlert').onclick = () => commands.setAlert(world, world.ship.alert === 'red' ? 'green' : 'red');

// ship name
const nameEl = $('shipName');
nameEl.textContent = store.get('shipName', 'ENDEAVOUR');
nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nameEl.blur();
  }
});
nameEl.addEventListener('blur', () => {
  const v = nameEl.textContent.trim().toUpperCase().slice(0, 24) || 'ENDEAVOUR';
  nameEl.textContent = v;
  store.set('shipName', v);
  document.title = `U.S.S. ${v} · Bridge`;
});
document.title = `U.S.S. ${nameEl.textContent} · Bridge`;

// intro and restart
$('btnBegin').onclick = () => {
  started = true;
  $('intro').hidden = true;
  audio.unlock();
  audio.play('chime');
  speak(`Welcome aboard the ${nameEl.textContent}, Captain.`);
};
$('btnRestart').onclick = () => {
  const missions = world.missions;
  world = createWorld();
  Object.assign(world.missions, missions);
  $('gameover').hidden = true;
  addLog('Holodeck program restarted.', 'good');
  audio.play('powerUp');
};

// ---------- missions ----------
function renderMissions() {
  const ol = $('missionList');
  ol.innerHTML = '';
  for (const m of MISSIONS) {
    const li = document.createElement('li');
    li.textContent = m.text;
    if (world.missions[m.id]) li.className = 'done';
    ol.appendChild(li);
  }
  const done = MISSIONS.filter((m) => world.missions[m.id]).length;
  $('missionCount').textContent = `${done}/${MISSIONS.length}`;
}
renderMissions();

// ---------- gauges ----------
const GAUGES = [
  ['shields', 'SHIELDS'],
  ['hull', 'HULL'],
  ['temp', 'CORE TEMP'],
  ['phaser', 'PHASERS'],
  ['torps', 'TORPEDOES'],
  ['speed', 'SPEED'],
  ['grav', 'GRAVITY'],
];
const gaugeEls = {};
for (const [k, label] of GAUGES) {
  const row = document.createElement('div');
  row.className = 'gauge';
  row.innerHTML =
    k === 'torps'
      ? `<span class="lbl">${label}</span><div class="torps">${'<i></i>'.repeat(10)}</div><span class="val"></span>`
      : `<span class="lbl">${label}</span><div class="bar2"><div></div></div><span class="val"></span>`;
  $('gauges').appendChild(row);
  gaugeEls[k] = { bar: row.querySelector('.bar2 > div'), val: row.querySelector('.val'), pips: row.querySelectorAll('.torps i') };
}
function gauge(k, frac, text, color) {
  const g = gaugeEls[k];
  if (g.bar) {
    g.bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    g.bar.style.background = color;
  }
  setText(g.val, text);
}

// ---------- keyboard ----------
const keyTurn = { ArrowLeft: ['yaw', -1], ArrowRight: ['yaw', 1], ArrowUp: ['pitch', 1], ArrowDown: ['pitch', -1] };
const THROTTLES = [0, 0.25, 0.5, 0.75, 1];
window.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
  if (!started) return;
  const s = world.ship;
  if (keyTurn[e.key]) {
    s.turn[keyTurn[e.key][0]] = keyTurn[e.key][1];
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '9') selectWarp(+k);
  else if (k === 'enter') commands.toggleWarp(world);
  else if (k === ' ') {
    e.preventDefault();
    commands.firePhasers(world);
  } else if (k === 't') commands.fireTorpedo(world);
  else if (k === 'n') commands.targetNearestAsteroid(world);
  else if (k === 'f') commands.toggleShields(world);
  else if (k === 'o') commands.standardOrbit(world);
  else if (k === 'r') commands.setAlert(world, s.alert === 'red' ? 'green' : 'red');
  else if (k === 'v') {
    const views = ['forward', 'aft', 'target'];
    s.view = views[(views.indexOf(s.view) + 1) % views.length];
  } else if (k === 'm') tactical.setMode(tactical.state.mode === 'map' ? 'well' : 'map');
  else if (k === 'h') showPanel('missions');
  else if (k === '[' || k === ']') {
    let i = THROTTLES.findIndex((x) => x >= s.throttle - 0.01);
    i = Math.max(0, Math.min(4, i + (k === ']' ? 1 : -1)));
    commands.setThrottle(world, THROTTLES[i]);
  }
});
window.addEventListener('keyup', (e) => {
  if (keyTurn[e.key]) world.ship.turn[keyTurn[e.key][0]] = 0;
});
window.addEventListener('blur', () => {
  world.ship.turn.yaw = 0;
  world.ship.turn.pitch = 0;
});

// ---------- periodic UI refresh ----------
let factIdx = Math.floor(Math.random() * FACTS.length);
let factTimer = 0;
function updateUI(dt) {
  const s = world.ship;
  const st = world.stats;
  const r = s.reactor;
  const pf = powerFactors(s);
  const mw = st.maxWarp;

  // header
  const cond = $('condition');
  cond.className = 'seg ' + (s.alert === 'red' ? 'c-red red' : s.alert === 'yellow' ? 'c-gold yellow' : 'c-orange');
  setText(cond, `CONDITION ${s.alert.toUpperCase()}`);
  $('btnRedAlert').classList.toggle('on', s.alert === 'red');
  const now = new Date();
  const doy = (now - new Date(now.getFullYear(), 0, 0)) / 864e5;
  setText($('stardate'), `STARDATE ${((now.getFullYear() - 2000) * 1000 + (doy / 365.25) * 1000 + world.t / 60).toFixed(1)}`);
  setText($('footCoords'), `POS ${s.pos.map((x) => Math.round(x / 10)).join(' · ')}`);

  // viewscreen HUD
  const near = st.ref ? `IN ${s.orbiting ? 'ORBIT OF' : 'SPACE NEAR'} ${st.ref.name.toUpperCase()}` : `NEAREST PULL: ${st.dominant.name.toUpperCase()}`;
  let ap = '';
  if (s.autopilot) {
    const t = targetInfo(world, s.autopilot.target);
    ap = `<br><b>AUTOPILOT</b> ${s.autopilot.phase === 'align' ? 'TURNING TOWARD' : 'EN ROUTE TO'} ${t ? t.name.toUpperCase() : ''}`;
  }
  const dil = st.dilation < 0.995 ? `<br><b>TIME DILATION</b> 1 HOUR ABOARD = ${(1 / st.dilation).toFixed(2)} HOURS OUTSIDE` : '';
  setText($('vsHud'), `<b>${s.warp.engaged ? 'WARP DRIVE' : 'IMPULSE ' + throttleName(s.throttle)}</b> ${speedText(world)}<br><b>HEADING</b> ${headingText(s)} · <b>VIEW</b> ${s.view.toUpperCase()}${s.zoom > 1 ? ' ×4' : ''}<br>${near}${ap}${dil}`);
  let alertMsg = '';
  if (r.breach >= 0) alertMsg = `WARP CORE BREACH IN ${Math.ceil(r.breach)}`;
  else if (st.bhDist < world.byId.abyss.rs * 3.5) alertMsg = 'TIDAL FORCES CRITICAL';
  else if (st.overpowered) alertMsg = 'GRAVITY EXCEEDS ENGINE POWER';
  else if (world.fx.radiation > 0.5) alertMsg = 'RADIATION ALERT';
  else if (s.hull < 30) alertMsg = 'HULL INTEGRITY LOW';
  else if (s.alert === 'red') alertMsg = 'RED ALERT';
  $('vsAlert').classList.toggle('show', !!alertMsg);
  setText($('vsAlert'), alertMsg);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === s.view));
  $('btnZoom').classList.toggle('active', s.zoom > 1);
  $('btnLabels').classList.toggle('active', viewscreen.labels);
  $('btnMap').classList.toggle('active', tactical.state.mode === 'map');
  $('btnWell').classList.toggle('active', tactical.state.mode === 'well');

  // helm
  document.querySelectorAll('[data-throttle]').forEach((b) => b.classList.toggle('active', !s.warp.engaged && Math.abs(+b.dataset.throttle - s.throttle) < 0.01));
  setText($('impulseReadout'), `SPEED <b>${speedText(world)}</b><br>THRUST <b>${(st.thrust / G_UNIT || 0).toFixed(2)} g</b> · GRAVITY HERE <b>${st.gravity.toFixed(3)} g</b>`);
  $('btnAssist').textContent = `HELM ASSIST: ${s.assist ? 'ON' : 'OFF'}`;
  $('btnAssist').classList.toggle('active', s.assist);
  setText($('assistHint'), s.orbiting
    ? `In orbit: engines off, the ship is falling around ${world.byId[s.orbiting].name} and always missing it.`
    : s.assist
      ? 'Helm assist ON: thrusters hold your speed. Turn it OFF to coast like a real spacecraft.'
      : 'Newtonian flight: engines push you, gravity pulls you, and nothing slows you down!');
  document.querySelectorAll('[data-warp-select] button').forEach((b) => {
    b.classList.toggle('active', +b.dataset.w === s.warp.factor);
    b.classList.toggle('over', +b.dataset.w > mw);
  });
  const bw = $('btnWarp');
  bw.textContent = s.warp.engaged ? 'DROP OUT OF WARP' : `ENGAGE WARP ${s.warp.factor}`;
  bw.classList.toggle('engaged', s.warp.engaged);
  setText($('warpReadout'), `MAX WARP AVAILABLE <b>${mw}</b>${mw < 9 ? ' <span class="warn">(MORE POWER NEEDED FOR HIGHER WARP)</span>' : ''}<br>WARP ${s.warp.factor} ≈ <b>${Math.round(warpTimesLight(s.warp.factor)).toLocaleString()}×</b> THE SPEED OF LIGHT`);
  setText($('headingReadout'), headingText(s));

  // nav
  const tgt = targetInfo(world, s.target);
  document.querySelectorAll('.dest').forEach((b) => {
    const id = b.dataset.id;
    const isAst = id === '@asteroid';
    b.classList.toggle('active', isAst ? !!(s.target && s.target.startsWith('ast:')) : s.target === id);
    const t = isAst ? (tgt && tgt.kind === 'asteroid' ? tgt : null) : targetInfo(world, id);
    const i = b.querySelector('i');
    setText(i, t ? `${fmtLs(len(sub(t.pos, s.pos)))} LS` : '—');
  });
  if (tgt) {
    const d = len(sub(tgt.pos, s.pos));
    setText($('navTarget'), `TARGET <b>${tgt.name.toUpperCase()}</b><br>DISTANCE <b>${fmtLs(d)} LIGHT-SECONDS</b><br>LIGHT FROM IT TAKES <b>${(d / C).toFixed(1)} s</b> TO REACH US`);
  } else setText($('navTarget'), 'NO TARGET SELECTED');
  setText($('navStatus'), s.autopilot ? `AUTOPILOT: <b>${s.autopilot.phase.toUpperCase()}</b>` : 'AUTOPILOT: <b>STANDING BY</b>');

  // engineering
  const bc = $('btnCore');
  bc.textContent = r.ejected ? 'NO CORE' : r.online ? 'SHUT DOWN CORE' : 'BRING CORE ONLINE';
  bc.disabled = r.ejected;
  $('btnEject').hidden = r.ejected;
  $('btnEject').classList.toggle('armed', performance.now() - ejectArmed < 3000);
  $('btnEject').textContent = performance.now() - ejectArmed < 3000 ? 'CONFIRM EJECT!' : 'EJECT CORE';
  $('btnInstall').hidden = !r.ejected;
  $('btnInstall').textContent = r.installTimer > 0 ? `INSTALLING... ${Math.ceil(r.installTimer)}` : 'INSTALL SPARE CORE';
  const so = $('sOutput'), sm = $('sMix');
  if (document.activeElement !== so) so.value = Math.round(r.output * 100);
  if (document.activeElement !== sm) sm.value = Math.round(r.intermix * 100);
  setText($('outVal'), `${Math.round(r.output * 100)}%`);
  setText($('mixVal'), `1 : ${r.intermix.toFixed(2)}`);
  const tempCls = r.temp > 90 ? 'warn' : r.temp < 85 ? 'good' : '';
  setText($('coreReadout'), `CORE TEMPERATURE <b class="${tempCls}">${r.temp.toFixed(0)}%</b> OF SAFE LIMIT${r.breach >= 0 ? `<br><span class="warn">CORE BREACH IN ${Math.ceil(r.breach)} SECONDS!</span>` : ''}<br>STATUS <b>${r.ejected ? 'EJECTED' : r.online ? 'ONLINE' : 'OFFLINE (AUXILIARY POWER)'}</b>`);
  for (const [k, el] of Object.entries(powerSliders)) {
    if (document.activeElement !== el) el.value = Math.round(s.power[k]);
  }
  setText($('pEngVal'), `${Math.round(s.power.engines)}%`);
  setText($('pShVal'), `${Math.round(s.power.shields)}%`);
  setText($('pWpVal'), `${Math.round(s.power.weapons)}%`);
  setText($('powerReadout'), `MAX WARP <b>${mw}</b> · ENGINE THRUST <b>${((10 * Math.max(pf.engines, 0.3)) / G_UNIT).toFixed(2)} g</b><br>SHIELD RECHARGE <b>${(5 * pf.shields).toFixed(1)}%/s</b> · PHASER RECHARGE <b>${(14 * pf.weapons).toFixed(1)}%/s</b>`);

  // tactical
  $('btnShields').textContent = s.shields.up ? 'LOWER SHIELDS' : 'RAISE SHIELDS';
  $('btnShields').classList.toggle('active', s.shields.up);
  $('shieldMeter').style.width = `${s.shields.strength}%`;
  $('shieldMeter').style.background = s.shields.up ? 'var(--blue)' : '#555577';
  setText($('shieldReadout'), `SHIELDS <b>${s.shields.up ? 'UP' : 'DOWN'}</b> · STRENGTH <b>${s.shields.strength.toFixed(0)}%</b> · HULL <b>${s.hull.toFixed(0)}%</b>`);
  document.querySelectorAll('[data-alert]').forEach((b) => b.classList.toggle('active', b.dataset.alert === s.alert));
  if (tgt) {
    const d = len(sub(tgt.pos, s.pos));
    const inRange = d <= 300;
    setText($('weaponTarget'), `TARGET <b>${tgt.name.toUpperCase()}</b> · ${fmtLs(d)} LS ${tgt.kind === 'asteroid' ? (inRange ? '<span class="good">IN RANGE</span>' : '<span class="warn">OUT OF RANGE</span>') : ''}`);
  } else setText($('weaponTarget'), 'NO TARGET');
  setText($('weaponReadout'), `PHASER CHARGE <b>${s.phaser.toFixed(0)}%</b> · TORPEDOES <b>${s.torpedoes}</b>`);

  // science
  updateScience(tgt, dt);

  // gauges
  gauge('shields', s.shields.strength / 100, s.shields.up ? `${s.shields.strength.toFixed(0)}%` : 'DOWN', s.shields.up ? 'var(--blue)' : '#555577');
  gauge('hull', s.hull / 100, `${s.hull.toFixed(0)}%`, s.hull > 50 ? 'var(--tan)' : s.hull > 25 ? 'var(--gold)' : 'var(--red)');
  gauge('temp', r.temp / 110, `${r.temp.toFixed(0)}%`, r.temp > 90 ? 'var(--red)' : r.temp > 80 ? 'var(--gold)' : 'var(--lilac)');
  gauge('phaser', s.phaser / 100, `${s.phaser.toFixed(0)}%`, 'var(--orange)');
  gaugeEls.torps.pips.forEach((p, i) => p.classList.toggle('on', i < s.torpedoes));
  setText(gaugeEls.torps.val, `${s.torpedoes}`);
  const spFrac = s.warp.engaged ? 0.5 + s.warp.factor / 18 : st.relSpeed / IMPULSE_MAX / 2;
  gauge('speed', spFrac, s.warp.engaged ? `W${s.warp.factor}` : `${(st.relSpeed / C).toFixed(2)}c`, s.warp.engaged ? 'var(--sky)' : 'var(--gold)');
  gauge('grav', Math.log10(1 + st.gravity * 10) / 2, `${st.gravity.toFixed(2)}g`, st.overpowered ? 'var(--red)' : 'var(--blue)');
}

function updateScience(tgt, dt) {
  const s = world.ship;
  const st = world.stats;
  factTimer -= dt;
  if (factTimer <= 0) {
    factTimer = 20;
    factIdx = (factIdx + 1) % FACTS.length;
    setText($('sciFact'), FACTS[factIdx]);
  }
  const t = tgt || targetInfo(world, st.dominant.id);
  if (!t) return;
  const d = len(sub(t.pos, s.pos));
  setText($('sciTitle'), `SENSOR SCAN: ${t.name.toUpperCase()}`);
  let rows = [];
  if (t.body) {
    const b = t.body;
    setText($('sciBlurb'), b.blurb);
    const isPlanet = b.kind === 'planet';
    const mass = isPlanet ? `${(b.GM / 800).toFixed(1)} × EARTH` : `${(b.GM / SOLAR_GM).toFixed(2)} × SUN`;
    const on = orbitalNumbers(b, Math.max(d, b.R));
    const g = (b.kind === 'blackhole' ? b.GM / Math.pow(Math.max(d - b.rs, 0.1), 2) : b.GM / (d * d)) / G_UNIT;
    rows = [
      ['TYPE', CLASSES[b.id]],
      ['DISTANCE', `${fmtLs(d)} LIGHT-SEC`],
      ['MASS', mass],
      [b.kind === 'blackhole' ? 'EVENT HORIZON' : 'RADIUS', `${(b.R / C).toFixed(3)} LIGHT-SEC`],
      ['ITS GRAVITY ON US', `${g < 0.001 ? g.toExponential(1) : g.toFixed(3)} g`],
      ['ESCAPE SPEED HERE', on.escape >= C ? 'FASTER THAN LIGHT!' : `${(on.escape / C).toFixed(3)} c`],
      ['ORBIT SPEED HERE', on.circular >= C ? 'NO ORBIT POSSIBLE' : `${(on.circular / C).toFixed(3)} c`],
    ];
    if (isPlanet) rows.push(['YEAR LENGTH', `${((2 * Math.PI) / b.omega).toFixed(0)} SECONDS`], ['SURFACE GRAVITY', `${(b.GM / (b.R * b.R) / G_UNIT).toFixed(2)} g`]);
    if (b.kind === 'blackhole') rows.push(['NO-WARP ZONE', `${((b.rs * 3) / C).toFixed(2)} LIGHT-SEC`], ['CLOCK SPEED HERE', `${(st.dilation * 100).toFixed(1)}%`]);
    if (b.kind === 'pulsar') rows.push(['SPIN PERIOD', `${b.period} SECONDS`], ['SURFACE GRAVITY', `${(b.GM / (b.R * b.R) / G_UNIT).toFixed(0)} g`]);
    if (b.kind === 'star') rows.push(['SURFACE', b.id === 'antares' ? 'ABOUT 3,500 °C' : 'ABOUT 5,500 °C']);
  } else if (t.kind === 'asteroid') {
    setText($('sciBlurb'), 'An asteroid: a chunk of rock and metal left over from when the planets formed, about 4.6 billion years ago in our own solar system. It orbits the star just like a tiny planet.');
    rows = [
      ['TYPE', 'ROCKY ASTEROID'],
      ['DISTANCE', `${fmtLs(d)} LIGHT-SEC`],
      ['SIZE', `${(t.R * 2 * 28).toFixed(0)} THOUSAND KM`],
      ['STRUCTURE', `${Math.max(0, (t.asteroid.hp / t.asteroid.maxHp) * 100).toFixed(0)}%`],
    ];
  } else {
    setText($('sciBlurb'), 'The ejected warp core. Its magnetic bottles are failing; when the antimatter touches matter it will release a huge burst of energy!');
    rows = [['DISTANCE', `${fmtLs(d)} LIGHT-SEC`]];
  }
  setText($('sciStats'), rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(''));
  const local = [
    ['GRAVITY HERE', `${st.gravity.toFixed(3)} g`],
    ['STRONGEST PULL', st.dominant.name.toUpperCase()],
    ['OUR SPEED', s.warp.engaged ? `WARP ${s.warp.factor}` : `${(st.relSpeed / C).toFixed(3)} c`],
    ['CLOCK SPEED', `${(st.dilation * 100).toFixed(st.dilation > 0.999 ? 0 : 2)}%`],
    ['1 HOUR ABOARD =', `${(1 / st.dilation).toFixed(st.dilation > 0.999 ? 0 : 3)} HOURS OUTSIDE`],
  ];
  setText($('sciLocal'), local.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join(''));
}

// ---------- main loop ----------
let last = performance.now();
let acc = 0;
let uiTimer = 0;
const H = 1 / 120;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let n = 0;
  while (acc >= H && n < 24) {
    step(world, H);
    acc -= H;
    n++;
  }
  if (n >= 24) acc = 0;
  drainEvents();
  try {
    viewscreen.render(world, dt);
    tactical.render(world, dt);
    core.render(world, dt);
  } catch (err) {
    console.error(err);
  }
  uiTimer -= dt;
  if (uiTimer <= 0) {
    uiTimer = 0.1;
    updateUI(0.1);
  }
  if (started) {
    const r = world.ship.reactor;
    audio.updateHum(r.online && !r.ejected ? r.output : 0, world.ship.warp.engaged ? world.ship.warp.level : 0);
  }
  requestAnimationFrame(frame);
}
// handy for poking at the simulation from the browser console
window.bridge = { get world() { return world; }, commands };

addLog('All systems nominal. Ready for orders, Captain.', 'good');
requestAnimationFrame(frame);

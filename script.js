const pages = document.querySelectorAll('.page');
const navButtons = document.querySelectorAll('[data-target]');
const hotspotButtons = document.querySelectorAll('.hotspot');
const pumpPistonEl = document.getElementById('pumpPiston');
const pumpLeverEl = document.getElementById('pumpLever');
let pumpVisualTimer = null;

function showPage(id) {
  pages.forEach((page) => page.classList.toggle('active', page.id === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
navButtons.forEach((button) => button.addEventListener('click', () => showPage(button.dataset.target)));
hotspotButtons.forEach((button) => {
  ['pointerdown', 'pointerup', 'pointerleave', 'pointercancel'].forEach((type) => {
    button.addEventListener(type, () => button.classList.toggle('touch-active', type === 'pointerdown'));
  });
});

const ottoSpeechTexts = [
  'Ich bin Otto von Guericke. Im 17. Jahrhundert wollte ich zeigen, dass Luft nicht "nichts" ist. Sie übt Druck aus – und zwar in alle Richtungen.',
  'Die Leute sagten früher: Luft ist nichts. Ich sagte: Dann probieren wir das mal aus!',
  'Früher dachte man: Luft? Egal. Ich dachte: Challenge accepted.',
  'Stell dir vor: Ein Marktplatz, viele Zuschauer – und ich mit meinen Halbkugeln.',
  'Bei den Magdeburger Halbkugeln wird Luft aus dem Inneren gepumpt. Außen bleibt fast normaler Luftdruck erhalten. Dieser Druckunterschied presst die Halbkugeln zusammen.',
  'Dann kamen die Pferde. Starke Pferde. Sehr motivierte Pferde. Ergebnis: Die Kugeln blieben zusammen.',
  'Die Pferde haben gezogen, geschwitzt, wahrscheinlich geflucht – aber die Kugeln hielten.',
  'Wissenschaft kann ziemlich unterhaltsam sein, findest du nicht?',
  'Heute würdet ihr sagen: F = Δp · A. Ich sagte damals einfach: „Zieht mal kräftiger!“',
  'Probier es in der Simulation aus – du wirst sehen, wie stark Luft sein kann!'
];

let currentOttoIndex = 0;
const ottoSpeechEl = document.getElementById('ottoSpeech');
const ottoNextBtn = document.getElementById('ottoNextBtn');

if (ottoSpeechEl) {
  ottoSpeechEl.textContent = ottoSpeechTexts[currentOttoIndex];
}

ottoNextBtn?.addEventListener('click', () => {
  currentOttoIndex = (currentOttoIndex + 1) % ottoSpeechTexts.length;
  if (ottoSpeechEl) {
    ottoSpeechEl.textContent = ottoSpeechTexts[currentOttoIndex];
  }
});

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const ui = {
  resetBtn: document.getElementById('resetBtn'),
  snapBtn: document.getElementById('snapBtn'),
  hoseToggleBtn: document.getElementById('hoseToggleBtn'),
  valveToggleBtn: document.getElementById('valveToggleBtn'),
  pumpStrokeBtn: document.getElementById('pumpStrokeBtn'),
  pullForce: document.getElementById("pullForce"),
  pullForceValue: document.getElementById("pullForceValue"),
  releasePullBtn: document.getElementById('releasePullBtn'),
  cutawayToggle: document.getElementById('cutawayToggle'),
  moleculeToggle: document.getElementById('moleculeToggle'),
  forceToggle: document.getElementById('forceToggle'),
  gaugeToggle: document.getElementById('gaugeToggle'),
  outerPressureValue: document.getElementById('outerPressureValue'),
  innerPressureValue: document.getElementById('innerPressureValue'),
  deltaPressureValue: document.getElementById('deltaPressureValue'),
  holdingForceValue: document.getElementById('holdingForceValue'),
  totalPullValue: document.getElementById('totalPullValue'),
  hintBubble: document.getElementById('hintBubble'),
};

const OUTER_P = 101325;
const MIN_P = 4000;
const FAST_EQUALIZE = 1.55;
const SLOW_LEAK = 0.004;
const RADIUS_M = 0.822;
const SEAL_AREA = Math.PI * RADIUS_M * RADIUS_M;
const MAX_HOLD_FORCE = OUTER_P * SEAL_AREA;

const sim = {
  sphereX: W * 0.44,
  sphereY: H * 0.50,
  r: 126,
  openGap: 150,
  dragging: null,
  joined: false,
  hoseConnected: false,
  valveClosed: false,
  pullForce: 0,
  pullResetAnim: false,
  pullResetSpeed: 900,
  innerPressure: OUTER_P,
  gaugePressure: OUTER_P,
  targetPressure: OUTER_P,
  showCutaway: false,
  showMolecules: false,
  showForces: false,
  showGauge: true,
  particles: [],
  exhaustParticles: [],
  pumpStrokeAnim: 0,
  pendingPumpBursts: 0,
  hintTimer: null,
  hintUntil: 0,
};

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function formatForce(v) { return v >= 1000 ? `${(v / 1000).toFixed(1)} kN` : `${Math.round(v)} N`; }
function deltaP() { return Math.max(0, OUTER_P - sim.innerPressure); }
function displayDeltaP() { return Math.max(0, OUTER_P - sim.gaugePressure); }
function holdingForce() { return sim.joined ? deltaP() * SEAL_AREA : 0; }
function totalPull() { return sim.pullForce * 2; }
function leftCenter() { return { x: sim.sphereX - sim.openGap, y: sim.sphereY }; }
function rightCenter() { return { x: sim.sphereX + sim.openGap, y: sim.sphereY }; }

function showHintDelayed(msg) {
  clearTimeout(sim.hintTimer);
  sim.hintTimer = setTimeout(() => {
    ui.hintBubble.textContent = msg;
    ui.hintBubble.classList.add('visible');
    sim.hintUntil = performance.now() + 5200;
  }, 2200);
}
function clearHint() {
  clearTimeout(sim.hintTimer);
  sim.hintUntil = 0;
  ui.hintBubble.classList.remove('visible');
}

const SHELL_THICKNESS = 18;

function innerRadius() {
  return sim.r - SHELL_THICKNESS;
}

function desiredInsideCount() {
  if (!sim.joined) return 0;
  const ratio = (sim.innerPressure - MIN_P) / (OUTER_P - MIN_P);
  return Math.max(1, Math.round(1 + clamp(ratio, 0, 1) * 47));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function valveOpeningAngle() {
  return -2.32;
}

function valveOpeningWidth() {
  return 0.22;
}

function isInValveOpening(angle) {
  return sim.joined && !sim.valveClosed && angleDiff(angle, valveOpeningAngle()) < valveOpeningWidth();
}

function isInsideJoinedInterior(x, y, pad = 0) {
  const dx = x - sim.sphereX;
  const dy = y - sim.sphereY;
  return Math.hypot(dx, dy) <= innerRadius() - pad;
}

function isInsideOpenHemisphereInterior(x, y, center, isLeft, pad = 0) {
  const dx = x - center.x;
  const dy = y - center.y;
  const dist = Math.hypot(dx, dy);
  const sideOk = isLeft ? x <= center.x + pad : x >= center.x - pad;
  return sideOk && dist <= innerRadius() - pad;
}

function isInsideAnyOpenInterior(x, y, pad = 0) {
  return (
    isInsideOpenHemisphereInterior(x, y, leftCenter(), true, pad) ||
    isInsideOpenHemisphereInterior(x, y, rightCenter(), false, pad)
  );
}

function pointInSolidBrass(x, y, pad = 0) {
  if (sim.joined) {
    const dx = x - sim.sphereX;
    const dy = y - sim.sphereY;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    if (isInValveOpening(angle)) return false;
    return dist >= innerRadius() - pad && dist <= sim.r + pad;
  }

  const left = leftCenter();
  const right = rightCenter();

  const ldx = x - left.x;
  const ldy = y - left.y;
  const ldist = Math.hypot(ldx, ldy);
  const inLeftShell = x <= left.x + pad && ldist >= innerRadius() - pad && ldist <= sim.r + pad;

  const rdx = x - right.x;
  const rdy = y - right.y;
  const rdist = Math.hypot(rdx, rdy);
  const inRightShell = x >= right.x - pad && rdist >= innerRadius() - pad && rdist <= sim.r + pad;

  return inLeftShell || inRightShell;
}

function makeParticle(x, y) {
  const vx = rand(-200, 200);
  const vy = rand(-200, 200);
  return {
    x,
    y,
    vx,
    vy,
    r: rand(1.8, 3.2),
    baseSpeed: Math.hypot(vx, vy) || 200
  };
}

function randomRoomPosition() {
  return {
    x: rand(18, W - 18),
    y: rand(70, H - 125)
  };
}

function randomPointInOpenHemisphere(center, isLeft) {
  for (let tries = 0; tries < 300; tries += 1) {
    const x = rand(center.x - innerRadius(), center.x + innerRadius());
    const y = rand(center.y - innerRadius(), center.y + innerRadius());
    if (isInsideOpenHemisphereInterior(x, y, center, isLeft, 4)) return { x, y };
  }

  return {
    x: center.x + (isLeft ? -innerRadius() * 0.45 : innerRadius() * 0.45),
    y: center.y
  };
}

function placeParticleOutsideSolid(p) {
  for (let tries = 0; tries < 400; tries += 1) {
    const pos = randomRoomPosition();
    p.x = pos.x;
    p.y = pos.y;
    if (!pointInSolidBrass(p.x, p.y, p.r + 1)) return;
  }
}

function countParticlesInsideJoinedInterior() {
  if (!sim.joined) return 0;
  let count = 0;
  sim.particles.forEach((p) => {
    if (isInsideJoinedInterior(p.x, p.y, p.r)) count += 1;
  });
  return count;
}

function moveParticlesIntoJoinedInterior(targetCount) {
  return;
}

function removeParticlesFromJoinedInterior(removeCount) {
  if (!sim.joined || removeCount <= 0) return 0;

  const inside = sim.particles.filter((p) => isInsideJoinedInterior(p.x, p.y, p.r));
  for (let i = inside.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [inside[i], inside[j]] = [inside[j], inside[i]];
  }

  const actual = Math.min(removeCount, inside.length);
  for (let i = 0; i < actual; i += 1) {
    const p = inside[i];
    const idx = sim.particles.indexOf(p);
    if (idx >= 0) sim.particles.splice(idx, 1);
  }
  return actual;
}

function createParticles() {
  sim.particles = [];
  sim.exhaustParticles = [];

  for (let i = 0; i < 2500; i += 1) {
    const pos = randomRoomPosition();
    const p = makeParticle(pos.x, pos.y);
    placeParticleOutsideSolid(p);
    sim.particles.push(p);
  }

  for (let i = 0; i < 24; i += 1) {
    const leftPos = randomPointInOpenHemisphere(leftCenter(), true);
    sim.particles.push(makeParticle(leftPos.x, leftPos.y));
  }

  for (let i = 0; i < 24; i += 1) {
    const rightPos = randomPointInOpenHemisphere(rightCenter(), false);
    sim.particles.push(makeParticle(rightPos.x, rightPos.y));
  }
}

function resetSimulation() {
  sim.openGap = 150;
  sim.dragging = null;
  sim.joined = false;
  sim.hoseConnected = false;
  sim.valveClosed = false;
  sim.pullForce = 0;
  sim.innerPressure = OUTER_P;
  sim.gaugePressure = OUTER_P;
  sim.targetPressure = OUTER_P;
  sim.pumpStrokeAnim = 0;
  sim.pendingPumpBursts = 0;
  ui.pullForce.value = 0;
  ui.cutawayToggle.checked = false;
  ui.moleculeToggle.checked = false;
  ui.forceToggle.checked = false;
  ui.gaugeToggle.checked = true;
  sim.showCutaway = false;
  sim.showMolecules = true;
  sim.showForces = false;
  sim.showGauge = true;
  sim.pullResetAnim = false;
  sim.breakAnim = { active: false, velocity: 0, damping: 0 };
  sim.closeAnim = { active: false, velocity: 0, damping: 0 };
  createParticles();
  clearHint();
  updateReadouts();
}

function updateButtonLabels() {
  ui.snapBtn.textContent = sim.joined ? 'Kugeln öffnen' : 'Kugeln schließen';
  ui.hoseToggleBtn.textContent = sim.hoseConnected ? 'Schlauch abnehmen' : 'Schlauch anschließen';
  ui.valveToggleBtn.textContent = sim.valveClosed ? 'Ventil öffnen' : 'Ventil schließen';
}

function updateReadouts() {
  sim.showCutaway = ui.cutawayToggle.checked;
  sim.showMolecules = ui.moleculeToggle.checked;
  sim.showForces = ui.forceToggle.checked;
  sim.showGauge = ui.gaugeToggle.checked;
  sim.pullForce = Number(ui.pullForce.value);

  ui.pullForceValue.textContent = formatForce(sim.pullForce);
  updateButtonLabels();

  ui.outerPressureValue.textContent = `${Math.round(OUTER_P / 100)} hPa`;
  ui.innerPressureValue.textContent = `${Math.round(sim.gaugePressure / 100)} hPa`;
  ui.deltaPressureValue.textContent = `${Math.round((OUTER_P - sim.gaugePressure) / 100)} hPa`;
  ui.holdingForceValue.textContent = formatForce(displayDeltaP() * SEAL_AREA);
  ui.totalPullValue.textContent = formatForce(totalPull());
}

function closeNowAnimated() {
  sim.breakAnim = { active: false, velocity: 0, damping: 0 };

  sim.joined = false;
  sim.openGap = 150;

  sim.closeAnim = {
    active: true,
    velocity: 900,
    damping: 3.5
  };

  clearHint();
  updateReadouts();
}

function toggleSnap() {
  if (sim.joined) {
    if (spheresLockedByPressure()) {
      showHintDelayed('Die Kugeln bleiben geschlossen, solange die Druckdifferenz noch groß genug ist.');
      return;
    }

    separateNow();
    clearHint();
    updateReadouts();
    return;
  }

  closeNowAnimated();
}

function separateNow(message) {
  sim.joined = false;
  sim.hoseConnected = false;
  sim.valveClosed = false;
  sim.openGap = 0;

  // Zugkraft beim Auseinanderfallen immer sofort auf Null setzen
  sim.pullForce = 0;
  ui.pullForce.value = 0;
  sim.pullResetAnim = false;

  sim.breakAnim = {
    active: true,
    velocity: 900,
    damping: 3.5
  };
  sim.innerPressure = OUTER_P;
  sim.gaugePressure = OUTER_P;
  sim.targetPressure = OUTER_P;
  if (message) showHintDelayed(message);
  updateReadouts();
}

function startPullForceResetAnimation() {
  if (sim.pullForce <= 0) return;
  sim.pullResetAnim = true;
}

function maybeSeparate(reason) {
  if (!sim.joined) return;
  if (totalPull() > holdingForce()) {
    separateNow(reason);
  }
}

function spheresLockedByPressure() {
  return sim.joined && holdingForce() > 0;
}

function attachHose() {
  if (!sim.joined) {
    showHintDelayed('Erst müssen die Halbkugeln zu einer Kugel zusammengefügt werden.');
    return;
  }
  sim.hoseConnected = true;
  updateReadouts();
}
function detachHose() {
  sim.hoseConnected = false;
  updateReadouts();
}

function hosePoint(t) {
  const start = { x: sim.sphereX + sim.r * 0.95, y: sim.sphereY - sim.r * 0.12 };
  const c1 = { x: sim.sphereX + 210, y: sim.sphereY - 140 };
  const c2 = { x: 880, y: 280 };
  const end = { x: 982, y: 335 };
  const x = Math.pow(1 - t, 3) * start.x + 3 * Math.pow(1 - t, 2) * t * c1.x + 3 * (1 - t) * Math.pow(t, 2) * c2.x + Math.pow(t, 3) * end.x;
  const y = Math.pow(1 - t, 3) * start.y + 3 * Math.pow(1 - t, 2) * t * c1.y + 3 * (1 - t) * Math.pow(t, 2) * c2.y + Math.pow(t, 3) * end.y;
  return { x, y };
}

function runPumpCycle() {
  if (!pumpPistonEl || !pumpLeverEl) return;

  clearTimeout(pumpVisualTimer);

  pumpPistonEl.style.transform = 'translateY(64px)';
  pumpLeverEl.style.transform = 'rotate(15deg)';

  pumpVisualTimer = setTimeout(() => {
    pumpPistonEl.style.transform = 'translateY(0px)';
    pumpLeverEl.style.transform = 'rotate(-10deg)';

    setTimeout(() => {
      pumpLeverEl.style.transform = 'rotate(0deg)';
    }, 450);
  }, 450);
}

function startPumpAnimation() {
  sim.pumpStrokeAnim = 1;
  runPumpCycle();
}

function pumpStroke() {
  if (!sim.joined) {
    showHintDelayed('Solange die Halbkugeln noch getrennt sind, kann kein Unterdruck im Inneren entstehen.');
    return;
  }
  if (!sim.hoseConnected) {
    showHintDelayed('Schließe zuerst den Schlauch an die Kugel an.');
    return;
  }

  const prevPressure = sim.innerPressure;

  if (!sim.valveClosed) {
    // Ventil offen:
    // Ein Pumpstoß erzeugt nur eine sehr kleine, kurzzeitige Drucksenkung,
    // die sich wegen der offenen Verbindung zur Umgebung sofort wieder ausgleicht.
    const nextPressure = Math.max(OUTER_P - 450, sim.innerPressure - 300);
    sim.innerPressure = nextPressure;
    sim.targetPressure = nextPressure;

    const insideNow = countParticlesInsideJoinedInterior();

    // Optisch höchstens ganz leicht reduzieren – oft auch gar nicht
    const pressureRatio = nextPressure / prevPressure;
    const proportionalTarget = Math.max(1, Math.round(insideNow * (0.985 + 0.015 * pressureRatio)));
    const curveTarget = desiredInsideCount();
    const finalTarget = Math.max(1, Math.min(proportionalTarget, Math.max(1, curveTarget)));

    const removeCount = Math.max(0, insideNow - finalTarget);
    const removedActual = removeParticlesFromJoinedInterior(removeCount);

    for (let i = 0; i < removedActual; i += 1) {
      sim.exhaustParticles.push({
        t: rand(0, 0.08),
        speed: rand(0.65, 1.08),
        r: rand(1.8, 3.1)
      });
    }

    startPumpAnimation();
    updateReadouts();
    return;
  }

  // Ventil geschlossen:
  // normaler Pumpstoß mit echter Drucksenkung
  const nextPressure = Math.max(MIN_P, sim.innerPressure - Math.max(2000, sim.innerPressure * 0.085));
  sim.innerPressure = nextPressure;
  sim.targetPressure = nextPressure;

  const insideNow = countParticlesInsideJoinedInterior();

  const pressureRatio = nextPressure / prevPressure;
  const proportionalTarget = Math.max(1, Math.round(insideNow * pressureRatio));

  const curveTarget = desiredInsideCount();
  const finalTarget = Math.max(1, Math.min(proportionalTarget, Math.max(1, curveTarget)));

  const removeCount = Math.max(0, insideNow - finalTarget);
  const removedActual = removeParticlesFromJoinedInterior(removeCount);

  for (let i = 0; i < removedActual; i += 1) {
    sim.exhaustParticles.push({
      t: rand(0, 0.08),
      speed: rand(0.65, 1.08),
      r: rand(1.8, 3.1)
    });
  }

  startPumpAnimation();
  updateReadouts();
}

function pointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (W / rect.width),
    y: (evt.clientY - rect.top) * (H / rect.height),
  };
}
function hitHemisphere(point, side) {
  const c = side === 'left' ? leftCenter() : rightCenter();
  return Math.hypot(point.x - c.x, point.y - c.y) <= sim.r + 12;
}

canvas.addEventListener('pointerdown', (evt) => {
  if (spheresLockedByPressure()) {
    sim.dragging = null;
    return;
  }

  const p = pointerPos(evt);
  if (hitHemisphere(p, 'left')) sim.dragging = 'left';
  else if (hitHemisphere(p, 'right')) sim.dragging = 'right';

  if (sim.dragging) canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener('pointermove', (evt) => {
  if (!sim.dragging) return;
  if (spheresLockedByPressure()) return;

  const p = pointerPos(evt);
  if (sim.dragging === 'left') {
    sim.openGap = clamp(sim.sphereX - p.x, 0, 220);
  } else {
    sim.openGap = clamp(p.x - sim.sphereX, 0, 220);
  }

  sim.joined = sim.openGap < 10;

  if (sim.joined) {
    sim.openGap = 0;
  } else {
    sim.innerPressure = OUTER_P;
    sim.targetPressure = OUTER_P;
  }

  updateReadouts();
});

['pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => { sim.dragging = null; }));

ui.resetBtn.addEventListener('click', resetSimulation);

ui.snapBtn.addEventListener('click', toggleSnap);

ui.hoseToggleBtn.addEventListener('click', () => {
  if (sim.hoseConnected) {
    detachHose();
  } else {
    attachHose();
  }
});

ui.valveToggleBtn.addEventListener('click', () => {
  sim.valveClosed = !sim.valveClosed;
  updateReadouts();
});

ui.pumpStrokeBtn.addEventListener('click', pumpStroke);

if (pumpLeverEl) {
  pumpLeverEl.addEventListener('click', pumpStroke);
}

ui.releasePullBtn.addEventListener('click', () => {
  ui.pullForce.value = 0;
  updateReadouts();
});

ui.pullForce.addEventListener('input', () => {
  updateReadouts();
});

[ui.cutawayToggle, ui.moleculeToggle, ui.forceToggle, ui.gaugeToggle].forEach((el) => el.addEventListener('change', updateReadouts));
function resetPullForceIfReleasedAfterBreak() {if (!sim.joined) {startPullForceResetAnimation();}}
['pointerup', 'mouseup', 'touchend', 'change'].forEach((eventName) => {ui.pullForce.addEventListener(eventName, resetPullForceIfReleasedAfterBreak);});

function updatePhysics(dt) {
  const WALL_RESTITUTION = 1.0;
  const PARTICLE_RESTITUTION = 1.0;
  const FLOOR_Y = 690;

  const pumpX = 955;
  const pumpY = 508;

  const pumpRects = [
    { x: pumpX - 92, y: pumpY + 178, w: 184, h: 18 },
    { x: pumpX - 14, y: pumpY - 182, w: 28, h: 208 },
    { x: pumpX - 74, y: pumpY - 188, w: 148, h: 50 },
    { x: pumpX + 44, y: pumpY - 4, w: 92, h: 16 },
  ];

  const keepParticleSpeed = (p) => {
    const targetSpeed = p.baseSpeed || 110;
    const v = Math.hypot(p.vx, p.vy) || 1;
    p.vx = (p.vx / v) * targetSpeed;
    p.vy = (p.vy / v) * targetSpeed;
  };

  const pumpEllipse = {
    x: pumpX,
    y: pumpY - 240,
    rx: 56,
    ry: 68,
  };

  const applyInelasticBounce = (p, nx, ny, restitution = WALL_RESTITUTION) => {
    const vn = p.vx * nx + p.vy * ny;
    if (vn >= 0) return;
    p.vx -= (1 + restitution) * vn * nx;
    p.vy -= (1 + restitution) * vn * ny;
  };

  const collideWithRect = (p, rect, restitution = WALL_RESTITUTION) => {
    const nearestX = clamp(p.x, rect.x, rect.x + rect.w);
    const nearestY = clamp(p.y, rect.y, rect.y + rect.h);
    const dx = p.x - nearestX;
    const dy = p.y - nearestY;
    const distSq = dx * dx + dy * dy;

    if (distSq >= p.r * p.r) return;

    let nx = 0;
    let ny = 0;
    const dist = Math.sqrt(distSq);

    if (dist > 0.0001) {
      nx = dx / dist;
      ny = dy / dist;
      const overlap = p.r - dist;
      p.x += nx * overlap;
      p.y += ny * overlap;
    } else {
      const leftPen = Math.abs(p.x - rect.x);
      const rightPen = Math.abs(rect.x + rect.w - p.x);
      const topPen = Math.abs(p.y - rect.y);
      const bottomPen = Math.abs(rect.y + rect.h - p.y);
      const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);

      if (minPen === leftPen) {
        nx = -1;
        p.x = rect.x - p.r;
      } else if (minPen === rightPen) {
        nx = 1;
        p.x = rect.x + rect.w + p.r;
      } else if (minPen === topPen) {
        ny = -1;
        p.y = rect.y - p.r;
      } else {
        ny = 1;
        p.y = rect.y + rect.h + p.r;
      }
    }

    applyInelasticBounce(p, nx, ny, restitution);
  };

  const collideWithEllipse = (p, ellipse, restitution = WALL_RESTITUTION) => {
    const dx = p.x - ellipse.x;
    const dy = p.y - ellipse.y;

    const rx = ellipse.rx + p.r;
    const ry = ellipse.ry + p.r;

    const q = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (q <= 1) {
      const angle = Math.atan2(dy / ry, dx / rx);
      const boundaryX = ellipse.x + Math.cos(angle) * rx;
      const boundaryY = ellipse.y + Math.sin(angle) * ry;

      const nxRaw = (boundaryX - ellipse.x) / (rx * rx);
      const nyRaw = (boundaryY - ellipse.y) / (ry * ry);
      const nLen = Math.hypot(nxRaw, nyRaw) || 1;
      const nx = nxRaw / nLen;
      const ny = nyRaw / nLen;

      p.x = boundaryX;
      p.y = boundaryY;
      applyInelasticBounce(p, nx, ny, restitution);
    }
  };

  const collideParticlePair = (a, b, restitution = PARTICLE_RESTITUTION) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const minDist = a.r + b.r;
    const distSq = dx * dx + dy * dy;

    if (distSq === 0 || distSq >= minDist * minDist) return;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;

    if (velAlongNormal > 0) return;

    const impulse = -(1 + restitution) * velAlongNormal / 2;

    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
  };

  const resolveJoinedSphereCollision = (p, prevX, prevY) => {
    const dx = p.x - sim.sphereX;
    const dy = p.y - sim.sphereY;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const angle = Math.atan2(dy, dx);

    if (isInValveOpening(angle)) return;

    const prevDx = prevX - sim.sphereX;
    const prevDy = prevY - sim.sphereY;
    const prevDist = Math.hypot(prevDx, prevDy) || dist;

    const outerBound = sim.r + p.r;
    const innerBound = innerRadius() - p.r;
    const wasInside = prevDist <= innerBound + 0.5;

    if (wasInside) {
      if (dist > innerBound) {
        const ox = dx / dist;
        const oy = dy / dist;

        p.x = sim.sphereX + ox * innerBound;
        p.y = sim.sphereY + oy * innerBound;

        // Für die Innenwand muss die Normale nach innen zeigen
        applyInelasticBounce(p, -ox, -oy, 1);
      }
    } else {
      if (dist < outerBound && dist > innerBound) {
        const nx = dx / dist;
        const ny = dy / dist;
        p.x = sim.sphereX + nx * outerBound;
        p.y = sim.sphereY + ny * outerBound;
        applyInelasticBounce(p, nx, ny, 1);
      }
    }
  };

  const resolveOpenHemisphereCollision = (p, prevX, prevY, center, isLeft) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = Math.hypot(dx, dy) || 0.0001;

    const prevDx = prevX - center.x;
    const prevDy = prevY - center.y;
    const prevDist = Math.hypot(prevDx, prevDy) || dist;

    const outerBound = sim.r + p.r;
    const innerBound = innerRadius() - p.r;

    const onClosedSideNow = isLeft ? p.x <= center.x : p.x >= center.x;
    const onClosedSidePrev = isLeft ? prevX <= center.x : prevX >= center.x;
    const wasInside = onClosedSidePrev && prevDist <= innerBound + 0.5;

    if (wasInside) {
      if (onClosedSideNow && dist > innerBound) {
        const ox = dx / dist;
        const oy = dy / dist;

        p.x = center.x + ox * innerBound;
        p.y = center.y + oy * innerBound;

        // Für die Innenwand muss die Normale nach innen zeigen
        applyInelasticBounce(p, -ox, -oy, 1);
      }
      return;
    }

    if (onClosedSideNow && dist < outerBound && dist > innerBound) {
      const nx = dx / dist;
      const ny = dy / dist;
      p.x = center.x + nx * outerBound;
      p.y = center.y + ny * outerBound;
      applyInelasticBounce(p, nx, ny, 1);
    }
  };

  if (sim.joined) {
    if (!sim.valveClosed) {
      sim.innerPressure += (OUTER_P - sim.innerPressure) * FAST_EQUALIZE * dt;
    } else if (!sim.hoseConnected) {
      sim.innerPressure += (OUTER_P - sim.innerPressure) * SLOW_LEAK * dt;
    }

    if (Math.abs(OUTER_P - sim.innerPressure) < 2) sim.innerPressure = OUTER_P;
  } else {
    sim.innerPressure = OUTER_P;
    sim.targetPressure = OUTER_P;
  }

  sim.gaugePressure += (sim.targetPressure - sim.gaugePressure) * Math.min(1, dt * 3.2);
  sim.targetPressure += (sim.innerPressure - sim.targetPressure) * Math.min(1, dt * 2.7);

  if (sim.pumpStrokeAnim > 0) sim.pumpStrokeAnim = Math.max(0, sim.pumpStrokeAnim - dt * 1.6);

  sim.particles.forEach((p) => {
    const prevX = p.x;
    const prevY = p.y;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < 18 + p.r) {
      p.x = 18 + p.r;
      applyInelasticBounce(p, 1, 0);
    } else if (p.x > W - 18 - p.r) {
      p.x = W - 18 - p.r;
      applyInelasticBounce(p, -1, 0);
    }

    if (p.y < 70 + p.r) {
      p.y = 70 + p.r;
      applyInelasticBounce(p, 0, 1);
    } else if (p.y > FLOOR_Y - p.r) {
      p.y = FLOOR_Y - p.r;
      applyInelasticBounce(p, 0, -1);
    }

    if (sim.joined) {
      resolveJoinedSphereCollision(p, prevX, prevY);
    } else {
      resolveOpenHemisphereCollision(p, prevX, prevY, leftCenter(), true);
      resolveOpenHemisphereCollision(p, prevX, prevY, rightCenter(), false);
    }

    pumpRects.forEach((rect) => collideWithRect(p, rect, 0.65));
    collideWithEllipse(p, pumpEllipse, 0.65);

    keepParticleSpeed(p);
  });

  for (let i = 0; i < sim.particles.length; i += 1) {
    for (let j = i + 1; j < sim.particles.length; j += 1) {
      collideParticlePair(sim.particles[i], sim.particles[j], 0.68);
    }
  }

  sim.exhaustParticles = sim.exhaustParticles.filter((p) => {
    p.t += dt * p.speed;
    return p.t < 1;
  });

  if (sim.pullResetAnim) {
    sim.pullForce = Math.max(0, sim.pullForce - sim.pullResetSpeed * dt * 1000);
    ui.pullForce.value = sim.pullForce;

    if (sim.pullForce <= 0) {
      sim.pullForce = 0;
      ui.pullForce.value = 0;
      sim.pullResetAnim = false;
    }
  }

  maybeSeparate('Durch eindringende Luft ist die Druckdifferenz zu klein geworden. Mit der Zeit lassen sich die Halbkugeln wieder trennen.');
  if (performance.now() > sim.hintUntil) ui.hintBubble.classList.remove('visible');
  updateReadouts();

  if (sim.breakAnim && sim.breakAnim.active) {
    const anim = sim.breakAnim;
    sim.openGap += anim.velocity * dt;
    anim.velocity *= Math.exp(-anim.damping * dt);

    if (sim.openGap >= 150) {
      sim.openGap = 150;
      anim.active = false;
    }
  }

  if (sim.closeAnim && sim.closeAnim.active) {
    const anim = sim.closeAnim;

    sim.openGap -= anim.velocity * dt;
    anim.velocity *= Math.exp(-anim.damping * dt);

    if (sim.openGap <= 0) {
      sim.openGap = 0;
      sim.joined = true;
      anim.active = false;
      updateReadouts();
    }
  }
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#fefefe');
  grad.addColorStop(1, '#edf3f7');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c6a079';
  ctx.fillRect(0, 720, W, 180);
  ctx.fillStyle = '#b08458';
  ctx.fillRect(110, 690, W - 220, 24);
  ctx.fillStyle = '#8d6947';
  ctx.fillRect(98, 714, W - 196, 12);
  ctx.strokeStyle = 'rgba(116,87,61,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 86, 720);
    ctx.lineTo(i * 86 - 18, H);
    ctx.stroke();
  }
  for (let y = 752; y < H; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

function drawLabels() {
}

function drawPump() {
  const x = 955;
  const y = 508;
  const strokeT = 1 - sim.pumpStrokeAnim;
  const pulse = Math.sin(Math.min(1, strokeT) * Math.PI);
  const handleAngle = -0.22 + pulse * 0.35;
  const pistonY = -162 + pulse * 52;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#6a4b35';
  ctx.fillRect(-92, 178, 184, 18);
  ctx.strokeStyle = '#21252a';
  ctx.lineWidth = 12;
  [[-52, 174, -12], [0, 174, 0], [52, 174, 12]].forEach(([lx, ly, rot]) => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(rot * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -184);
    ctx.stroke();
    ctx.restore();
  });
  ctx.lineWidth = 28;
  ctx.strokeStyle = '#8b5f3b';
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.lineTo(0, -182);
  ctx.stroke();
  ctx.strokeStyle = '#d2a37c';
  ctx.lineWidth = 2;
  for (let yy = 8; yy > -160; yy -= 28) {
    ctx.beginPath();
    ctx.moveTo(-12, yy);
    ctx.lineTo(12, yy);
    ctx.stroke();
  }
  ctx.fillStyle = '#9b6841';
  ctx.beginPath();
  ctx.moveTo(-44, -188);
  ctx.lineTo(44, -188);
  ctx.lineTo(74, -138);
  ctx.lineTo(-74, -138);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(213,226,234,0.45)';
  ctx.strokeStyle = 'rgba(116,128,137,0.8)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(0, -240, 56, 68, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#9b6841';
  ctx.fillRect(-16, -204, 32, 32);
  ctx.fillStyle = '#7b8690';
  ctx.fillRect(-22, pistonY, 44, 24);
  ctx.strokeStyle = '#202327';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(44, 18);
  ctx.lineTo(132, 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(136, 4, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#202327';
  ctx.fill();
  ctx.restore();
}

function drawHose() {
  if (!sim.hoseConnected) return;
  ctx.strokeStyle = '#bbc2c7';
  ctx.lineWidth = 10;
  ctx.beginPath();
  const p0 = hosePoint(0);
  ctx.moveTo(p0.x, p0.y);
  for (let t = 0.02; t <= 1.001; t += 0.02) {
    const p = hosePoint(t);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawValve() {
  const left = leftCenter();

  const x = left.x + sim.r - 225;
  const y = left.y - sim.r + 50;

  ctx.fillStyle = '#6e5037';
  ctx.beginPath();
  ctx.arc(x, y + 10, 22, 0, Math.PI * 2);
  ctx.fill();

  const cx = x;
  const cy = y + 10; // Mittelpunkt des Kreises!

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();

  if (sim.valveClosed) {
    // geschlossen = rotes "/"
    ctx.strokeStyle = '#c62828';
    ctx.moveTo(cx - 9, cy + 9);
    ctx.lineTo(cx + 9, cy - 9);
  } else {
    // offen = weißes "\"
    ctx.strokeStyle = '#ffffff';
    ctx.moveTo(cx - 9, cy - 9);
    ctx.lineTo(cx + 9, cy + 9);
  }

  ctx.stroke();
  
  ctx.fillStyle = '#44515d';
  ctx.font = '600 16px Arial';
  ctx.fillText(`${sim.valveClosed ? 'geschlossen' : 'offen'}`, x - 56, y - 18);
}

function drawGauge() {
  if (!sim.showGauge) return;
  const x = 1060;
  const y = 160;
  const r = 76;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#73818d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i <= 10; i += 1) {
    const a = Math.PI * (0.75 + i * 0.15);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (r - 18), Math.sin(a) * (r - 18));
    ctx.lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
    ctx.stroke();
  }
  ctx.fillStyle = '#25323e';
  ctx.font = '700 14px Arial';
  ctx.fillText('Druck', -18, -88);
  ctx.font = '600 13px Arial';
  ctx.fillText(`${Math.round(sim.gaugePressure / 100)} hPa`, -32, 54);
  const ratio = clamp((sim.gaugePressure - MIN_P) / (OUTER_P - MIN_P), 0, 1);
  const ang = Math.PI * (0.75 + 1.5 * ratio);
  ctx.strokeStyle = '#be3b2e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(ang) * (r - 20), Math.sin(ang) * (r - 20));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#be3b2e';
  ctx.fill();
  ctx.restore();
}

function drawForceMeter(x, y, force) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f7fafc';
  ctx.strokeStyle = '#7b8c99';
  ctx.lineWidth = 3;
  roundRect(ctx, 0, -24, 116, 48, 16, true, true);
  ctx.fillStyle = '#25323e';
  ctx.font = '600 18px Arial';
  ctx.fillText(formatForce(force), 14, 7);
  ctx.beginPath();
  ctx.moveTo(116, 0);
  ctx.lineTo(160, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(166, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawForceMeterRight(x, y, force) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f7fafc';
  ctx.strokeStyle = '#7b8c99';
  ctx.lineWidth = 3;
  roundRect(ctx, 44, -24, 116, 48, 16, true, true);
  ctx.fillStyle = '#25323e';
  ctx.font = '600 18px Arial';
  ctx.fillText(formatForce(force), 58, 7);
  ctx.beginPath();
  ctx.moveTo(44, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-6, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRopesAndMeters() {
  const left = leftCenter();
  const right = rightCenter();
  ctx.strokeStyle = '#294866';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(34, sim.sphereY);
  ctx.lineTo(left.x - sim.r, left.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W - 34, sim.sphereY);
  ctx.lineTo(right.x + sim.r, right.y);
  ctx.stroke();
  drawForceMeter(54, sim.sphereY - 58, sim.pullForce);
  drawForceMeterRight(W - 214, sim.sphereY - 58, sim.pullForce);
}

function drawParticleCloud(list, color) {
  ctx.fillStyle = color;
  list.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawExhaustParticles() {
  if (!sim.showMolecules) return;
  ctx.fillStyle = 'rgba(37,111,170,0.82)';
  sim.exhaustParticles.forEach((ep) => {
    const p = hosePoint(ep.t);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ep.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function getSphereBrassGradient(x, y, r) {
  const metallic = ctx.createRadialGradient(
    x - 40,
    y - 60,
    10,
    x,
    y,
    r + 30
  );
  metallic.addColorStop(0, '#e1bb89');
  metallic.addColorStop(0.35, '#b37e4c');
  metallic.addColorStop(1, '#6e5037');
  return metallic;
}

function drawHemisphere(center, isLeft) {
  ctx.save();

  const start = isLeft ? Math.PI / 2 : -Math.PI / 2;
  const end = isLeft ? (3 * Math.PI) / 2 : Math.PI / 2;
  const ir = innerRadius();

  const metallic = ctx.createRadialGradient(
    center.x - 40,
    center.y - 60,
    10,
    center.x,
    center.y,
    sim.r + 30
  );
  metallic.addColorStop(0, '#e1bb89');
  metallic.addColorStop(0.35, '#b37e4c');
  metallic.addColorStop(1, '#6e5037');

  // Außenform der Halbkugel
  ctx.beginPath();
  ctx.arc(center.x, center.y, sim.r, start, end);
  ctx.closePath();
  ctx.fillStyle = metallic;
  ctx.fill();

  // Außenkontur exakt wie bei der geschlossenen Kugel
  ctx.strokeStyle = '#5a4330';
  ctx.lineWidth = 4;
  ctx.stroke();

  if (!sim.showCutaway) {
    ctx.restore();
    return;
  }

  // Innenraum sichtbar machen
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, ir, start, end);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = 'rgba(204,231,246,0.55)';
  ctx.beginPath();
  ctx.arc(center.x, center.y, ir, 0, Math.PI * 2);
  ctx.fill();

  if (sim.showMolecules) {
    drawParticleCloud(
      sim.particles.filter((p) =>
        isInsideOpenHemisphereInterior(p.x, p.y, center, isLeft, p.r)
      ),
      'rgba(37,111,170,0.9)'
    );
  }

  ctx.restore();

  // Schalenrand der Halbkugel mit derselben Messingfärbung
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, sim.r, start, end);
  ctx.arc(center.x, center.y, ir, end, start, true);
  ctx.closePath();
  ctx.fillStyle = metallic;
  ctx.fill();

  // Äußere und innere Kontur gleich stark wie bei der geschlossenen Kugel
  ctx.strokeStyle = '#5a4330';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(center.x, center.y, sim.r, start, end);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center.x, center.y, ir, start, end);
  ctx.stroke();
  ctx.restore();

  // Trennlinie/Schnittkante exakt wie bei der geschlossenen Kugel
  ctx.save();
  ctx.strokeStyle = 'rgba(92,68,48,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - sim.r);
  ctx.lineTo(center.x, center.y + sim.r);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawClosedSphere() {
  ctx.fillStyle = getSphereBrassGradient(sim.sphereX, sim.sphereY, sim.r);
  ctx.beginPath();
  ctx.arc(sim.sphereX, sim.sphereY, sim.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#5a4330';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Mittlere Trennlinie nur ohne Querschnitt anzeigen
  if (!sim.showCutaway) {
    ctx.strokeStyle = 'rgba(92,68,48,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sim.sphereX, sim.sphereY - sim.r);
    ctx.lineTo(sim.sphereX, sim.sphereY + sim.r);
    ctx.stroke();
  }
}

function drawCutawayInterior() {
  if (!sim.showCutaway || !sim.joined) return;

  const ir = innerRadius();

  ctx.save();

  // Ganze Innenfläche sichtbar machen
  ctx.beginPath();
  ctx.arc(sim.sphereX, sim.sphereY, ir, 0, Math.PI * 2);
  ctx.clip();

  // Innenfarbe exakt wie bei den geöffneten Halbkugeln
  ctx.fillStyle = 'rgba(204,231,246,0.55)';
  ctx.beginPath();
  ctx.arc(sim.sphereX, sim.sphereY, ir, 0, Math.PI * 2);
  ctx.fill();

  if (sim.showMolecules) {
    drawParticleCloud(
      sim.particles.filter((p) => isInsideJoinedInterior(p.x, p.y, p.r)),
      'rgba(37,111,170,0.9)'
    );
  }

  ctx.restore();

  // Innere Kreisbegrenzung der Schnittfläche
  ctx.save();
  ctx.strokeStyle = '#5a4330';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(sim.sphereX, sim.sphereY, ir, 0, Math.PI * 2);
  ctx.stroke();

  // Dünne Mittellinie wie bei der geschlossenen Kugel beibehalten
  ctx.strokeStyle = 'rgba(92,68,48,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sim.sphereX, sim.sphereY - sim.r);
  ctx.lineTo(sim.sphereX, sim.sphereY + sim.r);
  ctx.stroke();

  ctx.restore();
}

function drawOutsideParticles() {
  if (!sim.showMolecules) return;

  const visible = sim.showCutaway && sim.joined
    ? sim.particles.filter((p) => !isInsideJoinedInterior(p.x, p.y, p.r))
    : sim.particles;

  drawParticleCloud(visible, 'rgba(41,84,129,0.46)');
}

function drawPullArrows() {
  if (!sim.showForces) return;
  if (sim.pullForce > 0) {
    const len = Math.min(180, 36 + sim.pullForce / 850);
    drawArrow(leftCenter().x - sim.r + 6, sim.sphereY + 40, leftCenter().x - sim.r - len, sim.sphereY + 40, '#c0392b', formatForce(sim.pullForce));
  }
  if (sim.pullForce > 0) {
    const len = Math.min(180, 36 + sim.pullForce / 850);
    drawArrow(rightCenter().x + sim.r - 6, sim.sphereY + 40, rightCenter().x + sim.r + len, sim.sphereY + 40, '#c0392b', formatForce(sim.pullForce));
  }
}

function drawPressureArrows() {
  const MIN_VISIBLE_DELTA_P = 1000; // 1000 Pa = 10 hPa

  if (!sim.showForces || !sim.joined || displayDeltaP() < MIN_VISIBLE_DELTA_P) return;

  const ratio = clamp(displayDeltaP() / OUTER_P, 0, 1);
  const arrowLen = 18 + ratio * 46;
  const angles = [-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180, 0];

  angles.forEach((deg) => {
    const a = deg * Math.PI / 180;
    const sx = sim.sphereX + Math.cos(a) * (sim.r + 12 + arrowLen);
    const sy = sim.sphereY + Math.sin(a) * (sim.r + 12 + arrowLen);
    const ex = sim.sphereX + Math.cos(a) * (sim.r + 6);
    const ey = sim.sphereY + Math.sin(a) * (sim.r + 6);
    drawArrow(sx, sy, ex, ey, '#11953c');
  });
}

function drawArrow(x1, y1, x2, y2, color, label = '') {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 12 * Math.cos(ang - Math.PI / 6), y2 - 12 * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(x2 - 12 * Math.cos(ang + Math.PI / 6), y2 - 12 * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = '600 16px Arial';
    ctx.fillText(label, (x1 + x2) / 2 - 18, (y1 + y2) / 2 - 10);
  }
}

function roundRect(ctxRef, x, y, w, h, r, fill, stroke) {
  ctxRef.beginPath();
  ctxRef.moveTo(x + r, y);
  ctxRef.arcTo(x + w, y, x + w, y + h, r);
  ctxRef.arcTo(x + w, y + h, x, y + h, r);
  ctxRef.arcTo(x, y + h, x, y, r);
  ctxRef.arcTo(x, y, x + w, y, r);
  if (fill) ctxRef.fill();
  if (stroke) ctxRef.stroke();
}

function drawScene() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawLabels();
  drawOutsideParticles();
  drawHose();
  drawGauge();
  drawRopesAndMeters();

  if (sim.joined) {
    drawClosedSphere();
    drawCutawayInterior();
  } else {
    drawHemisphere(leftCenter(), true);
    drawHemisphere(rightCenter(), false);
  }

  drawValve();
  drawExhaustParticles();
  drawPressureArrows();
  drawPullArrows();
}

let lastTime = performance.now();
function animate(now) {
  const dt = Math.min(0.03, (now - lastTime) / 1000);
  lastTime = now;
  updatePhysics(dt);
  drawScene();
  requestAnimationFrame(animate);
}

resetSimulation();
requestAnimationFrame(animate);

const header = document.querySelector('.site-header');
let lastScrollY = 0;
let ticking = false;

function updateHeaderVisibility() {
  if (!header) return;

  const currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  const delta = currentScrollY - lastScrollY;

  // Ganz oben soll der Header immer sichtbar sein
  if (currentScrollY <= 10) {
    header.classList.remove('hide');
    lastScrollY = currentScrollY;
    ticking = false;
    return;
  }

  // Nur auf echte Scrollbewegungen reagieren, damit es nicht flackert
  if (Math.abs(delta) < 6) {
    ticking = false;
    return;
  }

  if (delta > 0) {
    // nach unten gescrollt
    header.classList.add('hide');
  } else {
    // nach oben gescrollt
    header.classList.remove('hide');
  }

  lastScrollY = currentScrollY;
  ticking = false;
}

window.addEventListener('scroll', () => {
  if (!ticking) {
    window.requestAnimationFrame(updateHeaderVisibility);
    ticking = true;
  }
}, { passive: true });

window.addEventListener('load', () => {
  lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  updateHeaderVisibility();
});
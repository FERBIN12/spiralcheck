// SpiralCheck UI. All processing happens in this tab; history lives in localStorage.
import { analyze, synthSpiral } from './src/spiral.js';

const HISTORY_KEY = 'spiralcheck.history.v1';
const HISTORY_MAX = 300;
const TURNS = 3;
const PX_PER_MM = 96 / 25.4; // nominal CSS pixels per mm

const $ = (id) => document.getElementById(id);
const pad = $('pad');
const ctx = pad.getContext('2d');
const btnAnalyze = $('btn-analyze');
const btnClear = $('btn-clear');
const btnDemo = $('btn-demo');
const btnTrace = $('btn-trace');
const statusEl = $('status');

let size = 0; // CSS px of the square pad
let guide = { cx: 0, cy: 0, b: 0 };
let points = []; // {x, y, t} in CSS px and ms
let drawing = false;
let rect = null;
let demoRunning = false;
let lastResult = null;
let lastTrace = null;

// ------------------------------------------------------------ canvas setup

function fitCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

function resizePad() {
  const newSize = pad.getBoundingClientRect().width;
  if (!newSize) return;
  const scale = size ? newSize / size : 1;
  if (size && scale !== 1) {
    points = points.map((p) => ({ x: p.x * scale, y: p.y * scale, t: p.t }));
    if (lastResult && lastResult.ok) {
      lastResult.center = { x: lastResult.center.x * scale, y: lastResult.center.y * scale };
      lastResult.a *= scale;
      lastResult.b *= scale;
    }
  }
  size = newSize;
  fitCanvas(pad, size, size);
  guide = { cx: size / 2, cy: size / 2, b: (size * 0.43) / (2 * Math.PI * TURNS) };
  redraw();
}

function spiralPath(c, cx, cy, a, b, th0, th1, sign = 1) {
  c.beginPath();
  const steps = 600;
  for (let i = 0; i <= steps; i++) {
    const th = th0 + ((th1 - th0) * i) / steps;
    const r = a + b * th;
    const x = cx + r * Math.cos(sign * th);
    const y = cy + r * Math.sin(sign * th);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
}

function redraw() {
  ctx.clearRect(0, 0, size, size);
  // guide
  ctx.lineWidth = Math.max(10, size / 45);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#e4e9e8';
  spiralPath(ctx, guide.cx, guide.cy, 0, guide.b, 0, 2 * Math.PI * TURNS);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#b9c4c3';
  ctx.setLineDash([6, 6]);
  spiralPath(ctx, guide.cx, guide.cy, 0, guide.b, 0, 2 * Math.PI * TURNS);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#0b5f5b';
  ctx.beginPath();
  ctx.arc(guide.cx, guide.cy, 5, 0, 2 * Math.PI);
  ctx.fill();

  // fitted spiral from the last analysis
  if (lastResult && lastResult.ok && points.length) {
    const r = lastResult;
    const th = r.fitTheta;
    ctx.strokeStyle = 'rgba(11, 95, 91, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    spiralPath(ctx, r.center.x, r.center.y, r.a, r.b, th[0], th[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // user trace
  if (points.length > 1) {
    ctx.strokeStyle = '#1b2830';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
}

function drawSegment(from, list) {
  if (!list.length) return;
  ctx.strokeStyle = '#1b2830';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (const p of list) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

// ------------------------------------------------------------- drawing input

function toPoint(ev) {
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: ev.timeStamp };
}

pad.addEventListener('pointerdown', (e) => {
  if (demoRunning) return;
  e.preventDefault();
  if (lastResult) { // start a fresh drawing after a finished one
    points = [];
    lastResult = null;
    redraw();
  }
  rect = pad.getBoundingClientRect();
  pad.setPointerCapture(e.pointerId);
  drawing = true;
  points.push(toPoint(e));
  setStatus('Drawing... press Analyze when you reach the outside.');
});

pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  const list = (evs.length ? evs : [e]).map(toPoint);
  const from = points[points.length - 1];
  points.push(...list);
  drawSegment(from, list);
});

function endStroke() {
  if (!drawing) return;
  drawing = false;
  updateButtons();
}
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);

// -------------------------------------------------------------- analysis

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function updateButtons() {
  btnAnalyze.disabled = demoRunning || points.length < 2 || !!lastResult;
  btnClear.disabled = demoRunning;
  btnDemo.disabled = demoRunning;
  btnTrace.disabled = !lastTrace;
}

function runAnalysis({ isDemo = false } = {}) {
  const res = analyze(points, { center: { x: guide.cx, y: guide.cy } });
  if (!res.ok) {
    setStatus(res.reason, true);
    return;
  }
  // remember the angular range used by the fit for the overlay
  const th = fitAngles(res);
  lastResult = { ...res, fitTheta: th, isDemo };
  lastTrace = { points: points.slice(), isDemo, when: new Date().toISOString() };
  redraw();
  renderReport(lastResult);
  if (!isDemo) saveHistory(lastResult);
  setStatus(isDemo ? 'Demo analyzed. This result is not saved to history.' : 'Analyzed and saved to your history on this device.');
  updateButtons();
  $('report').focus({ preventScroll: true });
}

// Angular range of the trace around the fitted center, unwrapped.
function fitAngles(res) {
  let prev = null;
  let acc = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const r = Math.hypot(p.x - res.center.x, p.y - res.center.y);
    if (r < 10) continue;
    const a = Math.atan2(p.y - res.center.y, p.x - res.center.x);
    if (prev === null) acc = a;
    else {
      let d = a - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      acc += d;
    }
    prev = a;
    lo = Math.min(lo, acc);
    hi = Math.max(hi, acc);
  }
  return [lo, hi];
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const mm = (px) => fmt(px / PX_PER_MM, 2);

function renderReport(r) {
  $('report-empty').hidden = true;
  $('report-body').hidden = false;
  $('r-score').textContent = r.score;
  const tr = r.tremor;
  $('r-freq').innerHTML = tr.detected
    ? `${fmt(tr.freq, 1)} Hz<small>rhythmic, ${Math.round(tr.ratio * 100)}% of 3 to 15 Hz power</small>`
    : `none clear<small>strongest: ${fmt(tr.freq, 1)} Hz, ${Math.round(tr.ratio * 100)}% of band</small>`;
  $('r-amp').innerHTML = `${fmt(tr.amp, 2)} px<small>about ${mm(tr.amp)} mm</small>`;
  $('r-rms').innerHTML = `${fmt(r.rmsDev, 2)} px<small>${fmt((100 * r.rmsDev) / r.loopSpacing, 1)}% of loop spacing</small>`;
  $('r-max').innerHTML = `${fmt(r.maxDev, 1)} px<small>about ${mm(r.maxDev)} mm</small>`;
  $('r-speed').innerHTML = `${Math.round(r.meanSpeed)} px/s<small>${fmt(r.durationS, 1)} s, ${fmt(r.turns, 1)} turns</small>`;
  const even = Number.isFinite(r.tightnessCV) ? Math.max(0, 100 * (1 - r.tightnessCV)) : NaN;
  $('r-tight').innerHTML = `${fmt(even, 0)}%<small>loop spacing ${fmt(r.loopSpacing, 0)} px</small>`;

  let summary;
  if (r.score >= 80) summary = 'Smooth, even spiral.';
  else if (r.score >= 60) summary = 'Mostly smooth, with some wobble.';
  else summary = 'Noticeable wobble in this drawing.';
  if (tr.detected) summary += ` A regular rhythm near ${fmt(tr.freq, 1)} Hz was found in the trace.`;
  summary += r.isDemo ? ' (Synthetic demo drawing.)' : ' Compare against your own past results, not against other people.';
  $('r-summary').textContent = summary;

  plotError(r);
  plotSpectrum(r);
}

function plotFrame(canvas) {
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;
  const c = fitCanvas(canvas, w, h);
  c.clearRect(0, 0, w, h);
  c.font = '12px system-ui, sans-serif';
  return { c, w, h, pad: { l: 40, r: 12, t: 10, b: 24 } };
}

function plotError(r) {
  const { c, w, h, pad: p } = plotFrame($('plot-err'));
  const t = r.series.t;
  const e = r.series.err;
  if (!t.length) return;
  const ext = Math.max(1, ...e.map(Math.abs)) * 1.1;
  const X = (v) => p.l + ((w - p.l - p.r) * v) / t[t.length - 1];
  const Y = (v) => p.t + ((h - p.t - p.b) * (ext - v)) / (2 * ext);
  c.strokeStyle = '#dcdfdc';
  c.beginPath(); c.moveTo(p.l, Y(0)); c.lineTo(w - p.r, Y(0)); c.stroke();
  c.fillStyle = '#55636b';
  c.fillText(`+${fmt(ext, 1)}`, 4, Y(ext) + 10);
  c.fillText(`-${fmt(ext, 1)}`, 4, Y(-ext));
  c.fillText('0', 26, Y(0) + 4);
  c.fillText(`${fmt(t[t.length - 1], 1)} s`, w - p.r - 34, h - 6);
  c.fillText('0 s', p.l, h - 6);
  c.strokeStyle = '#0b5f5b';
  c.lineWidth = 1.4;
  c.beginPath();
  for (let i = 0; i < t.length; i++) { if (i === 0) c.moveTo(X(t[i]), Y(e[i])); else c.lineTo(X(t[i]), Y(e[i])); }
  c.stroke();
}

function plotSpectrum(r) {
  const { c, w, h, pad: p } = plotFrame($('plot-spec'));
  const fMax = 20;
  const f = r.spectrum.f;
  const psd = r.spectrum.psd;
  let pMax = 0;
  for (let i = 0; i < f.length; i++) if (f[i] >= 2 && f[i] <= fMax) pMax = Math.max(pMax, psd[i]);
  pMax = pMax || 1;
  const X = (v) => p.l + ((w - p.l - p.r) * v) / fMax;
  const Y = (v) => p.t + (h - p.t - p.b) * (1 - Math.min(1, v / pMax));
  c.fillStyle = '#e3efed';
  c.fillRect(X(4), p.t, X(12) - X(4), h - p.t - p.b);
  c.fillStyle = '#55636b';
  for (const v of [0, 4, 8, 12, 16, 20]) c.fillText(`${v}`, X(v) - 4, h - 6);
  c.fillText('Hz', w - p.r - 14, p.t + 10);
  c.strokeStyle = '#dcdfdc';
  c.beginPath(); c.moveTo(p.l, Y(0)); c.lineTo(w - p.r, Y(0)); c.stroke();
  c.strokeStyle = '#1b2830';
  c.lineWidth = 1.6;
  c.beginPath();
  let started = false;
  for (let i = 0; i < f.length; i++) {
    if (f[i] > fMax) break;
    if (!started) { c.moveTo(X(f[i]), Y(psd[i])); started = true; } else c.lineTo(X(f[i]), Y(psd[i]));
  }
  c.stroke();
  const pf = r.tremor.freq;
  if (Number.isFinite(pf)) {
    c.strokeStyle = r.tremor.detected ? '#8a4b08' : '#9aa6a8';
    c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(X(pf), p.t); c.lineTo(X(pf), h - p.b); c.stroke();
    c.setLineDash([]);
    c.fillStyle = r.tremor.detected ? '#8a4b08' : '#55636b';
    const label = `${fmt(pf, 1)} Hz`;
    c.fillText(label, Math.min(X(pf) + 5, w - p.r - 50), p.t + 12);
  }
}

// ----------------------------------------------------------------- history

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(r) {
  const h = loadHistory();
  h.unshift({
    date: new Date().toISOString(),
    hand: $('hand').value,
    score: r.score,
    tremorHz: Number(r.tremor.freq.toFixed(2)),
    tremorDetected: r.tremor.detected,
    tremorAmpPx: Number(r.tremor.amp.toFixed(3)),
    rmsDevPx: Number(r.rmsDev.toFixed(3)),
    maxDevPx: Number(r.maxDev.toFixed(2)),
    speedPxS: Math.round(r.meanSpeed),
    durationS: Number(r.durationS.toFixed(2)),
    turns: Number(r.turns.toFixed(2)),
    loopSpacingPx: Number(r.loopSpacing.toFixed(2)),
    tightnessCV: Number.isFinite(r.tightnessCV) ? Number(r.tightnessCV.toFixed(4)) : null,
    points: r.n,
  });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX))); } catch { /* storage full or blocked */ }
  renderHistory();
}

function renderHistory() {
  const h = loadHistory();
  const body = $('hist-body');
  body.textContent = '';
  for (const row of h) {
    const tr = document.createElement('tr');
    const cells = [
      new Date(row.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
      row.hand,
      row.score,
      row.tremorDetected ? fmt(row.tremorHz, 1) : `(${fmt(row.tremorHz, 1)})`,
      fmt(row.tremorAmpPx, 2),
      fmt(row.rmsDevPx, 2),
      row.speedPxS,
    ];
    for (const v of cells) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
    body.appendChild(tr);
  }
  $('hist-empty').hidden = h.length > 0;
  $('btn-export').disabled = h.length === 0;
  $('btn-wipe').disabled = h.length === 0;
}

function downloadCSV(name, rows) {
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const text = rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('btn-export').addEventListener('click', () => {
  const h = loadHistory();
  if (!h.length) return;
  const cols = Object.keys(h[0]);
  downloadCSV('spiralcheck-history.csv', [cols, ...h.map((r) => cols.map((c) => r[c]))]);
});

btnTrace.addEventListener('click', () => {
  if (!lastTrace) return;
  const t0 = lastTrace.points[0].t;
  downloadCSV(`spiralcheck-trace${lastTrace.isDemo ? '-demo' : ''}.csv`,
    [['t_ms', 'x_px', 'y_px'], ...lastTrace.points.map((p) => [(p.t - t0).toFixed(2), p.x.toFixed(2), p.y.toFixed(2)])]);
});

$('btn-wipe').addEventListener('click', () => {
  if (!confirm('Delete all saved SpiralCheck results from this browser?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  setStatus('History deleted.');
});

// -------------------------------------------------------------------- demo

function playDemo() {
  if (demoRunning) return;
  demoRunning = true;
  points = [];
  lastResult = null;
  redraw();
  updateButtons();
  $('demo-badge').hidden = false;
  const amp = Math.max(1.5, size / 190);
  setStatus(`Playing a synthetic drawing with a 6 Hz, ${amp.toFixed(1)} px tremor...`);
  const seed = Math.floor(Math.random() * 1e6) + 1;
  const synth = synthSpiral({
    cx: guide.cx, cy: guide.cy, b: guide.b, turns: TURNS, duration: 7,
    tremorHz: 6, tremorAmp: amp, noise: 0.4, drift: 1.5, seed,
  });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = reduce ? 1000 : 2.5; // playback speed-up; timestamps are kept as recorded
  const start = performance.now();
  let i = 0;
  function step(now) {
    const tPlay = (now - start) * speed;
    const from = points[points.length - 1] || synth[0];
    const batch = [];
    while (i < synth.length && synth[i].t <= tPlay) batch.push(synth[i++]);
    points.push(...batch);
    drawSegment(from, batch);
    if (i < synth.length) requestAnimationFrame(step);
    else {
      demoRunning = false;
      $('demo-badge').hidden = true;
      runAnalysis({ isDemo: true });
    }
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- wiring

btnAnalyze.addEventListener('click', () => runAnalysis());
btnClear.addEventListener('click', () => {
  points = [];
  lastResult = null;
  redraw();
  setStatus('');
  updateButtons();
});
btnDemo.addEventListener('click', playDemo);

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizePad();
    if (lastResult) { plotError(lastResult); plotSpectrum(lastResult); }
  }, 120);
});

resizePad();
renderHistory();
updateButtons();
if (new URLSearchParams(location.search).has('demo')) playDemo();

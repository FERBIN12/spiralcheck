// SpiralCheck signal math. Pure ES module: no DOM, no dependencies.
// Works in the browser and in Node (node --test).
//
// Pipeline (see analyze()):
//   1. Fit an ideal Archimedes spiral r = a + b*theta around a center (cx, cy).
//      The center is refined with a small Nelder-Mead search that minimizes the
//      RMS radial residual; theta is unwrapped so it grows continuously.
//   2. Radial error e_i = r_i - (a + b*theta_i) gives deviation stats (RMS, max).
//   3. e(t) is resampled to a uniform rate (default 100 Hz) by linear
//      interpolation and high-pass detrended (two passes of a 0.5 s moving
//      average are subtracted), which removes slow hand drift but keeps 3-15 Hz.
//   4. Welch PSD (Hann window, 50% overlap, own radix-2 FFT) gives the tremor
//      peak frequency (parabolic interpolation) and amplitude (band power).
//   5. Speed, tightness consistency and a heuristic 0-100 smoothness score.

export const DEFAULTS = Object.freeze({
  fs: 100, // resample rate for the radial error, Hz
  minRadius: 10, // ignore points this close to the center (angle is unstable there), px
  bandLow: 3, // tremor search band, Hz
  bandHigh: 15,
  peakHalfWidth: 1.0, // band around the peak used for amplitude, Hz
  nperseg: 256,
  nfft: 1024,
  detrendWindow: 0.5, // s, moving-average window for the high-pass
  detectMinAmp: 0.5, // px, tremor "detected" needs at least this amplitude
  detectMinRatio: 0.4, // ...and this share of 3-15 Hz power near the peak
});

// ---------------------------------------------------------------- utilities

export function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

export function rms(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  return arr.length ? Math.sqrt(s / arr.length) : 0;
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Seeded PRNG (mulberry32) so synthetic drawings are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller). */
export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------- FFT

/** In-place iterative radix-2 complex FFT. re/im length must be a power of 2. */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error('fft: length must be a power of two and re/im equal');
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k + half] * cRe - im[i + k + half] * cIm;
        const aIm = re[i + k + half] * cIm + im[i + k + half] * cRe;
        re[i + k + half] = re[i + k] - aRe;
        im[i + k + half] = im[i + k] - aIm;
        re[i + k] += aRe;
        im[i + k] += aIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n);
  if (n === 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * Welch one-sided power spectral density.
 * Scaling: sum(psd) * df ~= variance of x (units^2 / Hz).
 */
export function welch(x, fs, { nperseg = 256, overlap = 0.5, nfft = 1024 } = {}) {
  const n = x.length;
  const seg = Math.max(8, Math.min(nperseg, n));
  const size = Math.max(nextPow2(nfft), nextPow2(seg));
  const step = Math.max(1, Math.floor(seg * (1 - overlap)));
  const w = hann(seg);
  let u = 0;
  for (let i = 0; i < seg; i++) u += w[i] * w[i];
  const bins = size / 2 + 1;
  const psd = new Float64Array(bins);
  let count = 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start + seg <= n; start += step) {
    let m = 0;
    for (let i = 0; i < seg; i++) m += x[start + i];
    m /= seg;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < seg; i++) re[i] = (x[start + i] - m) * w[i];
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      let p = (re[k] * re[k] + im[k] * im[k]) / (fs * u);
      if (k !== 0 && k !== size / 2) p *= 2;
      psd[k] += p;
    }
    count++;
  }
  if (count > 0) for (let k = 0; k < bins; k++) psd[k] /= count;
  const df = fs / size;
  const f = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = k * df;
  return { f, psd, df, segments: count, nperseg: seg, nfft: size };
}

// -------------------------------------------------------------- resampling

/** Linear interpolation of (t, y) onto a uniform grid at fs. t in seconds, increasing. */
export function resampleUniform(t, y, fs) {
  const n = t.length;
  if (n < 2) return { t: new Float64Array(0), y: new Float64Array(0) };
  const t0 = t[0];
  const count = Math.floor((t[n - 1] - t0) * fs) + 1;
  const ot = new Float64Array(count);
  const oy = new Float64Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const ti = t0 + i / fs;
    while (j < n - 2 && t[j + 1] < ti) j++;
    const dt = t[j + 1] - t[j];
    const alpha = dt > 0 ? Math.min(1, Math.max(0, (ti - t[j]) / dt)) : 0;
    ot[i] = ti - t0;
    oy[i] = y[j] + alpha * (y[j + 1] - y[j]);
  }
  return { t: ot, y: oy };
}

/** Centered moving average with shrinking window at the edges. */
export function movingAverage(x, win) {
  const n = x.length;
  const out = new Float64Array(n);
  const h = Math.floor(win / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - h);
    const hi = Math.min(n, i + h + 1);
    out[i] = (cs[hi] - cs[lo]) / (hi - lo);
  }
  return out;
}

/** High-pass: subtract two cascaded moving averages (a triangular smoother). */
export function highpassDetrend(x, fs, windowSec = 0.5) {
  const win = Math.max(3, Math.round(windowSec * fs));
  const smooth = movingAverage(movingAverage(x, win), win);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - smooth[i];
  return out;
}

// -------------------------------------------------------------- spiral fit

/** Unwrap a sequence of angles so consecutive differences stay in (-pi, pi]. */
export function unwrap(angles) {
  const out = new Float64Array(angles.length);
  if (!angles.length) return out;
  out[0] = angles[0];
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - angles[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    out[i] = out[i - 1] + d;
  }
  return out;
}

function linearFit(x, y) {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i];
  }
  const den = n * sxx - sx * sx;
  if (n < 2 || Math.abs(den) < 1e-12) return { a: n ? sy / n : 0, b: 0 };
  const b = (n * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / n, b };
}

/**
 * Fit r = a + b*theta for a fixed center. Points closer than minRadius to the
 * center are skipped. Returns indices of used points and residuals.
 */
export function fitAtCenter(points, cx, cy, minRadius = DEFAULTS.minRadius) {
  const idx = [];
  const r = [];
  const ang = [];
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - cx;
    const dy = points[i].y - cy;
    const ri = Math.hypot(dx, dy);
    if (ri < minRadius) continue;
    idx.push(i);
    r.push(ri);
    ang.push(Math.atan2(dy, dx));
  }
  const theta = unwrap(ang);
  const { a, b } = linearFit(theta, r);
  const resid = new Float64Array(r.length);
  for (let i = 0; i < r.length; i++) resid[i] = r[i] - (a + b * theta[i]);
  return { cx, cy, a, b, idx, r, theta, resid, rms: rms(resid) };
}

function nelderMead2(fn, start, step = 8, iters = 150) {
  let s = [
    [start[0], start[1]],
    [start[0] + step, start[1]],
    [start[0], start[1] + step],
  ].map((p) => ({ p, v: fn(p) }));
  for (let k = 0; k < iters; k++) {
    s.sort((u, v) => u.v - v.v);
    const [best, mid, worst] = s;
    if (Math.abs(worst.v - best.v) < 1e-9 && Math.hypot(worst.p[0] - best.p[0], worst.p[1] - best.p[1]) < 1e-3) break;
    const c = [(best.p[0] + mid.p[0]) / 2, (best.p[1] + mid.p[1]) / 2];
    const at = (t) => [c[0] + t * (worst.p[0] - c[0]), c[1] + t * (worst.p[1] - c[1])];
    const rp = at(-1);
    const rv = fn(rp);
    if (rv < best.v) {
      const ep = at(-2);
      const ev = fn(ep);
      s[2] = ev < rv ? { p: ep, v: ev } : { p: rp, v: rv };
    } else if (rv < mid.v) {
      s[2] = { p: rp, v: rv };
    } else {
      const cp = at(rv < worst.v ? -0.5 : 0.5);
      const cv = fn(cp);
      if (cv < Math.min(rv, worst.v)) {
        s[2] = { p: cp, v: cv };
      } else {
        s = s.map((q, i) =>
          i === 0 ? q : (() => {
            const p = [best.p[0] + 0.5 * (q.p[0] - best.p[0]), best.p[1] + 0.5 * (q.p[1] - best.p[1])];
            return { p, v: fn(p) };
          })());
      }
    }
  }
  s.sort((u, v) => u.v - v.v);
  return s[0].p;
}

/**
 * Fit an Archimedes spiral to points [{x, y}]. If `center` is given it is used
 * as one starting guess; the first point and the centroid are also tried.
 */
export function fitSpiral(points, { center = null, minRadius = DEFAULTS.minRadius, refineCenter = true } = {}) {
  const cost = (p) => {
    const f = fitAtCenter(points, p[0], p[1], minRadius);
    // Penalize dropping too many points so the search cannot "escape" the drawing.
    return f.idx.length < Math.max(8, points.length * 0.5) ? 1e9 : f.rms;
  };
  const starts = [];
  if (center) starts.push([center.x, center.y]);
  if (points.length) starts.push([points[0].x, points[0].y]);
  starts.push([mean(points.map((p) => p.x)), mean(points.map((p) => p.y))]);
  let best = null;
  for (const s of starts) {
    const p = refineCenter ? nelderMead2(cost, s) : s;
    const v = cost(p);
    if (!best || v < best.v) best = { p, v };
  }
  return fitAtCenter(points, best.p[0], best.p[1], minRadius);
}

// ---------------------------------------------------------------- metrics

/** Coefficient of variation of the per-turn slope |b_k| (0 = perfectly even loops). */
export function tightness(theta, r) {
  const n = theta.length;
  if (n < 20) return { cv: NaN, perTurn: [] };
  const t0 = theta[0];
  const dir = theta[n - 1] >= t0 ? 1 : -1;
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.floor((dir * (theta[i] - t0)) / (2 * Math.PI));
    if (!groups.has(k)) groups.set(k, { x: [], y: [] });
    groups.get(k).x.push(theta[i]);
    groups.get(k).y.push(r[i]);
  }
  const perTurn = [];
  for (const [, g] of [...groups.entries()].sort((p, q) => p[0] - q[0])) {
    if (g.x.length < 10) continue;
    const span = Math.abs(g.x[g.x.length - 1] - g.x[0]);
    if (span < Math.PI) continue; // need at least half a turn for a stable slope
    perTurn.push(Math.abs(linearFit(g.x, g.y).b));
  }
  if (perTurn.length < 2) return { cv: NaN, perTurn };
  const m = mean(perTurn);
  const sd = Math.sqrt(mean(perTurn.map((v) => (v - m) ** 2)));
  return { cv: m > 0 ? sd / m : NaN, perTurn };
}

/** Find the tremor peak in [lo, hi] and its amplitude from the band power. */
export function tremorFromSpectrum(f, psd, df, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let kPeak = -1;
  let total = 0;
  for (let k = 0; k < f.length; k++) {
    if (f[k] < o.bandLow || f[k] > o.bandHigh) continue;
    total += psd[k] * df;
    if (kPeak < 0 || psd[k] > psd[kPeak]) kPeak = k;
  }
  if (kPeak < 0) return { freq: NaN, amp: 0, ratio: 0 };
  // Parabolic interpolation on log power for sub-bin frequency.
  let freq = f[kPeak];
  if (kPeak > 0 && kPeak < f.length - 1) {
    const y0 = Math.log(psd[kPeak - 1] + 1e-300);
    const y1 = Math.log(psd[kPeak] + 1e-300);
    const y2 = Math.log(psd[kPeak + 1] + 1e-300);
    const den = y0 - 2 * y1 + y2;
    if (den < 0) freq += (0.5 * (y0 - y2) / den) * df;
  }
  let band = 0;
  for (let k = 0; k < f.length; k++) {
    if (Math.abs(f[k] - freq) <= o.peakHalfWidth) band += psd[k] * df;
  }
  // A sinusoid of amplitude A has variance A^2 / 2.
  const amp = Math.sqrt(2 * band);
  return { freq, amp, ratio: total > 0 ? Math.min(1, band / total) : 0 };
}

/**
 * Smoothness score, 0-100 (heuristic, NOT clinically validated):
 *   D = rmsDeviation / loopSpacing   (loopSpacing = 2*pi*|b|, px between loops)
 *   T = tremorAmplitude / loopSpacing
 *   C = tightness coefficient of variation (0 if unavailable)
 *   score = round(100 * exp(-(4*D + 8*T + 1*C)))
 * Everything is normalized by loop spacing so the score does not depend on
 * how large the spiral was drawn.
 */
export function smoothnessScore({ rmsDev, tremorAmp, loopSpacing, tightnessCV }) {
  if (!(loopSpacing > 0)) return { score: 0, D: NaN, T: NaN, C: NaN };
  const D = rmsDev / loopSpacing;
  const T = tremorAmp / loopSpacing;
  const C = Number.isFinite(tightnessCV) ? tightnessCV : 0;
  const score = Math.round(100 * Math.exp(-(4 * D + 8 * T + 1 * C)));
  return { score: Math.max(0, Math.min(100, score)), D, T, C };
}

/** Deduplicate timestamps and convert ms -> s. */
function cleanPoints(points) {
  const out = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.t)) continue;
    if (out.length && p.t <= out[out.length - 1].t) continue;
    out.push(p);
  }
  return out;
}

/**
 * Full analysis. points: [{x, y, t}] with x,y in px and t in milliseconds.
 * opts.center: optional {x, y} guess (e.g. the guide spiral center).
 */
export function analyze(points, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const pts = cleanPoints(points);
  if (pts.length < 30) return { ok: false, reason: 'Too few points. Draw a full spiral (at least 2 turns).' };
  const durationS = (pts[pts.length - 1].t - pts[0].t) / 1000;
  if (durationS < 1.5) return { ok: false, reason: 'Drawing too short. Take at least 2 seconds.' };

  const fit = fitSpiral(pts, { center: o.center, minRadius: o.minRadius });
  const turns = Math.abs(fit.theta[fit.theta.length - 1] - fit.theta[0]) / (2 * Math.PI);
  if (turns < 1.5) return { ok: false, reason: 'Spiral too short. Draw at least 2 full turns.' };
  const loopSpacing = 2 * Math.PI * Math.abs(fit.b);

  const absRes = Array.from(fit.resid, Math.abs);
  const rmsDev = rms(fit.resid);
  const maxDev = Math.max(...absRes);

  // Radial error on a uniform time grid, then high-pass.
  const tS = fit.idx.map((i) => (pts[i].t - pts[0].t) / 1000);
  const uni = resampleUniform(tS, fit.resid, o.fs);
  const err = highpassDetrend(uni.y, o.fs, o.detrendWindow);
  const spec = welch(err, o.fs, { nperseg: o.nperseg, nfft: o.nfft });
  const tr = tremorFromSpectrum(spec.f, spec.psd, spec.df, o);

  let path = 0;
  for (let i = 1; i < pts.length; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const meanSpeed = path / durationS;

  const tight = tightness(fit.theta, fit.r);
  const s = smoothnessScore({ rmsDev, tremorAmp: tr.amp, loopSpacing, tightnessCV: tight.cv });

  const keep = spec.f.findIndex((v) => v > 25);
  const cut = keep < 0 ? spec.f.length : keep;
  return {
    ok: true,
    n: pts.length,
    durationS,
    center: { x: fit.cx, y: fit.cy },
    a: fit.a,
    b: fit.b,
    turns,
    loopSpacing,
    rmsDev,
    maxDev,
    pathLength: path,
    meanSpeed,
    tightnessCV: tight.cv,
    perTurnSlope: tight.perTurn,
    tremor: {
      freq: tr.freq,
      amp: tr.amp,
      ratio: tr.ratio,
      detected: tr.amp >= o.detectMinAmp && tr.ratio >= o.detectMinRatio,
    },
    score: s.score,
    scoreParts: { D: s.D, T: s.T, C: s.C },
    series: { t: Array.from(uni.t), err: Array.from(err) },
    spectrum: { f: Array.from(spec.f.slice(0, cut)), psd: Array.from(spec.psd.slice(0, cut)), df: spec.df },
  };
}

// --------------------------------------------------------------- synthesis

/**
 * Synthetic spiral drawing for tests and the in-app demo.
 * Pen moves at roughly constant linear speed along r = a + b*theta.
 * tremorAxis: 'radial' (oscillation along the radius) or 'x' (fixed horizontal axis).
 * drift: slow 0.4 Hz radial wobble amplitude in px (imitates normal hand drift).
 * Returns [{x, y, t}] with t in ms (irregular sample spacing, like pointer events).
 */
export function synthSpiral({
  cx = 300, cy = 300, a = 0, b = 10, turns = 3, duration = 8,
  rate = 120, jitter = 0.3, tremorHz = 0, tremorAmp = 0, tremorPhase = 0,
  tremorAxis = 'radial', noise = 0, drift = 0, seed = 1, clockwise = false,
} = {}) {
  const rng = mulberry32(seed);
  const Theta = 2 * Math.PI * turns;
  const S = a * Theta + (b * Theta * Theta) / 2;
  const pts = [];
  let t = 0;
  while (t <= duration) {
    const u = t / duration;
    // small (5%) speed variation so motion is not perfectly uniform
    const s = S * Math.min(1, u + 0.05 * Math.sin(2 * Math.PI * 0.3 * t) * u * (1 - u));
    const th = b > 0 ? (-a + Math.sqrt(a * a + 2 * b * s)) / b : s / Math.max(a, 1e-9);
    let r = a + b * th + drift * Math.sin(2 * Math.PI * 0.4 * t);
    const trem = tremorAmp * Math.sin(2 * Math.PI * tremorHz * t + tremorPhase);
    const ang = clockwise ? -th : th;
    let x, y;
    if (tremorAxis === 'radial') {
      r += trem;
      x = cx + r * Math.cos(ang);
      y = cy + r * Math.sin(ang);
    } else {
      x = cx + r * Math.cos(ang) + trem;
      y = cy + r * Math.sin(ang);
    }
    x += noise * gaussian(rng);
    y += noise * gaussian(rng);
    pts.push({ x, y, t: t * 1000 });
    t += (1 / rate) * (1 + jitter * (2 * rng() - 1));
  }
  return pts;
}

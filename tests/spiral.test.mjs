import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fft, welch, unwrap, fitSpiral, analyze, synthSpiral, smoothnessScore, resampleUniform, mulberry32,
} from '../src/spiral.js';

test('fft matches a direct DFT', () => {
  const n = 64;
  const rng = mulberry32(7);
  const x = Array.from({ length: n }, () => rng() - 0.5);
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fft(re, im);
  for (const k of [0, 1, 5, 17, 32, 63]) {
    let dr = 0, di = 0;
    for (let i = 0; i < n; i++) {
      dr += x[i] * Math.cos((-2 * Math.PI * k * i) / n);
      di += x[i] * Math.sin((-2 * Math.PI * k * i) / n);
    }
    assert.ok(Math.abs(re[k] - dr) < 1e-9 && Math.abs(im[k] - di) < 1e-9, `bin ${k}`);
  }
});

test('fft rejects non power-of-two input', () => {
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)));
});

test('welch PSD integrates to the signal variance', () => {
  const fs = 100;
  const x = Array.from({ length: 1000 }, (_, i) => 3 * Math.sin((2 * Math.PI * 7 * i) / fs));
  const { psd, df, f } = welch(x, fs);
  const total = psd.reduce((s, v) => s + v, 0) * df;
  assert.ok(Math.abs(total - 4.5) / 4.5 < 0.05, `variance ${total}`);
  const kPeak = psd.indexOf(Math.max(...psd));
  assert.ok(Math.abs(f[kPeak] - 7) <= df);
});

test('unwrap makes angle continuous', () => {
  const raw = [3.0, 3.1, -3.1, -3.0, 3.1];
  const u = unwrap(raw);
  for (let i = 1; i < u.length; i++) assert.ok(Math.abs(u[i] - u[i - 1]) < Math.PI);
  assert.ok(u[3] > u[2]);
});

test('resampleUniform interpolates linearly', () => {
  const r = resampleUniform([0, 1, 2], [0, 10, 0], 4);
  assert.equal(r.t.length, 9);
  assert.ok(Math.abs(r.y[2] - 5) < 1e-12);
  assert.ok(Math.abs(r.y[4] - 10) < 1e-12);
});

test('fitSpiral recovers center and pitch of a clean spiral (unknown center)', () => {
  const pts = synthSpiral({ cx: 240, cy: 210, b: 9, turns: 3, seed: 2 });
  const fit = fitSpiral(pts);
  assert.ok(Math.hypot(fit.cx - 240, fit.cy - 210) < 1, `center ${fit.cx},${fit.cy}`);
  assert.ok(Math.abs(Math.abs(fit.b) - 9) < 0.1, `b ${fit.b}`);
  assert.ok(fit.rms < 0.2);
});

test('clockwise spirals fit too', () => {
  const pts = synthSpiral({ clockwise: true, seed: 4 });
  const r = analyze(pts);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.loopSpacing - 2 * Math.PI * 10) < 1);
});

const FREQS = [4, 6, 8, 10, 12];
const AMPS = [1, 2, 4];
for (const f of FREQS) {
  for (const A of AMPS) {
    test(`tremor ${f} Hz, ${A} px radial, 0.5 px noise: freq within 0.5 Hz`, () => {
      const pts = synthSpiral({ tremorHz: f, tremorAmp: A, noise: 0.5, drift: 2, seed: f * 10 + A, tremorPhase: f });
      const r = analyze(pts, { center: { x: 306, y: 295 } });
      assert.ok(r.ok, r.reason);
      assert.ok(Math.abs(r.tremor.freq - f) <= 0.5, `got ${r.tremor.freq}`);
      assert.ok(Math.abs(r.tremor.amp - A) / A < 0.25, `amp ${r.tremor.amp} vs ${A}`);
      assert.ok(r.tremor.detected);
    });
  }
}

test('clean spiral (noise + slow drift only) shows low tremor amplitude', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = analyze(synthSpiral({ noise: 0.5, drift: 2, seed }));
    assert.ok(r.ok);
    assert.ok(r.tremor.amp < 0.3, `seed ${seed} amp ${r.tremor.amp}`);
    assert.equal(r.tremor.detected, false);
    assert.ok(r.score >= 80, `score ${r.score}`);
  }
});

test('score drops as tremor grows', () => {
  const s = [0, 1, 3, 6].map((A) => analyze(synthSpiral({ tremorHz: 6, tremorAmp: A, noise: 0.5, seed: 9 })).score);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] < s[i - 1], s.join(','));
});

test('smoothnessScore formula', () => {
  const s = smoothnessScore({ rmsDev: 0, tremorAmp: 0, loopSpacing: 50, tightnessCV: 0 });
  assert.equal(s.score, 100);
  const t = smoothnessScore({ rmsDev: 5, tremorAmp: 2.5, loopSpacing: 50, tightnessCV: 0.1 });
  assert.equal(t.score, Math.round(100 * Math.exp(-(4 * 0.1 + 8 * 0.05 + 0.1))));
});

test('speed and duration are reported', () => {
  const r = analyze(synthSpiral({ duration: 8 }));
  assert.ok(Math.abs(r.durationS - 8) < 0.1);
  assert.ok(Math.abs(r.meanSpeed - r.pathLength / r.durationS) < 1e-9);
});

test('rejects too-short input', () => {
  assert.equal(analyze([{ x: 0, y: 0, t: 0 }]).ok, false);
  assert.equal(analyze(synthSpiral({ duration: 1 })).ok, false);
});

## Inspiration
The Archimedes spiral drawing test is one of the simplest ways to look at hand tremor: draw a spiral, and a clinician looks at how wobbly it is. It needs only paper, but the result is usually judged by eye, and it is hard for a person to track their own steadiness over weeks. Almost everyone already has a mouse, a touchscreen or a stylus. I wanted a free, private tool that turns the same simple task into honest numbers you can compare against your own past results.

## What it does
SpiralCheck is a web page. You trace the grey guide spiral from the center outward with a mouse, finger or stylus and press Analyze. It reports:
- **Tremor frequency and amplitude**: the strongest rhythm between 3 and 15 Hz in your radial error, with how much of the band power it holds.
- **Deviation** from an ideal Archimedes spiral fitted to your own trace (RMS and max, in px and nominal mm).
- **Drawing speed** and **loop evenness** (how consistent the spacing between loops is).
- A **0 to 100 smoothness score** (a documented heuristic, independent of how big you draw).
- **Plots** of the radial error over time and its spectrum, with the peak marked.
- **History** kept only in your browser (localStorage), with CSV export of the history and of the raw trace.
- A **Play demo** button that plays a synthetic drawing with a known 6 Hz tremor through the real analyzer, so judges can see the full report in one click.

Private by design: no server, no account, no analytics, no network requests. Nothing leaves the device. **SpiralCheck is not a medical device and does not diagnose anything**; the page says so on top and tells people to talk to a doctor if they are worried.

## How we built it
- Vanilla JavaScript + HTML canvas, no build step and **no runtime libraries**. Hosted as static files on GitHub Pages.
- Input uses Pointer Events with `getCoalescedEvents()`, so the app gets every sample the device delivers, not just one per frame.
- Signal chain (src/spiral.js, a pure module with no DOM): fit r = a + b*theta including a search for the spiral center, unwrap the angle, take the radial error, resample to 100 Hz, high-pass to remove slow hand drift, then a Welch power spectrum (our own radix-2 FFT, Hann window) with sub-bin peak interpolation.
- Tests: 27 unit and synthetic tests with Node's built-in test runner (`node --test`, 27/27 pass).
- Validation: `tools/validate.mjs` draws synthetic spirals with irregular pointer timing, position noise, slow drift and a sinusoidal tremor of known frequency (4 to 12 Hz) and amplitude (0.5 to 4 px), 10 random seeds per case, and writes docs/validation.md.
- **Built with Claude Code (an AI coding agent by Anthropic), directed by Ferbin Richard**, who chose the idea, set the requirements and validation criteria, and reviewed the results. The demo video and screenshot were recorded with Playwright (headless Chromium) driving the real app.

## Challenges we ran into
- Real pointer events arrive at uneven intervals (and only 60 Hz on some devices), but an FFT needs evenly spaced samples. We resample to 100 Hz and test both 120 Hz and 60 Hz pointer rates with +/-30% timing jitter.
- Slow hand drift is much larger than a small tremor, so the radial error is high-passed before the spectrum, and the validation includes a slow 2 px drift on every trial.
- People never draw exactly around the guide center, so the app fits the spiral center itself; every validation trial starts from a center guess that is 6 px off.
- A tremor that shakes along one fixed direction is only partly radial. We measured this instead of hiding it (see below).

## Accomplishments that we're proud of
Numbers from the latest validation run (all synthetic, from docs/validation.md):
- Radial tremor 4 to 12 Hz at 120 Hz pointer rate, 60 Hz pointer rate, and a fast 4 s drawing: **1080/1080 trials recovered the frequency within 0.5 Hz**; at 120 Hz the max error was 0.019 Hz and the amplitude read 0.95 to 1.05 of truth.
- Clean spirals with no tremor: **0/200 false tremor flags**.
- In the demo video, a mouse-drawn spiral with a 5 Hz, 3 px wobble added was read live as 5.0 Hz, 2.88 px; the same path without the wobble raised no flag.

Known limits we report openly: a tremor along a fixed axis is still found within 0.5 Hz but with about 0.3 Hz bias and only about 2/3 of its amplitude seen; 0.5 px (the size of the noise) is the practical detection floor. These checks cover the math only and say nothing about clinical accuracy.

## What we learned
Validating against synthetic ground truth first made every later change safe: a change that broke the 0.5 Hz bar showed up at once. And writing down the limits (fixed-axis bias, detection floor) is as important as the headline numbers for a health tool.

## What's next
- Try it with real people drawing by hand on phones and tablets and compare against the paper test, with proper consent.
- Use device pixel density to report true millimeters.
- An optional printable report to bring to a doctor visit, still generated fully on the device.

## Links
- Live app: https://ferbin12.github.io/spiralcheck/
- Code (MIT): https://github.com/FERBIN12/spiralcheck
- Demo video: https://youtu.be/B67WwUBICbU (captions only, no voice; mouse drawings in the video are scripted by the recorder, not a patient)

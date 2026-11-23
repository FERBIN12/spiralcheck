"""Record the real SpiralCheck UI (Playwright video) + caption timings.
Usage: record_demo.py URL OUTDIR -> OUTDIR/raw.webm + OUTDIR/captions.json
Mouse drawings are driven by Playwright's real mouse (pointer events go through the app's own handlers);
every number on screen is computed live by the app during the recording."""
import json, math, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
caps, t0 = [], None
def cap(text):
    now = time.monotonic() - t0
    if caps and caps[-1][1] is None: caps[-1][1] = now
    caps.append([now, None, text])

def draw(pg, wobble_hz, wobble_px, dur=8.0):
    box = pg.locator("#pad").bounding_box()
    size = box["width"]; cx, cy = box["x"] + size / 2, box["y"] + size / 2
    turns = 3; b = size * 0.43 / (2 * math.pi * turns); th_max = 2 * math.pi * turns
    pg.mouse.move(cx, cy); pg.mouse.down()
    start = time.monotonic()
    while True:
        t = time.monotonic() - start
        if t > dur: break
        th = th_max * math.sqrt(t / dur)          # ~constant pen speed
        r = b * th + wobble_px * math.sin(2 * math.pi * wobble_hz * t)
        pg.mouse.move(cx + r * math.cos(th), cy + r * math.sin(th))
        time.sleep(0.008)
    pg.mouse.up()

with sync_playwright() as p:
    br = p.chromium.launch(headless=True, args=["--mute-audio"])
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, record_video_dir=str(out),
                         record_video_size={"width": 1440, "height": 900})
    pg = ctx.new_page(); t0 = time.monotonic()
    pg.goto(url); pg.wait_for_timeout(1500)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(1500)
    cap("SpiralCheck: the Archimedes spiral drawing test, in the browser. Trace the guide spiral from the center out.")
    pg.wait_for_timeout(4500)
    cap("Built-in demo: a synthetic drawing with a known 6 Hz tremor, played back through the real analyzer.")
    pg.click("#btn-demo"); pg.wait_for_function("!document.getElementById('btn-demo').disabled", timeout=60000)
    pg.wait_for_timeout(1500)
    cap("The report: tremor frequency and amplitude from an FFT of the radial error, plus speed and loop evenness.")
    pg.locator("#report").scroll_into_view_if_needed(); pg.wait_for_timeout(6000)
    cap("Radial error over time, and its spectrum. The 6 Hz peak is the injected tremor.")
    pg.locator("#plot-spec").scroll_into_view_if_needed(); pg.wait_for_timeout(6000)
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(800)
    cap("Now real pointer input: a smooth spiral drawn with the mouse (scripted by the recorder, not a patient).")
    pg.click("#btn-clear"); pg.wait_for_timeout(500)
    draw(pg, 0, 0); pg.wait_for_timeout(600); pg.click("#btn-analyze"); pg.wait_for_timeout(1200)
    cap("Smooth drawing: no tremor flagged.")
    pg.locator("#report").scroll_into_view_if_needed(); pg.wait_for_timeout(6000)
    pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(800)
    cap("Same mouse path with a 5 Hz, 3 px wobble added. SpiralCheck should find about 5 Hz.")
    pg.click("#btn-clear"); pg.wait_for_timeout(500)
    draw(pg, 5, 3); pg.wait_for_timeout(600); pg.click("#btn-analyze"); pg.wait_for_timeout(1200)
    pg.locator("#report").scroll_into_view_if_needed(); pg.wait_for_timeout(7000)
    pg.locator("#plot-spec").scroll_into_view_if_needed(); pg.wait_for_timeout(5000)
    cap("History stays in this browser only (localStorage). Export history or the raw trace as CSV. Nothing is uploaded.")
    pg.locator("#hist-body").scroll_into_view_if_needed(); pg.wait_for_timeout(7000)
    caps[-1][1] = time.monotonic() - t0
    res = pg.evaluate("[...document.querySelectorAll('#hist-body tr')].map(r=>r.innerText)")
    v = pg.video; ctx.close(); br.close()
    Path(v.path()).rename(out / "raw.webm")
json.dump(caps, open(out / "captions.json", "w"), indent=1)
print("HISTORY", res); print("ok", f"{caps[-1][1]:.1f}s")

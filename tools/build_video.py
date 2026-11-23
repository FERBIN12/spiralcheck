"""Compose the demo: title card + captioned live recording + results card + end card. Usage: build_video.py VIDEODIR"""
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
d = Path(sys.argv[1]); W, H, BAR = 1440, 1000, 100
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"; FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def card(name, title, lines):
    im = Image.new("RGB", (W, H), (250, 248, 242)); g = ImageDraw.Draw(im)
    g.text((110, 120), title, font=ImageFont.truetype(FB, 58), fill=(31, 58, 95)); y = 250
    for ln in lines:
        f = ImageFont.truetype(FB if ln.startswith("*") else F, 32); ln = ln.lstrip("*")
        g.text((110, y), ln, font=f, fill=(40, 40, 40)); y += 58 if ln else 30
    im.save(d / f"{name}.png")
card("c0", "SpiralCheck", ["The Archimedes spiral drawing test, in any browser.", "Draw a spiral with mouse, finger or stylus and get",
     "tremor frequency, amplitude, speed and loop evenness in seconds.", "", "Runs fully on your device: no install, no account, nothing uploaded.",
     "Not a medical device and not a diagnosis.", "", "Everything in this video is the real app, recorded live.",
     "Built by Ferbin Richard with Claude Code (an AI coding agent)."])
card("c1", "Measured, not claimed", ["*Synthetic validation (node tools/validate.mjs, 10 seeds per cell):",
     "Radial tremor 4 to 12 Hz: 1080/1080 trials within 0.5 Hz", "(120 Hz pointer, 60 Hz pointer, fast 4 s drawing), amp ratio 0.95 to 1.05",
     "Clean spirals: 0/200 false tremor flags", "", "*Known limits:",
     "Tremor along a fixed axis: still within 0.5 Hz, but about 0.3 Hz bias", "and only about 2/3 of the amplitude is seen (radial projection).",
     "0.5 px is the practical detection floor.", "Synthetic checks of the math only, not clinical accuracy."])
card("c2", "Try it", ["ferbin12.github.io/spiralcheck", "github.com/FERBIN12/spiralcheck  (MIT license)", "",
     "Vanilla JavaScript + canvas, own FFT and Welch PSD, no libraries.", "Tests: node --test (27/27 pass)", "",
     "Built with Claude Code (AI coding agent) directed by Ferbin.", "Captions only, no voice."])
def ts(s): return f"{int(s//3600)}:{int(s%3600//60):02d}:{s%60:05.2f}"
caps = json.load(open(d / "captions.json"))
ass = ["[Script Info]", "PlayResX: 1440", "PlayResY: 1000", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Alignment, MarginV, BorderStyle, Outline, Shadow",
       "Style: C,DejaVu Sans,34,&H00FFFFFF,&H00000000,&H00000000,0,2,30,1,0,0", "", "[Events]",
       "Format: Layer, Start, End, Style, Text"]
ass += [f"Dialogue: 0,{ts(a)},{ts(b)},C,{t}" for a, b, t in caps]
(d / "caps.ass").write_text("\n".join(ass) + "\n")
run = lambda *a: subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)
enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-crf", "20"]
for c, sec in (("c0", 8), ("c1", 14), ("c2", 9)):
    run("-loop", "1", "-t", str(sec), "-i", str(d / f"{c}.png"), "-vf", "fade=in:0:15", *enc, str(d / f"{c}.mp4"))
run("-i", str(d / "raw.webm"), "-vf", f"scale={W}:900,pad={W}:{H}:0:0:color=0x1f3a5f,ass={d/'caps.ass'}", *enc, str(d / "live.mp4"))
(d / "list.txt").write_text("".join(f"file '{n}.mp4'\n" for n in ("c0", "live", "c1", "c2")))
run("-f", "concat", "-safe", "0", "-i", str(d / "list.txt"), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-shortest", *enc, "-c:a", "aac", str(d / "spiralcheck_demo.mp4"))
print("ok", d / "spiralcheck_demo.mp4")

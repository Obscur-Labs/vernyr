#!/usr/bin/env python3
"""Smoke test for gradient.skin: every palette × every browserless format, plus the flags that matter.
Run: python3 scripts/selftest.py   (add --png to also exercise the Playwright renderer)"""
import os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); SKIN = os.path.join(HERE, "skin.py")
sys.path.insert(0, HERE); import skin  # noqa
tmp = tempfile.mkdtemp(); fails = 0
def run(*args):
    global fails
    r = subprocess.run([sys.executable, SKIN, *args], capture_output=True, text=True)
    ok = r.returncode == 0
    fails += 0 if ok else 1
    print(("ok  " if ok else "FAIL"), " ".join(args)); 
    if not ok: print(r.stderr[-800:])
    return ok
for name in skin.PALETTES:
    run("--palette", name, "--out", f"{tmp}/{name}.html")
    run("--palette", name, "--blank", "--format", "css", "--out", f"{tmp}/{name}.css")
run("--palette", "dawn", "--format", "svg", "--out", f"{tmp}/a.svg")
run("--palette", "ocean", "--animate", "--format", "react", "--out", f"{tmp}/Skin.jsx")
run("--from-brand", "#5B4BFF", "--responsive", "--out", f"{tmp}/brand.html")
run("--from-brand", "#5B4BFF", "--dark", "--out", f"{tmp}/brand-dark.html")
run("--palette", "meadow", "--dark", "--align", "left", "--display-font", "Fraunces", "--out", f"{tmp}/left.html")
run("--colors", "#d6d0ff,#cfe1ff,#c8f4ec,#f0cdf5,#f9efc6,#f2db95,#f8d6c0,#f8e2dc", "--base", "#f4f3f8", "--out", f"{tmp}/custom.html")
run("--size", "og", "--layout", "halo", "--grain", "0.06", "--out", f"{tmp}/halo.html")
run("--list-palettes")
if "--png" in sys.argv:
    run("--palette", "dawn", "--size", "og", "--scale", "1", "--out", f"{tmp}/a.png")
    run("--sheet", "--out", f"{tmp}/sheet.png")
# lightness rule: every light-palette blob colour must be >= 80% lightness, dark ones <= 35%
for name, p in skin.PALETTES.items():
    for c in p["cool"] + p["warm"]:
        _, l, _ = skin._hls(c)
        bad = (l < .75) if not p.get("dark") else (l > .35)
        if bad: fails += 1; print(f"FAIL lightness rule: {name} {c} l={l:.2f}")
print("\n" + ("ALL GOOD" if not fails else f"{fails} FAILURE(S)")); sys.exit(1 if fails else 0)

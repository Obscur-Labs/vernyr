---
name: gradient-skin
description: Generate soft pastel "mesh" gradient backgrounds and editorial hero sections — the light-on-paper look from good landing pages (Linear, Vercel, Arc, Raycast), not the blue-purple-pink one every AI defaults to. Blurred colour blobs, a white light-leak, a faint dot grid, optional grain and drift animation, serif display type with an italic second line. Use this whenever someone asks for a gradient background, a mesh/aurora/blurred/pastel/dreamy/holographic gradient, a "soft" or "glowy" hero, a landing page hero, an OG image, an X/Twitter or social card, a wallpaper, a dark-mode version of any of those, or wants a gradient derived from a brand colour. Also use it when they only want the CSS for such a background, a React component, or a quick PNG. Outputs HTML, CSS, SVG, PNG, or a React component. 21 built-in palettes plus brand-derived ones.
---

# gradient.skin — pastel mesh gradients that look like light on paper

The look: a near-white sheet of paper with big, very soft pools of colour bleeding in from the edges,
cool on one side (mint, sky, lavender, pink), warm on the other (cream, gold, peach), a bright white
light-leak between them where the text sits, a barely-there dot grid, and calm editorial type.
It is the opposite of the saturated blue → purple → pink bar that models reach for by default.

Everything lives in `scripts/skin.py` (stdlib Python, zero dependencies). Read this file, then run the
script. Open the references only when needed:

- `references/recipe.md` — the CSS anatomy explained, for hand-writing it into React / Tailwind / Svelte
  / plain CSS. Read when the user wants it *inside their own codebase* rather than as a file.
- `references/palettes.md` — all 21 palettes with moods, and how the brand-colour derivation works.

## Quick start

```bash
S=<path-to-this-skill>/scripts/skin.py

# A finished hero page (responsive, Google Fonts)
python3 $S --responsive --wordmark "Acme" --eyebrow "Beta" --headline "Ship the" --italic "quiet part." \
  --sub "Infra that stays out of your way." --badge "Live" --cta "Get started" --out hero.html

# Just the CSS for an existing site
python3 $S --blank --palette dusk --format css > skin.css

# A React component (<Skin>…</Skin>), animated
python3 $S --palette ocean --animate --format react --out Skin.jsx

# Social images (PNG needs Node + Playwright, see "Rendering PNGs")
python3 $S --size og --headline "Launch" --italic "day." --out og.png
python3 $S --size x  --palette sorbet --seeds 1-4 --out card.png      # card-s1.png … card-s4.png

# From a brand colour, light and dark
python3 $S --from-brand "#5B4BFF" --out brand.html
python3 $S --from-brand "#5B4BFF" --dark --out brand-dark.html

# See every palette at once
python3 $S --list-palettes
python3 $S --sheet --out palettes.png
```

`--format` is inferred from the `--out` extension: `.html`, `.png`, `.svg`, `.jsx`, or `--format css`
to stdout.

## The knobs

| Flag | What it does | Good values |
|---|---|---|
| `--palette` | colour family | 16 light: `dawn` (reference) `sorbet` `glacier` `dusk` `meadow` `ember` `peach` `lilac` `ocean` `citrus` `rose` `sand` `mint` `aurora` `candy` `slate` · 5 dark: `ink` `midnight` `graphite` `nightfall` `lantern` |
| `--from-brand #hex` | derive a palette from one colour | keeps the brand hue on the cool side, complement on the warm side |
| `--dark` | dark twin of any palette or brand | blobs drop to ~18% lightness, grid flips to white |
| `--colors` | your own 8 hexes, 4 cool then 4 warm | every one ≥ 80% lightness (light) or ≤ 35% (dark) |
| `--layout` | blob placement | `split` (cool left / warm right, white seam), `corners`, `wash`, `halo` |
| `--seed` / `--seeds` | jitter; `0` = random; `1-6` or `2,5,9` renders variants | pick one, then keep it fixed |
| `--intensity` | colour strength | `0.6` whisper · `1.0` reference · `1.3` punchy |
| `--size` | px or preset | `og` 1200×630 · `x` 1600×900 · `square` · `story` · `linkedin` · `banner` 1920×768 · `wallpaper` · `4k` · `mobile` |
| `--animate` | blobs drift slowly like light on water | pages and heroes; pointless for stills |
| `--align left` | left-aligned editorial layout | long headlines, product pages |
| `--display-font` / `--body-font` | any Google Font name | `Fraunces`, `Newsreader`, `Playfair Display` / `Geist`, `Manrope` |
| `--grain 0.06` · `--no-grid` · `--grid-size` | texture | grain 0.04–0.1; grid 22px, 28–32 on huge canvases |
| `--fonts` | `google` (html default) · `local` (png default, vendored) · `embed` (base64, single file) · `system` | |
| `--responsive` | HTML fills the viewport instead of fixed `--size` | real pages |
| `--scale` | PNG device pixel ratio | 2 retina, 1 quick preview |

## Spec file (multi-panel pages, full control)

```json
{
  "wordmark": "Lumen.", "palette": "dawn", "layout": "split", "seed": 3, "animate": true,
  "align": "center", "topbar": false, "grain": 0, "footer": "Made with care.",
  "panels": [
    {"eyebrow": "Studio", "headline": "Design the", "italic": "quiet part.",
     "sub": "Interfaces that get out of the way.", "badge": "Live", "cta": "Enter", "href": "/studio"},
    {"eyebrow": "Labs", "headline": "Same idea,", "italic": "gold leaf.",
     "sub": "Experiments, shipped weekly.", "badge": "Beta", "cta": "Enter"}
  ]
}
```

`python3 $S --spec spec.json --size page --out site.png`. Every key is optional. One panel is a centred
hero; two or three become columns that stack on phones. CLI flags override the spec, so `--seed 9` on
top of a spec is a cheap way to explore.

## Working with the user

1. **Infer, don't interrogate.** "Make me one of those soft gradient heroes" means `dawn`, `split`,
   grid on. A brand hex in the request means `--from-brand`. Dark UI means `--dark` or a dark palette.
   A product with a personality: pick the palette by mood from palettes.md (`ocean` for trust, `citrus`
   for energy, `sand` for editorial, `slate` for enterprise, `candy` for consumer).
2. **Render, then look.** Open the PNG or screenshot the HTML before handing it over. Check: the white
   seam still exists, the text sits on the calmest part, no blob has a visible edge, type is not
   fighting colour. If it's off, change `--seed` or `--intensity` first, palette last.
3. **Offer variants, not adjectives.** `--seeds 1-4` and let them point at one.
4. **Ship what fits their stack.** `.html` for a page, `--format css` or `--format react` for a
   codebase (recipe.md has the Tailwind version), `.png` for social, `.svg` when there is no browser.
5. **Match the sizes to the job.** OG image → `--size og`. X post image → `--size x`. X article cover →
   `--size banner`. Story / Reel → `--size story`. All of these in one go is four commands, not one.

## Why the look works (so you can bend it without breaking it)

- **Low saturation, high lightness.** Every blob is ≥ 80% lightness except one deliberate gold accent.
  Contrast comes from the hue *temperature* split, cool vs warm, not from any single loud colour. Push
  saturation and it becomes the AI default instantly.
- **Blobs are huge and soft.** Each ellipse spans 40–60% of the canvas and fades to nothing by ~68% of
  its radius. Small blobs read as spots; hard stops read as circles.
- **The white light-leak is the hero.** It is the brightest thing on the canvas and it sits where the
  text goes. Type over colour looks like a poster; type over the leak looks like print.
- **The grid is texture, not decoration.** ~9% opacity, 22px pitch, fading at the edges.
- **Type is quiet.** One display serif with a true italic for the second line, tracking slightly
  negative, line-height under 1. Eyebrow and badges in a small tracked-out mono. Ink is near-black,
  never pure black.
- **Nothing has a border except the badge.** Cards, boxes and shadows fight the softness.

## Common asks → flags

- "softer / dreamier" → `--intensity 0.7`, maybe `--grain 0.05`
- "more colour / punchier" → `--intensity 1.25` or `--layout corners`
- "match our brand" → `--from-brand "#hex"`; add `--dark` for the dark mode
- "dark mode" → `--dark` (any palette) or `--palette ink|midnight|graphite|nightfall|lantern`
- "make it move / flowing / like water" → `--animate`
- "left-aligned / more editorial" → `--align left --display-font "Fraunces"`
- "put it behind my existing page" → `--blank --format css`, wrap content in `.skin` (recipe.md)
- "React / Next.js" → `--format react` gives a `<Skin>` component with the CSS bundled
- "show me options" → `--seeds 1-6` or `--sheet`

## Rendering PNGs

PNG export runs `scripts/render.mjs` (Playwright + Chromium). It looks for `playwright` locally, then in
the global npm root, then falls back to a `chromium` binary on PATH. If none exists it leaves the `.html`
beside the output and says so. One-time setup: `npm i -g playwright && npx playwright install chromium`.
PNGs use the vendored OFL fonts in `assets/fonts/`, so they are identical offline and in CI. HTML links
Google Fonts by default; `--fonts embed` makes a single self-contained file.

## Troubleshooting

- *Fonts look wrong in HTML* → the page is offline or Google Fonts is blocked; use `--fonts embed`.
- *PNG export fails* → run `scripts/selftest.py --png`; the error names what is missing.
- *Blobs look like circles* → `--intensity` too high for a custom `--colors` set; lift lightness.
- *Text hard to read* → the leak is off the text; try another `--seed` or `--layout halo`.
- *Everything works but looks generic* → you used the default copy. The words matter as much as the
  gradient: short serif headline, italic second line, one sentence of sub.

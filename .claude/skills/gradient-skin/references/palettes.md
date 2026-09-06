# gradient.skin palettes

Each palette is four *cool* colours, four *warm* colours, a base paper colour, a light-leak and an ink.
With `--layout split` the cool four sit on the left, the warm four on the right. `python3 scripts/skin.py
--list-palettes` prints the hexes; `--sheet` renders them all side by side.

## Light

| name | cool → warm | mood | reach for it when |
|---|---|---|---|
| `dawn` | mint · sky · lavender · pink → cream · gold · peach | sunrise on paper | default; fintech, crypto, "serious but friendly" |
| `sorbet` | rose · raspberry → apricot · lemon | dessert | consumer, creator tools, anything fun |
| `glacier` | mint · ice · lilac → near-white | cold, clean | dev tools, infra, security, minimal |
| `dusk` | lavender · violet · periwinkle → apricot · coral | evening | wellness, lifestyle, assistants |
| `meadow` | sage · mint · sky → lemon · lime | fresh | health, climate, food |
| `ember` | apricot · coral → honey · amber | golden hour | hospitality, luxury |
| `peach` | blush · peach → cream · apricot | warm, friendly | community, education, DTC |
| `lilac` | lilac · periwinkle → blush · pink | gentle | beauty, journaling, calm apps |
| `ocean` | sky · azure → seafoam · ice | calm, trustworthy | banking, insurance, B2B |
| `citrus` | mint · lime → lemon · butter | energetic | events, sports, launches |
| `rose` | rose · pink → blush · coral | romantic | dating, gifting, weddings |
| `sand` | linen · stone → oat · caramel | editorial, near-neutral | publications, portfolios, studios |
| `mint` | mint · aqua → lime · pale green | clean | health tech, productivity |
| `aurora` | teal · sky · violet · pink → same, lighter | northern lights | AI products, creative tools |
| `candy` | bubblegum · pink → sky · ice | loud but soft | games, kids, Gen-Z brands |
| `slate` | cool greys → lilac greys | almost invisible | enterprise, legal, "we are serious" |

## Dark

| name | blobs | mood |
|---|---|---|
| `ink` | teal · indigo · green · plum on charcoal | dim aurora; crypto dashboards |
| `midnight` | navy · indigo · purple | deep blue; analytics, dev tools |
| `graphite` | warm and cool greys | nearly monochrome; luxury, hardware |
| `nightfall` | plum · violet · rust | warm dark; music, nightlife |
| `lantern` | coral · gold · green on black | the halftone one; festivals, food, culture |

Any light palette also has a dark twin: `--palette meadow --dark`.

## From a brand colour

`--from-brand "#5B4BFF"` does this automatically:

1. Keep the brand hue. The cool side is the brand hue at 86% lightness, then −40°, −80° and +25°
   rotations at the same lightness. The cool side carries identity.
2. The warm side is the complement (+160° … +195°) lifted to 80–92% lightness: cream, gold, peach,
   blush. Warm sides can be shared across brands; that is what makes it feel like "light".
3. Base is the brand hue at 18% saturation, 96.5% lightness. Ink is the brand hue at 7% lightness.
4. With `--dark`, blobs sit at 17–21% lightness with saturation dropped, base at 5%.

The same numbers by hand, for custom `--colors`:

```python
import colorsys
def pastel(hex_color, dh=0, l=0.86, s=0.7):
    r,g,b = (int(hex_color.lstrip('#')[i:i+2],16)/255 for i in (0,2,4))
    h,_,_ = colorsys.rgb_to_hls(r,g,b)
    r,g,b = colorsys.hls_to_rgb((h + dh/360) % 1, l, s)
    return '#%02x%02x%02x' % tuple(int(round(v*255)) for v in (r,g,b))
```

Sanity rules (`scripts/selftest.py` checks the built-ins): light blobs ≥ 75% lightness, dark blobs ≤ 35%,
at least one hue jump ≥ 90° between the two sides, no two adjacent blobs within 15° unless the point is
a monochrome wash.

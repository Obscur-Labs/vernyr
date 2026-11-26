# website/

# Marketing site (`website/`)

The public page at the apex, `vernyr.com`. Static; no API calls, no auth, no
env file. Every outward link lives in `src/lib/site.ts`: the two product
subdomains, the contact details, the Drive links for terms and privacy, and the
catalogue counts quoted on the page. Change them there, nowhere else.

The look comes from the `gradient-skin` skill in `.claude/skills/`, derived from
the brand indigo `#3853DE`: big soft pools of colour bleeding in from the edges,
cool on the left, warm on the right, with a white light-leak up the middle where
the type sits. `.skin` in `globals.css` is that gradient; `.skin-soft` is the
quieter wash the sections below the fold use. Regenerate with:

```bash
python .claude/skills/gradient-skin/scripts/skin.py \
  --from-brand "#3853DE" --blank --seed 3 --format css
```

Type is Instrument Serif for display with a true italic second line, Inter for
body, JetBrains Mono for the tracked-out eyebrows. Cards carry no border and no
shadow; both fight the softness; `.panel` is a white wash plus a blur instead.
The one bordered thing on the page is the badge.

`Brand.tsx` re-declares the same traced mark geometry the CRM uses in
`crm/src/components/auth/Insignia.tsx`, and paints `wordmark.png` as an alpha mask over
`currentColor`. If the mark is ever re-fitted, both copies move together.

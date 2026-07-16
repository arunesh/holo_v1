# Holodeck — logo & favicon system

Open **`brand-sheet.html`** in a browser to see everything in context (tab mock, nav mock, pixel-accurate favicon strip, palette, type).

## The mark

Three concentric arcs orbiting a luminous core:

| Arc | Angular span | Radius | Stroke | Gradient |
|---|---|---|---|---|
| Outer | 45° | 45 | 8.5 | `#67E8F9` → `#22D3EE` → `#2E7CF6` |
| Middle | 52.5° | 33 | 10.0 | `#38BDF8` → `#6366F1` → `#8B5CF6` |
| Inner | 60° | 21.5 | 11.5 | `#A855F7` → `#D946EF` → `#F472B6` |
| Core | — | 7.0 | — | radial `#FFFFFF` → `#EBD6FF` → `#9333EA` |

Each arc overlaps its predecessor by **45% of its own span**, so the three cascade rather than stack — 106.9° of total sweep. Spans widen and strokes thicken toward the centre, which reads as foreshortening: the arcs feel like latitude rings on a sphere turning away from you, not flat circles. Outer tails taper to zero opacity so the shell dissolves instead of ending — the projection hasn't finished resolving.

## Files

```
svg/
  holodeck-mark.svg              primary mark (tapered, with halo)
  holodeck-mark-solid.svg        no taper, no halo — dense contexts
  holodeck-mark-mono-white.svg   single colour
  holodeck-mark-mono-navy.svg
  holodeck-lockup-{dark,light}.svg    mark + wordmark, horizontal
  holodeck-stacked-{dark,light}.svg   mark over wordmark
  holodeck-og-card.svg
png/
  holodeck-mark-{512,1024}.png
  holodeck-lockup-{dark,light}-1200.png
  holodeck-stacked-{dark,light}-800.png
  holodeck-og-card.png           1200×630
favicon/
  favicon.ico                    16/32/48/64 multi-res
  favicon.svg                    transparent, scalable
  icon-tile.svg                  rounded navy tile
  favicon-{16,32,48,64,128,256}x*.png
  apple-touch-icon.png           180
  icon-192.png  icon-512.png  maskable-512.png
  site.webmanifest
```

The favicon is a **separate drawing**, not a shrunk logo: strokes go to 10/11.5/13, the core to 8.0, the taper is dropped (a fading tail turns to mush under 32px), and there's 10% tile padding. Wordmarks are outlined paths, so nothing depends on Poppins being installed.

## Install

Drop the contents of `favicon/` at your web root:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0B1020">
<meta property="og:image" content="/holodeck-og-card.png">
```

## Tokens

```css
--holo-void:     #0B1020;   /* page background */
--holo-ink:      #101534;   /* wordmark on light */
--holo-cyan:     #22D3EE;   /* outer shell */
--holo-blue:     #2E7CF6;
--holo-violet:   #8B5CF6;   /* field / primary accent */
--holo-fuchsia:  #D946EF;
--holo-pink:     #F472B6;   /* core */
--holo-ramp: linear-gradient(96deg,#67E8F9,#22D3EE,#2E7CF6,#6366F1,#8B5CF6,#D946EF,#F472B6);
```

**Type:** Poppins — Medium (500) wordmark & headings, Regular (400) UI, Light (300) body.

## Rules

- Clear space on all sides of the lockup = one core diameter.
- Minimum widths: horizontal lockup 120px, stacked 84px, mark alone 20px.
- Don't rotate the mark, recolour the arcs individually, or place the gradient version on a mid-tone background — the cyan tail disappears. Use the mono version there.

## Regenerating

`gen2.py` holds the geometry (`RADII`, `STROKES`, `SPANS`, `OVERLAP`, `MID`); `build.py` emits every file. Change `MID` to re-aim the cascade, `OVERLAP` to loosen or tighten it.

# Brand assets

## Master

`nacos-logo.png` is the **official NACOS logo** (3954x3954, transparent). It is
the single authoritative brand asset. Never recolor, filter, skew, crop, or
recreate it.

## Derived (generated from the master, same artwork and proportions)

| File | Size | Used for |
| --- | --- | --- |
| `nacos-logo-160.png` | 160px | the in-app header lockup (`app/components/brand.tsx`) |
| `../../app/icon.png` | 256px | browser favicon (Next App Router metadata file) |
| `../../app/apple-icon.png` | 180px | iOS home-screen icon |

Regenerate with `sharp` if the master changes, for example:

```bash
pnpm dlx sharp-cli -i public/brand/nacos-logo.png -o public/brand/nacos-logo-160.png resize 160 160 --fit contain
pnpm dlx sharp-cli -i public/brand/nacos-logo.png -o app/icon.png resize 256 256 --fit contain
pnpm dlx sharp-cli -i public/brand/nacos-logo.png -o app/apple-icon.png resize 180 180 --fit contain
```

If an official `unizik-logo` is added later, wire it into `Brand` beside the
NACOS mark (keep it visually secondary).

## Palette

The green in `app/globals.css` (`--c-accent` and friends) matches the NACOS logo
green but is still tuned for text contrast. If an official NACOS brand guide
gives exact values, replace the `--c-*` channel triples in `:root` and
`:root.dark`. Nothing else changes: every component consumes the semantic
tokens (`accent`, `paper`, `ink`, `line`, `gold`, `danger`).

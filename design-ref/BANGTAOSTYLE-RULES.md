# BANGTAOSTYLE live hub — product rules

These come from the owner and apply to every change in `live-hub/`.

## Layout
- **One whole product, edge to edge.** Content starts at the screen edges: media, scenes and control panels bleed full-width on phones. No boxed "cards", panels with borders, side gutters around media or block-by-block look.
- **One motion-scroll mechanism.** Every section is a scene on the shared scroll engine (`components/fx/ScrollFX.tsx` sets `--p`, `--e`, `--x` on each `main > section`). Build motion from those vars; no separate per-block animation systems.
- **Each scene fits one screen** on phone and desktop, between the top bar and the soundtrack dock (`--top-h`, `--dock-h`).
- **No overlays at the sides** of media (no stat blocks, sparks or labels pinned over the left/right of a video). Numbers live in the layout next to the media.

## Devices
- **iPhone first, Safari.** Reference device: iPhone 12 Pro Max — 428×926 CSS px, Safari visible area ≈ 428×746 with bars. Then other iPhones (375×667 SE, 390×844), iPad (820×1180, 1180×820), desktop.
- iOS specifics: no emoji-looking glyphs for controls (⏮ ⏭ render as blue emoji) — use SVG; `:active` needs a touch listener; respect safe areas; H.264 for video.

## Quality scales with the device
- The stronger the phone, the richer the picture: better devices get higher-resolution media and heavier effects (a live-game feel); weaker ones get a lighter version of the same scene — never a different layout.

## Controls
- Buttons are **realistic BMW E36/E39/E46 climate-panel keys**: soft-touch rubber, convex face, recessed in the panel, backlit label — white by default, red when on / pressed / primary (brand light, not BMW orange) — and a red indicator LED. They must look physical, not flat or "drawn". Styles: `app/hub.css` «BMW … climate keys».
- Labels readable: condensed DIN-like face (Fira Sans Condensed), ≥ 13 px on phones.

## Content
- **18+ product**: uncensored stream (strong language, alcohol, parties). The site opens with an age gate (`components/AgeGate.tsx`, remembered per device) and declares `<meta name="rating" content="adult">`. Keep it on every public page.
- Crew: 01 — ILIA | GTR (the owner, author and organiser of the tour); 02 — GETA (GTR). The owner approved keeping GETA's name in the repo for development and testing.
- **12.10 the owner declassified GETA**: her name, face and footage may be used publicly (reels, site). Other people's faces and car plates — still out of frame or blurred.

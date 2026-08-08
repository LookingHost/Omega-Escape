# Screenshots

Drop your captures here using these **exact filenames** so the main
`README.md` picks them up automatically:

| Filename | What to capture |
|---|---|
| `home.png` | Main menu / command console with the title lockup |
| `gameplay.png` | Mid-run — combo active, powerup running, neon city visible |
| `character-selection.png` | Character Select (pick a colourful hero like ZARA or ATLAS) |
| `training-mode.png` | Training mode run |
| `boss-fight.png` | Omega Guardian fight with the boss HP bar on screen |
| `mobile-landscape.png` | Mobile landscape with touch controls visible |

## How to capture

1. Build and open the game:
   ```bash
   npm run build
   ```
   Then open `dist/index.html`.

2. Press <kbd>F11</kbd> for fullscreen so no browser chrome is captured.

3. Capture with:
   - **Windows** — <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>
   - **macOS** — <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>4</kbd>
   - **Linux** — GNOME Screenshot / Spectacle / Flameshot

4. Save as PNG. **1920 × 1080** is ideal.

### Mobile shot without a phone

Open DevTools (<kbd>F12</kbd>) → click the **device toolbar** icon
(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>) → pick a phone → rotate to
**landscape** → capture. The on-screen touch controls appear automatically.

## Tips for great shots

- Set **Graphics → Ultra** in Settings first so bloom and particles are maxed.
- Grab gameplay shots when the **NULL threat level is 3+** — the red city tint
  looks dramatic.
- Time a shot during a **dash** for the speed streaks and camera zoom.
- Catch a **500 m milestone** or **perfect dodge** for the golden shockwave ring.

## Animated preview (recommended)

A short GIF at the top of the README has far more impact than a static banner.
Record 10–15 seconds covering: boot animation → menu → character select →
gameplay → boss fight.

Tools: [ScreenToGif](https://www.screentogif.com/) (Windows),
[Kap](https://getkap.co/) (macOS), [Peek](https://github.com/phw/peek) (Linux).

Save it as `assets/gameplay.gif`, then replace the banner line at the top of
`README.md` with:

```md
<p align="center">
  <img src="assets/gameplay.gif" width="100%">
</p>
```

Keep the GIF under ~10 MB so GitHub renders it inline.

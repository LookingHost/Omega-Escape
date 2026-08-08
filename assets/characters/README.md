# Characters

Per-character visual references and future sprite sheets.

```
characters/
├── nex/        # The Runner — cyan scarf, blue speed trails
├── zarra/      # The Hacker — appears as zara in code (legacy alias: zarra)
├── void/       # The Shadow — hooded, purple smoke
├── rift/       # The Rebel — spiky blue hair, electric fist
├── luna/       # The Scout — bunny ears, yellow jet
└── atlas/      # The Tank — heavy armor, shockwaves
```

Currently characters are drawn procedurally in `src/game/engine.ts` via `CharFigure`
using `src/game/characters.ts` definitions (silhouette, colors, personality).
Place future hand-drawn sprites, turnarounds, or animation strips here.

No placeholder files are committed — add real art when available.

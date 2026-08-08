# pages/

Page-level views — only create when the app actually has distinct routes.

Possible future:

```
pages/
├── Home.tsx
├── Game.tsx
├── Characters.tsx
└── Training.tsx
```

Currently the game uses a single-page screen state in `App.tsx` (`menu | briefing | playing | paused | gameover | characters | shop | missions | achievements | scores | settings`).

Do not create fake pages now.

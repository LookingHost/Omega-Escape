# hooks/

Reusable React hooks — create only when actually needed.

Potential:

```
hooks/
├── useGame.ts      # wraps GameEngine lifecycle
├── useAudio.ts     # audio settings sync
└── useKeyboard.ts  # remappable controls
```

Currently hooks are inline in `App.tsx` (`flash`, `persist`, `resolveLoadout`).
Do not create unnecessary abstractions.

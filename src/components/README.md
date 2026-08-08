# components/

Reusable UI extracted from `App.tsx` when it improves maintainability.

Currently all screens (Menu, CharacterSelect, Shop, Missions, Achievements, Scores, Settings, Briefing, GameHud, TouchControls, GameOver, Pause) live in `App.tsx` and share the same cyberpunk visual language (Panel, NeonBtn, CharFigure).

**Do not** extract components artificially just to fill this folder.

Extract only when:

- A section is clearly reusable
- Visual design stays identical after extraction
- No gameplay logic is changed

Example future extraction:

```
components/
├── MainMenu.tsx
├── CharacterSelect.tsx
├── GameHUD.tsx
├── PauseMenu.tsx
├── GameOver.tsx
└── LoadingScreen.tsx
```

Keep functionality 100% intact when extracting.

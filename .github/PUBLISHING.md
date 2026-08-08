# Publishing Checklist

Everything to do once, before and after making the repo public.

---

## 1. Pre-flight

```bash
npm run build          # confirm dist/index.html is produced
```

Open `dist/index.html` by double-clicking — it must play with no server.

Verify these are **not** committed (they're in `.gitignore`):

- `node_modules/`
- `.vscode/`
- `.env`
- ZIP archives, backups, temp screenshots

---

## 2. Screenshots

Capture the six images listed in [`assets/screenshots/README.md`](../assets/screenshots/README.md)
and drop them in that folder. Filenames must match exactly or the README
images will 404.

---

## 3. Push

```bash
git add .
git commit -m "Add README, license, brand assets and Pages deploy workflow"
git push
```

---

## 4. Enable GitHub Pages

1. **Settings → Pages**
2. **Source** → **GitHub Actions**
3. Push to `main` (or run the workflow manually from the **Actions** tab)

Live URL:
```
https://<username>.github.io/<repo-name>/
```

Paste that into the **🎮 Play Now** section at the top of `README.md`, and also
into **About → Website** on the repo sidebar.

---

## 5. Repository topics

**Code** tab → click the ⚙️ next to **About** → **Topics**:

```
game
2d-game
cyberpunk
endless-runner
typescript
react
vite
canvas
html5-game
web-game
indie-game
mobile-game
neon
javascript
```

---

## 6. About section

- **Description:**
  `A cinematic cyberpunk endless runner. Escape the Network, outrun NULL. Built with React + TypeScript + Canvas.`
- **Website:** your Pages URL
- ✅ Check **Use your GitHub Pages website**

---

## 7. Releases

**Releases → Create a new release.** Suggested history:

| Tag | Title | Notes |
|---|---|---|
| `v0.8` | Prototype | Core runner loop, first obstacles |
| `v0.9` | Training Update | Training mode, tutorials, tuning |
| `v1.0` | Public Demo | Six characters, NULL threat system, bosses, full UI |
| `v1.1` | Character Expansion | Extra skins, trails, cosmetics |
| `v1.2` | NULL Boss Update | Expanded boss mechanics and encounters |

Attach `dist/index.html` as a release asset so people can download and play
offline instantly.

---

## 8. Pin the repo

**Your GitHub profile → Customize your pins → select Omega Escape.**

---

## 9. Optional polish

- Add a `gameplay.gif` at the top of the README (biggest single upgrade)
- Add social preview image: **Settings → Social preview → Upload** `assets/banner.png`
- Share on r/webgames, r/IndieDev, r/incremental_games

# Dominó Boricua

Puerto Rican–style dominoes in 3D for PC, built to ship on Steam and other PC stores.
Set in a *chinchorro* (roadside bar) at night, against three AI rivals: Papo (vejigante mask),
Doña Lola and Cheo.

**Launch guide (Spanish):** [docs/LANZAMIENTO_STEAM.md](docs/LANZAMIENTO_STEAM.md)

- **Two modes**
  - **Ruleta Boricua**: every player for themselves. Whoever ends a hand holding the most pips puts
    their own six-chamber revolver to their head. The cylinder is never re-spun, so the odds climb
    (1/6, 1/5, …). Last one alive wins.
  - **Parejas (classic)**: 2 vs 2 partners to 500.
- **Rules engine** (`src/engine/`): pure TypeScript, unit-tested. Double-six set, 7 tiles each, no
  boneyard, counter-clockwise play, first hand opens with the highest double, capicú bonus,
  tranque (blocked game) resolution, revolvers and eliminations (`pullTrigger`).
- **3D table** (`src/three/`): Three.js scene. Every model and texture is generated in code (no
  third-party art to license). First-person camera, clickable 3D tiles, camera turns toward
  whoever is holding the revolver.
- **AI** (`src/engine/ai.ts`): Easy / Normal / Hard. Hard tracks which numbers each player has
  passed on and plays to starve opponents and feed its partner.
- **Game UI** (`src/ui/`): HTML HUD over the 3D canvas, Spanish/English, synthesized sounds
  (tile clack, coquí, gunshot, empty-chamber click), no third-party audio.
- **Desktop shell** (`electron/`): Electron app with optional Steamworks (achievements, overlay)
  via `steamworks.js`. Without a Steam App ID it runs as a normal DRM-free game (itch.io, GOG…).

## Develop

```bash
npm install
npm run dev        # browser at http://localhost:5173
npm test           # engine + layout unit tests
npm run app        # build and open the desktop app
npx playwright test  # end-to-end: plays Ruleta (incl. the revolver) and Parejas in the browser
```

## Package

```bash
npm run dist:steam   # unpacked folder in release/ (what you upload with SteamPipe)
npm run dist         # installers (NSIS on Windows, DMG on macOS, AppImage on Linux)
```

To test Steam features locally, put your App ID in `steam_appid.txt` at the project root
(git-ignored) and have the Steam client running.

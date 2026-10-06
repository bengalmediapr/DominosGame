# Dominó Boricua

Puerto Rican–style dominoes for PC, built to ship on Steam and other PC stores.

- **Rules engine** (`src/engine/`): pure TypeScript, unit-tested. 2 vs 2 partners, double-six set,
  all 28 tiles dealt, counter-clockwise play, first hand opens with the double six, to 500 points,
  capicú bonus, tranque (blocked game) resolution.
- **AI** (`src/engine/ai.ts`): Easy / Normal / Hard. Hard tracks which numbers each player has
  passed on and plays to starve opponents and feed its partner.
- **Game UI** (`src/ui/`): Spanish/English, synthesized sounds (tile clack, coquí), no third-party art.
- **Desktop shell** (`electron/`): Electron app with optional Steamworks (achievements, overlay)
  via `steamworks.js`. Without a Steam App ID it runs as a normal DRM-free game (itch.io, GOG…).

## Develop

```bash
npm install
npm run dev        # browser at http://localhost:5173
npm test           # engine + layout unit tests
npm run app        # build and open the desktop app
npx playwright test  # end-to-end: plays a full hand in the browser
```

## Package

```bash
npm run dist:steam   # unpacked folder in release/ (what you upload with SteamPipe)
npm run dist         # installers (NSIS on Windows, DMG on macOS, AppImage on Linux)
```

To test Steam features locally, put your App ID in `steam_appid.txt` at the project root
(git-ignored) and have the Steam client running.

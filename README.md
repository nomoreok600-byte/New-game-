# Nova Pop — Infinite Block Puzzle 🌌

A juicy, addictive, **infinite** block-merge puzzle game built with React + Vite. Installable as a PWA and ready to ship to Google Play as a Trusted Web Activity (TWA).

**The loop:** drag pieces onto the 8×8 board, **merge** same-color blocks into bigger clusters, and **pop** full rows and columns. Chain moves without breaking the chain for combos.

## Game features

| Feature | What it does |
| --- | --- |
| ♾️ Endless mode | Board never repeats; runs are saved automatically so you can continue any time |
| ⏱️ Puzzle Time | 2-minute daily run with a rotating challenge, identical for every player (seeded) |
| ✨ Merging | Same-color neighbors fuse into one bigger block — board management is a real skill |
| 💥 Combos | Chain merges/clears on consecutive moves for escalating combo pills |
| ❤️ Lives × Second Chance | Getting stuck spends a life and deals fresh pieces; on game over, trade a life to keep your score |
| 🏅 Achievements | 12 unlockables with unlock toasts |
| 🔥 Daily streak | Come back every day to grow your streak |
| 📊 Stats | Best score, stars, lifetime lines, games played |
| 🔊 Juice | WebAudio pops, haptics, floating scores, clear/merge animations, board-health bar |
| 📴 Offline | Service worker caches the game — fully playable with no connection |

## Tech

- React 18 + TypeScript + Vite, zero game libraries (custom engine in `src/game/engine.ts`)
- localStorage persistence (`src/game/storage.ts`) — no accounts, no tracking
- PWA: `public/manifest.webmanifest`, `public/sw.js`, generated icons (`bun run icons`)

## Development

```bash
bun install        # install
bun run dev        # dev server (binds 0.0.0.0, uses $PORT)
bun tsc --noEmit   # typecheck
bunx vite build    # production build → dist/
bun run icons      # regenerate PWA/launcher icons
```

## Publishing to Google Play (TWA route)

1. **Deploy the web app** — use the Freebuff **Deploy** button (build: `bunx vite build`, static output in `dist/`). You need a live HTTPS URL.
2. **Install the tooling** (one-time, on your machine):
   ```bash
   npm i -g @bubblewrap/cli
   bubblewrap doctor
   ```
   Requires JDK 17 and Android SDK (the doctor will point you at them).
3. **Init the TWA project:**
   ```bash
   bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest
   ```
   It reads your icons and generates signing keys. **Back up the `keystore` + passwords** — you need the same key for every future update.
4. **Build the bundle:**
   ```bash
   bubblewrap build
   ```
   This produces `app-release-bundle.aab` (Play) and `app-release-signed.apk` (sideload testing).
5. **Play Console** ([play.google.com/console](https://play.google.com/console)) — one-time $25 fee:
   - Create app → Game → Free
   - Upload the `.aab` in **Production → Releases**
   - Store listing: description, screenshots (phone + 7" tablet), feature graphic 1024×500, high-res icon 512×512 (use `public/icon-512.png`)
   - **App content:** privacy policy URL (required), data safety form (this game collects *nothing* — say so), content rating questionnaire, target audience (13+ is the simple path)
6. **Submit.** Review typically takes a few days for new accounts.

### Alternative: Capacitor (when you want native plugins/monetization later)

```bash
bun add -d @capacitor/cli && bun add @capacitor/core @capacitor/android
npx cap init "Nova Pop" com.yourname.novapop --web-dir=dist
bunx vite build && npx cap add android && npx cap open android
```
Then build/sign the AAB from Android Studio.

### Later: verify the packaged build

After Play publishing, test the install flow by opening your deployed URL on an Android phone — Chrome will offer "Install app" via the PWA prompt, which uses the exact same manifest.

## Roadmap ideas

- Level-based Journey mode with stars
- Cloud save via optional accounts
- Leaderboards (Play Games Services) once the TWA is live
- Reward video ads on Second Chance (AdMob) — the natural monetization hook

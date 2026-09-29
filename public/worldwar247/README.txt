================================================================
 WORLD WAR 24/7 — CINEMATIC 1v1 NATION TOURNAMENT STREAM
 cPanel / Static Hosting Edition — Upload & Go
================================================================

WHAT THIS IS
------------
A fully autonomous, 24/7 cinematic eSports broadcast:
  • 192-nation master pool → 128 active bracket + 64 benched
  • Single elimination: 7 rounds, 127 matches per tournament
  • ~12s pre-match intro → 50–70s cinematic fight → 12s killcam/post
  • Director Camera AI (close-quarters zoom, wide duels, slow-mo killcam)
  • 4 biomes (Jungle / Desert / Cyber City / Snow) with rain, thunder,
    sandstorms, snowfall and ice physics
  • Full arsenal: knife, katana (deflects bullets), dual guns, assault
    rifle, heavy shotgun, railgun sniper, RPG, medkits, auto-turrets
  • Hazards: explosive barrels, destructible bridges, napalm fire zones
  • Rivalry/nemesis engine with head-to-head history
  • Championship ceremony: confetti, fanfare, all-time top-10 leaderboard
  • Rotation engine: champ+finalist immune, 64 benched guaranteed in,
    62 sampled, 64 rotate out — new bracket every ~3 hours of stream
  • Crash recovery: the exact tournament/match resumes after a refresh

100% static files. No Node.js, no PM2, no database, no build step.
Everything persists in the viewer's browser (localStorage) with
JSON export/import for backups (buttons in the top bar).

cPanel UPLOAD (2 minutes)
-------------------------
1. Log in to cPanel → File Manager.
2. Navigate to public_html/ (or a subfolder like /stream/).
3. Click Upload → select this worldwar247.zip file.
4. Back in File Manager: right-click the zip → Extract.
5. (Optional) Move the extracted files directly into public_html/ if
   you want the stream at your domain root instead of /worldwar247/.
6. Visit https://yourdomain.com/worldwar247/ — the broadcast starts
   instantly at Tournament #1, Match 1.

That's it. Point OBS at the page (Browser Source, 1920x1080) or just
leave a browser/TV on the page — it runs unattended forever.

RECOMMENDED cPanel SETUP (OBS-style 24/7 output)
------------------------------------------------
• Broadcast page:      https://yourdomain.com/worldwar247/
• Best with OBS:       Browser Source 1920x1080 @ 60 FPS → YouTube
• Or a dedicated box:  any always-on browser in fullscreen (F11)
• Sound:               starts muted by design; click SOUND ON once
• JSON backups:        ⬇ JSON exports the full save (stats, bracket,
                       rotation); ⬆ LOAD restores it after a wipe

FILES
-----
index.html       Broadcast layout (1920x1080 stage, HUD, ticker)
favicon.svg      Favicon
robots.txt       Crawler policy
js/countries.js  192-nation database (flags, colors, perks, Elo)
js/store.js      Bracket, rotation engine, stats, rivalries, save/load
js/sim.js        Combat sim: AI, weapons, airdrops, hazards, weather
js/render.js     Canvas renderer: biomes, particles, camera, FX
js/show.js       Show director: phases, HUD sync, ceremony, ticker
js/audio.js      Procedural WebAudio SFX (no asset files)
js/main.js       Bootstrap + control buttons (sound/export/import/reset)

TIPS
----
• Hosting a SECOND channel? Upload to another folder — each browser
  keeps its own independent tournament state.
• The RESET button (top bar) wipes the save and restarts at
  Tournament #1 if you ever want a clean slate.
• All combat is deterministic per match seed, so exported JSONs are
  reproducible references for any given moment.

================================================================
 Generated for static deployment — no server-side requirements.
================================================================

// Build for static hosting: the broadcast IS the site, so dist/ is a plain
// copy of public/worldwar247/ with index.html at the root. No bundling, no
// dependencies — the game is hand-rolled vanilla ES modules.
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public/worldwar247", "dist", { recursive: true });
console.log("[worldwar247] dist/ ready (static broadcast)");

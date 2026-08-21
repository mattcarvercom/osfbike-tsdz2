// Serves a JSON directory listing of the (symlinked) releases/motor and
// releases/display folders, so the Build & flash and Display firmware pages
// can offer real, currently-on-disk release files as built-in picks without
// duplicating them into this app - releases/ (repo root) stays the one
// place they're maintained (see public/releases -> ../../../releases,
// releases/motor/README.md, releases/display/README.md). No manifest is
// checked into source; it's always computed fresh from whatever files
// actually exist, in dev (a server middleware) and in a production build
// (emitted as a build asset) alike.
import type { Plugin } from "vite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES_DIR = fileURLToPath(new URL("../../releases", import.meta.url));
const MOTOR_RELEASES_DIR = join(RELEASES_DIR, "motor");
const DISPLAY_RELEASES_DIR = join(RELEASES_DIR, "display");

/**
 * Lists release files directly in `dir`, plus one level into `dir/legacy/`
 * if it exists (returned as `legacy/<name>`, so callers can tell current
 * from legacy releases apart without a second manifest - see
 * display-flash-page.ts's basename()/releaseSource()). `legacy/` is the one
 * deliberate opt-in; any other subdirectory (e.g. a future
 * releases/motor/backup/) is still ignored, same as before. Each tier is
 * newest-first by mtime (filenames aren't a reliable sort key - see
 * releases/motor/*.hex's mixed date/version naming), current tier always
 * listed before legacy regardless of mtime, so a stale legacy mtime (e.g.
 * from a fresh checkout) can't make it sort above current releases.
 */
function listReleaseFiles(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const listFlat = (d: string, namePrefix: string): string[] =>
    readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isFile() && extensions.some((ext) => e.name.endsWith(ext)))
      .map((e) => e.name)
      .sort((a, b) => statSync(join(d, b)).mtimeMs - statSync(join(d, a)).mtimeMs)
      .map((name) => namePrefix + name);

  const legacyDir = join(dir, "legacy");
  return [...listFlat(dir, ""), ...(existsSync(legacyDir) ? listFlat(legacyDir, "legacy/") : [])];
}

const HEX_EXTENSIONS = [".hex"];
// Display releases also include raw .bin (860C/850C UART bootloader targets
// take a raw firmware image, not Intel HEX - see uart-flasher.ts) alongside
// .hex (SW102's SWD bootstrap).
const DISPLAY_EXTENSIONS = [".hex", ".bin"];

export function firmwareManifestPlugin(): Plugin {
  return {
    name: "firmware-manifest",
    configureServer(server) {
      server.middlewares.use("/releases/motor/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(listReleaseFiles(MOTOR_RELEASES_DIR, HEX_EXTENSIONS)));
      });
      server.middlewares.use("/releases/display/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(listReleaseFiles(DISPLAY_RELEASES_DIR, DISPLAY_EXTENSIONS)));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "releases/motor/manifest.json",
        source: JSON.stringify(listReleaseFiles(MOTOR_RELEASES_DIR, HEX_EXTENSIONS)),
      });
      this.emitFile({
        type: "asset",
        fileName: "releases/display/manifest.json",
        source: JSON.stringify(listReleaseFiles(DISPLAY_RELEASES_DIR, DISPLAY_EXTENSIONS)),
      });
    },
  };
}

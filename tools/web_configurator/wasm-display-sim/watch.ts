// Rebuilds the display UI sim on every source change - a live
// edit -> recompile -> see-it-in-the-sim loop for working on the real
// 860C/850C display UI source (firmwares/display/860C/, vendored from
// Color_LCD_860C - see its README.md). See tools/CLAUDE.md's
// "Display UI sim" section for the full picture.
//
// Requires the Emscripten SDK on PATH already (same as a one-off
// build.sh run - see README.md's "Rebuilding the WASM assets"; the
// simplest way is `source .emtoolchain/emsdk_env.sh` if that's where yours
// lives). Run this in its own terminal, alongside `npm run dev`:
//
//   node --experimental-strip-types wasm-display-sim/watch.ts
//   (or: npm run watch:display-sim)
//
// Then edit firmwares/display/860C/**/*.c (or *.h, or wasm-display-sim/
// *.c itself) and save. This reruns build.sh, which rewrites
// src/wasm/display-sim.{mjs,wasm} - Vite's dev server picks up the
// rewritten .mjs as a real source change and does a full reload of any
// open tab that imported it (WASM modules aren't hot-swappable, but a full
// reload is a non-issue here - the sim always boots fresh on load anyway).
// Confirmed empirically, not just assumed: touching display-sim.mjs while
// a sim tab is open does trigger Vite's own reload, no extra wiring needed
// on this app's side.
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Both directories this build actually compiles from - see build.sh's own
// COMMON/DISPLAY_860C_850C variables for why these two.
const watchDirs = [
  here, // wasm-display-sim/*.c - the fake-hardware glue itself
  path.join(here, "../../../firmwares/display/860C"), // the real display UI source
];

let building = false;
let queued = false;

function build(): void {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  console.log("\n[watch] rebuilding...");
  const proc = spawn("bash", ["build.sh"], { cwd: here, stdio: "inherit" });
  proc.on("exit", (code) => {
    building = false;
    console.log(
      code === 0
        ? "[watch] rebuild OK - any open sim tab should auto-reload in a moment."
        : `[watch] rebuild FAILED (exit ${code}) - fix the error above and save again.`,
    );
    if (queued) {
      queued = false;
      build();
    }
  });
}

// Multiple files often save together (an editor's "save all", or a single
// logical change touching a .c and its .h) - debounce so those collapse
// into one rebuild instead of a rebuild-storm.
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
const debouncedBuild = debounce(build, 200);

for (const dir of watchDirs) {
  try {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || !/\.(c|h)$/.test(filename)) return;
      console.log(`[watch] changed: ${filename}`);
      debouncedBuild();
    });
    console.log(`[watch] watching ${dir}`);
  } catch (err) {
    console.error(`[watch] could not watch ${dir}: ${(err as Error).message}`);
  }
}

console.log("[watch] ready - edit firmwares/display/860C/**/*.c (or wasm-display-sim/*.c) and save.");
build(); // catches any edits already made before this started watching

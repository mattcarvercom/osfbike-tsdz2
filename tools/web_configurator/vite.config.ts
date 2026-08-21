import { defineConfig } from "vite";
import { firmwareManifestPlugin } from "./firmware-manifest-plugin.ts";

// Only needed for one thing: excluding .emtoolchain/ (an emsdk install -
// see wasm-display-flash/build.sh and README.md's "Rebuilding the WASM
// assets" section) from Vite's dev-server file watcher. A full Emscripten
// SDK install is tens of thousands of files; watching it alongside the rest
// of this project hits the OS's inotify watch limit and crashes `npm run
// dev`/`npm run test:e2e` with ENOSPC on any machine where emsdk lives at
// that path (which tools/CLAUDE.md documents as the expected location).
// .emtoolchain/ is gitignored either way - this only affects what the local
// dev server watches, not what's built/shipped.
export default defineConfig({
  plugins: [firmwareManifestPlugin()],
  server: {
    watch: {
      ignored: ["**/.emtoolchain/**"],
    },
  },
  // __APP_BUILD_DATE__: a compile-time constant (see app-state.ts's
  // APP_BUILD_DATE and vite-env.d.ts's ambient declaration), not an
  // import.meta.env var - always "today" for whichever machine/CI runner
  // actually runs `npm run dev`/`npm run build`, never hand-maintained.
  // Nothing under src/__tests__ currently imports app-state.ts (verified -
  // those run under plain `node --test`, which never applies this
  // replacement) - if that ever changes, this constant would need a
  // fallback for the non-Vite test runner too.
  define: {
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
});

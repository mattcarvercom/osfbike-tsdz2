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
});

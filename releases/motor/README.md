# Motor firmware releases

Built `.hex` files for the STM8 motor controller (this fork's own firmware,
built via the web configurator's in-browser SDCC pipeline or a native
`make` - see `../../tools/CLAUDE.md`).

Symlinked into `tools/web_configurator/public/releases/motor` so the web
configurator's Build & flash page can offer these as built-in picks
(`firmware-manifest-plugin.ts` lists whatever's actually here fresh on
every page load - nothing here is duplicated into the app itself).

Naming convention: `<label>-TSDZ2-<version>-<timestamp>.hex`, where
`<label>` is whatever short, descriptive name distinguishes the build
(motor/wheel/battery combo, bike name, tuning profile - your call). Pruned
to the most recent file per label - older iterations live in git history,
not here.

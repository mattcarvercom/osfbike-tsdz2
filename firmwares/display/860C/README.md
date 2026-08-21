# 860C/850C display firmware

Vendored from [emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C) at
tag `v20.1C.5-860C-update-2`, commit `51cfddda826e3b1870981a8b75b91bc3d39d4471`
(2026-07-02). Copied as a **snapshot, not a submodule** (2026-08-19) — this repo owns
this copy going forward and edits it directly, starting with an LVGL-based UI rewrite
(µGUI's bitmap-font, non-anti-aliased rendering is being replaced). See
`860C_FROM_SOURCE_BUILD.md` (repo root) for the investigation that established this pin
point, confirmed a working from-source build, and diagnosed the two build-blocking bugs
already fixed permanently in this copy (see below).

The LVGL rewrite itself (`common/src/theme_osf_modern.c` + the
`dashboard_theme.h`/`.c` theme registry) is complete as of 2026-08-19 — all
5 screens (main, graph, config, boot, fault) are real, not placeholders.
See `../../../tools/CLAUDE.md`'s "OSF Modern LVGL dashboard theme" section
for the full architecture writeup and status. Not yet verified against
real hardware.

Only `common/` and `860C_850C/` were vendored here — `SW102/` (nRF51822/BLE, a
completely different UI/hardware class) has its own independent copy at
`firmwares/display/SW102/`, including its own copy of `common/`, since this copy's
`common/` is expected to diverge significantly (µGUI → LVGL) and can no longer serve
SW102's still-µGUI-based build once that happens. `firmware/assets/` (two small PNGs,
only referenced in a `fonts.c` provenance comment, not a build dependency) was left
behind as unneeded.

**License**: every vendored source file's own header states "Released under the GPL
License, Version 3" — matches this repo's own root `LICENSE`, so no separate vendored
copy is needed. No LICENSE file exists at the upstream repo's root either way.

**Permanent local fixes** (folded in at vendoring time, no longer "revert after
testing" since this is now owned code — see `860C_FROM_SOURCE_BUILD.md` for the full
diagnosis of both):
- `860C_850C/src/fault.c`: `HardFault_Handler`'s trailing `.syntax divided` was changed
  to `.syntax unified` — the directive is sticky for the rest of the assembled file and
  was corrupting GCC's own auto-generated code for the next function.
- `860C_850C/src/stm32_flash.ld`: the `MEMORY` block's `DEFINED(USE_WITH_BOOTLOADER)`
  ternary was hand-evaluated to its bootloader-branch constants — some linker versions
  can't parse `DEFINED()` in that position, and every buildable `DISPLAY_VERSION` target
  in this Makefile sets `BOOTLOADER=yes` anyway, so the other branch was unreachable.

**Building**: see `860C_FROM_SOURCE_BUILD.md`'s reproduction recipe (paths there now
point here instead of the old submodule location).

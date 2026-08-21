# SW102 display firmware

Vendored from [emmebrusa/Color_LCD_860C](https://github.com/emmebrusa/Color_LCD_860C) at
tag `v20.1C.5-860C-update-2`, commit `51cfddda826e3b1870981a8b75b91bc3d39d4471`
(2026-07-02) — same pin point as `firmwares/display/860C/`. Copied as a **snapshot, not a
submodule** (2026-08-19).

This is an **independent copy**, not shared with `firmwares/display/860C/`, even though
both include a full copy of `common/`. The two are expected to diverge: the 860C copy's
`common/` is being rewritten from µGUI to LVGL, while this copy stays on the original,
unmodified µGUI-based UI stack — SW102 (nRF51822, BLE, a small monochrome-ish OLED) is
explicitly out of scope for that rewrite. No local fixes have been applied here; this is
a plain, untouched snapshot.

See `SW102_FIRMWARE_NOTES.md` (repo root) for the build/OTA-package pipeline, which was
already working against the old submodule location and now points here instead.

**One permanent local fix** (folded in at vendoring time; previously applied as a
working-tree-only edit and reverted after each build, back when this was a pristine
submodule): `SW102/gcc_nrf51.ld`'s `MEMORY` block had the same
`DEFINED(USE_WITH_BOOTLOADER)`-in-ternary parsing bug as 860C's `stm32_flash.ld` (see
`860C_FROM_SOURCE_BUILD.md`) - hand-evaluated to its always-true branch, since this
target's `Makefile` unconditionally sets `USE_WITH_BOOTLOADER = true`.

**License**: every vendored source file's own header states "Released under the GPL
License, Version 3" — matches this repo's own root `LICENSE`, so no separate vendored
copy is needed. No LICENSE file exists at the upstream repo's root either way.

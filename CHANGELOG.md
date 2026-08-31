# Changelog

One shared log for both firmwares this repo builds - the motor controller
(`firmwares/motor/tsdz2/`) and the displays (`firmwares/display/`) - since
they're versioned and released together as one project, not two loosely
coupled forks. Format follows [Keep a Changelog](https://keepachangelog.com/),
versions follow [SemVer](https://semver.org/) (no `v` prefix - see
`releases/display/README.md` for why).

Entries accumulate under **[Unreleased]** and stay there - a version number
only gets its own dated section once it's actually cut as a release, not on
every change. `1.0.0` is the current working number (shown on both the
860C/850C boot screen and Configuration -> Technical info -> "Display
firmware"), still alpha/unreleased.

This log starts from when the two firmwares' history was reorganized under
`firmwares/`; earlier history lives in `git log`, not here.

## [Unreleased]

### Display firmware

- "OSF Modern" LVGL dashboard theme for 860C/850C/850C_2021 - full rewrite
  of the main riding screen, graph screens, config screen, boot screen, and
  fault screen (`firmwares/display/860C/common/src/theme_osf_modern.c`,
  `dashboard_theme.c`). Flashed and ridden on a real 860C (V13) as of
  2026-08-27; 850C/850C_2021 share this source but haven't had their own
  hardware pass yet.
- Assist level capped at 5 (was 9), matching the DZ40 display's 5 physical
  PAS gears.
- Motor power bar scaling options reordered into sequential order
  (`0.1x` ... `5x`, then the two "disable" options).
- Assist-mode card now highlights teal while UP/DOWN is actively cycling
  it, matching the existing assist-level customization highlight.
- Fixed long-press-M (enter configuration) silently doing nothing at PAS 0.
- Fixed a crash/lockup when cycling PWR back to the main screen from the
  last graph page - screen transitions now free the outgoing screen before
  building the new one, instead of transiently holding both in LVGL's 16 KB
  heap at once.
- Boot screen now shows this display firmware's own SemVer
  (`DISPLAY_FIRMWARE_MAJOR/MINOR/PATCH`, `common/Makefile.common`) instead
  of the legacy combined motor+display `VERSION_STRING`, and shows the
  correct board label (860C/850C/850C (2021)) instead of a hardcoded
  "860C" regardless of target.
- New release artifact naming/versioning scheme for this project's own
  builds: `<TARGET>-<semver>[+<metadata>].bin`, e.g.
  `860C-1.0.0+V13.bootloader.bin` - see `releases/display/README.md`.
- CRC16 UART protocol port for 860C/850C (paired with the matching motor
  firmware change below), gated off by default
  (`ENABLE_860C_LVGL_UART` in `config.h`). Hardware-verified along with the
  theme above - the 860C ride exercises this protocol live, not just the sim.

### Motor firmware

- CRC16 UART protocol support for 860C/850C displays running the new LVGL
  UART protocol, gated off by default alongside the display-side flag
  above - existing DZ40 pairings are unaffected. Hardware-verified as of
  2026-08-27 (see display firmware entry above).

### Repo structure

- Moved `src/` to `firmwares/motor/tsdz2/src/`, and `firmware/display/` to
  `firmwares/display/` (860C and SW102), consolidating both firmwares'
  sources under one `firmwares/` tree.

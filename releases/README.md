# Releases

Pre-built firmware the web configurator (`tools/web_configurator/`) can
offer as a built-in pick on its flashing pages, without rebuilding or
browsing for a file - see each subfolder's own README for what's in it and
how it's served:

- **`motor/`** - this fork's own STM8 motor controller firmware (`.hex`),
  plus `motor/backup/` (raw device backups taken before flashing).
- **`display/`** - stock/pre-built 860C/850C/850C_2021/SW102 display
  firmware (`.bin` or `.hex` depending on target - see that folder's
  README), sourced from upstream (emmebrusa/Color_LCD_860C), not built by
  this project.

Reorganized 2026-08-19 from a single flat `releases/` (motor files +
`backup/` directly at this level, `display/` as a sibling) into this
motor/display split, so the two are symmetric rather than one being special-
cased at the top level. See `../tools/CLAUDE.md`'s "Releases folder
reorganized" note for what moved and what code/paths changed.

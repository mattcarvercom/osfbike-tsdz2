#!/usr/bin/env bash
# Compiles the 860C/850C display's real UI logic (firmwares/display/860C/,
# vendored from Color_LCD_860C - see its README.md for provenance) plus
# sim_glue.c's fake hardware to WASM. Requires the Emscripten SDK on PATH
# (source ../.emtoolchain/emsdk_env.sh first, same toolchain the other
# wasm-*/ build scripts in this repo use).
#
# Output is committed to src/wasm/ rather than gitignored, same reasoning
# as wasm/build.sh: this app is meant to be cloned and run with `npm run
# dev`, not to require Emscripten just to open a page. Re-run this script
# (and commit the result) whenever firmwares/display/860C/ or
# wasm-display-sim/*.c changes.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
	echo "emcc not found on PATH - source ../.emtoolchain/emsdk_env.sh first" >&2
	exit 1
fi

COMMON=../../../firmwares/display/860C/common
DISPLAY_860C_850C=../../../firmwares/display/860C/860C_850C/src
DISPLAY_860C=../../../firmwares/display/860C
LVGL=../../../firmwares/display/860C/lvgl
OUT_DIR=../src/wasm
mkdir -p "$OUT_DIR"

# LVGL core sources: compile the whole src/ tree. Every LVGL source file
# self-guards on lv_conf.h's feature macros (LV_USE_*), so disabled
# widgets/fonts/GPU paths compile to empty translation units and
# Emscripten's function/data-section GC drops them at link time.
mapfile -t LVGL_SRCS < <(find "$LVGL/src" -name '*.c' | sort)

# fault.c deliberately excluded: its non-SW102 branch has a raw ARM Thumb
# "bkpt #0x01" inline asm helper (debugger_break()) that can't target wasm32
# at all, and nothing outside that file calls any of its exports (confirmed
# by grep) - app_error_fault_handler() is only reachable from the real
# 860C-specific fault.c (860C_850C/src/fault.c), which isn't part of this
# sim build either. Not worth a shim; it's simply dead weight here.
#
# mainscreen-850.c + battery_gui.c ARE included below, unlike fault.c -
# they're the 860C/850C-specific "completions" of the shared mainscreen.c
# (real mainScreen1/mainScreen2 layouts, battery icon rendering, clock
# handling) and turned out to need no hardware at all: their main.h/lcd.h/
# timers.h includes (860C_850C/src, added to the include path below) are
# themselves declarations-only, same as ugui_driver/ugui_display_8x0c.h -
# the actual register access lives only in the .c files that implement
# them (lcd.c, timers.c, ...), which still aren't part of this build.
emcc \
	-I "$COMMON/include" \
	-I shim-include \
	-I "$DISPLAY_860C_850C" \
	-I "$DISPLAY_860C" \
	-I "$LVGL" \
	-DLV_CONF_INCLUDE_SIMPLE \
	-DDISPLAY_860C_V13 \
	-DVERSION_STRING=\"0.20.1C-5.2-sim\" \
	-DTSDZ2_FIRMWARE_MAJOR=\"0\" \
	-DTSDZ2_FIRMWARE_MINOR=\"21\" \
	-DTSDZ2_FIRMWARE_PATCH=\"52\" \
	-DDISPLAY_FIRMWARE_MAJOR=\"1\" \
	-DDISPLAY_FIRMWARE_MINOR=\"0\" \
	-DDISPLAY_FIRMWARE_PATCH=\"0\" \
	`# MAJOR/MINOR/PATCH mirror the submodule's own firmware/common/Makefile.common - keep in sync if that ever changes` \
	"$COMMON/src/buttons.c" \
	"$COMMON/src/utils.c" \
	"$COMMON/src/state.c" \
	"$COMMON/src/mainscreen.c" \
	"$COMMON/src/configscreen.c" \
	"$COMMON/src/eeprom.c" \
	"$COMMON/src/dashboard_theme.c" \
	"$COMMON/src/theme_osf_modern.c" \
	"$COMMON/src/lv_font_speed_hero.c" \
	"$COMMON/src/icons_osf_modern.c" \
	"$COMMON/src/ugui_shim.c" \
	"$DISPLAY_860C_850C/mainscreen-850.c" \
	"$DISPLAY_860C_850C/battery_gui.c" \
	"${LVGL_SRCS[@]}" \
	sim_glue.c \
	-O2 \
	-sENVIRONMENT=web \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createDisplaySimModule \
	-sEXIT_RUNTIME=0 \
	-sALLOW_MEMORY_GROWTH=1 \
	-sEXPORTED_FUNCTIONS=_sim_init,_sim_tick,_sim_render_rgba,_sim_get_width,_sim_get_height,_sim_set_button,_sim_set_battery_soc,_sim_set_wheel_speed_x10,_sim_set_cadence,_sim_set_assist_level,_sim_set_battery_power,_sim_set_motor_temperature,_sim_set_human_power,_sim_set_battery_voltage_x10,_sim_set_wall_clock,_sim_set_lights,_sim_get_lights,_sim_set_error,_sim_set_units_imperial,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPU8 \
	-o "$OUT_DIR/display-sim.mjs"

echo "Wrote $OUT_DIR/display-sim.mjs + display-sim.wasm"

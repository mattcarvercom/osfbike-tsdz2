/* No-op stubs for the µGUI + screen.c rendering layer, so the domain-logic
 * files that survive the LVGL port (mainscreen.c, configscreen.c,
 * mainscreen-850.c, battery_gui.c, state.c, eeprom.c) keep compiling and
 * linking after ugui.c/fonts.c/screen.c are dropped from the build. Used by
 * BOTH the WASM sim and the real firmware build (both now replace µGUI with
 * LVGL + these stubs - see tools/web_configurator/wasm-display-sim/build.sh
 * and 860C_850C/src/Makefile).
 *
 * Every stub is a deliberate no-op - the actual LVGL-based rendering is
 * driven elsewhere (sim_glue.c in the sim; the theme registry's build_*
 * functions on real hardware), not here - so a value the domain layer
 * writes into a Field/string simply has nowhere to be drawn yet. Real
 * screen building is later work; this file goes away once mainscreen.c /
 * configscreen.c / mainscreen-850.c's render code is ported to LVGL.
 *
 * Note: the real firmware build still compiles 860C_850C/src/ugui_driver/
 * ugui_display_8x0c.c for its panel bring-up (display_8x0C_lcd_init) and
 * lcd_write_command()/lcd_write_data_8bits() primitives - that file also
 * calls UG_Init()/UG_DriverRegister(), stubbed below, which is fine: the
 * µGUI driver registration becomes a no-op and LVGL takes over rendering.
 */
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "dashboard_theme.h"
#include "screen.h"
#include "fonts.h"
#include "ugui.h"

/* ---- Font objects (fonts.c provided these; dummy instances suffice ----
 * The domain layer only ever passes these to UG_FontSelect() (a no-op
 * below), so a zero-initialized UG_FONT is plenty. Must be external-linkage
 * to satisfy the `extern const UG_FONT FONT_x;` declarations in ugui.h /
 * fonts.h (the enabled USE_FONT_* set is driven by ugui_config.h). */
const UG_FONT FONT_10X16 = {0};
const UG_FONT FONT_12X20 = {0};
const UG_FONT FONT_16X26 = {0};
const UG_FONT FONT_24X40 = {0};
const UG_FONT FONT_32X53 = {0};
const UG_FONT FONT_45X72 = {0};
const UG_FONT FONT_61X99 = {0};
const UG_FONT FONT_CURSORS = {0};
const UG_FONT MY_FONT_BATTERY = {0};

/* screen.c owned these three pointers; configscreen.c's onEnter assigns
 * them (= &CONFIGURATIONS_TEXT_FONT). */
const UG_FONT *editable_label_font = NULL;
const UG_FONT *editable_value_font = NULL;
const UG_FONT *editable_units_font = NULL;

/* ---- screen.c globals referenced by domain-layer files ----------------- */

/* Unit-conversion switches; mainscreen.c sets these from EEPROM units. */
bool screenConvertMiles = false;
bool screenConvertFarenheit = false;
bool screenConvertPounds = false;
bool screenConvertWhPerMiles = false;

/* Graph min/max/threshold state, indexed by the Variables enum. */
variables_t g_vars[VARS_SIZE];
#ifndef SW102
GraphVars g_graphVars[VARS_SIZE];
#endif

uint8_t g_customizableFieldIndex = 0;
volatile bool g_graphs_ui_update[3] = {false, false, false};

/* ---- µGUI classic drawing API (ugui.c provided these) ------------------ */

UG_S16 UG_Init(UG_GUI *g, void (*p)(UG_S16, UG_S16, UG_COLOR), UG_S16 x, UG_S16 y) {
  (void)g; (void)p; (void)x; (void)y;
  return UG_RESULT_OK;
}
void UG_FillScreen(UG_COLOR c) { (void)c; }
void UG_DriverRegister(UG_U8 type, void *driver) { (void)type; (void)driver; }
void UG_FontSelect(const UG_FONT *font) { (void)font; }
void UG_SetForecolor(UG_COLOR c) { (void)c; }
void UG_SetBackcolor(UG_COLOR c) { (void)c; }
void UG_FillFrame(UG_S16 x1, UG_S16 y1, UG_S16 x2, UG_S16 y2, UG_COLOR c) {
  (void)x1; (void)y1; (void)x2; (void)y2; (void)c;
}
void UG_DrawLine(UG_S16 x1, UG_S16 y1, UG_S16 x2, UG_S16 y2, UG_COLOR c) {
  (void)x1; (void)y1; (void)x2; (void)y2; (void)c;
}
void UG_PutString(UG_S16 x, UG_S16 y, char *str) {
  (void)x; (void)y; (void)str;
}

/* ---- screen.c widget/layout engine (screen.c provided these) ----------- */

/* screenShow()/screenOnPress()/getCurrentScreen() are no longer pure
 * no-ops: mainscreen.c's real button dispatch (appwide_onpress(),
 * handle_buttons()) still genuinely calls these, so they now bridge into
 * the LVGL theme layer instead of discarding the calls - see screen.h's
 * doc comment on g_lvgl_requested_screen/g_lvgl_screen_on_press for the
 * full picture. panicScreenShow() also now bridges for real, into
 * dashboard_theme_show_fault() - see its own doc comment further down.
 * screenUpdate() has no LVGL equivalent (nothing calls it in this build)
 * and stays a real no-op. */
Screen *g_lvgl_requested_screen = NULL;
bool (*g_lvgl_screen_on_press)(buttons_events_t events) = NULL;
static Screen *g_current_screen = NULL;

void screen_init(void) {}
void screenShow(Screen *screen) {
  g_current_screen = screen;
  g_lvgl_requested_screen = screen;
}
/* Real implementation now: fault.c's app_error_fault_handler() is the only
 * caller, always with &faultScreen, after already fieldPrintf()-ing real
 * text into that screen's faultCode/addrCode/infoCode Fields (now genuinely
 * stored, see fieldPrintf() above) - theme_osf_modern.c's build_fault_screen()
 * reads those same Fields directly by name rather than this walking
 * `screen->fields[]` generically, since this is the only Screen that's ever
 * passed here and hard-coding it is simpler than a generic Field-to-LVGL
 * walker that would have exactly one caller. `screen` itself is therefore
 * unused - kept as a parameter only because screen.h's real signature
 * (still called by fault.c) has it. */
void panicScreenShow(Screen *screen) {
  (void)screen;
  dashboard_theme_show_fault();
}
void screenUpdate(void) {}
Screen *getCurrentScreen(void) { return g_current_screen; }
bool screenOnPress(buttons_events_t events) {
  return g_lvgl_screen_on_press ? g_lvgl_screen_on_press(events) : false;
}

/* Real implementation (mirrors screen.c's own fieldPrintf() exactly, the
 * one still-relevant consumer being fault.c's app_error_fault_handler() -
 * see panicScreenShow() below, and dashboard_theme.h's doc comment on
 * dashboard_theme_show_fault(). FieldDrawTextRW's .rw->drawTextPtr.msg is
 * a real per-field char[MAX_FIELD_LEN] buffer (screen.h's
 * FIELD_DRAWTEXT_RW macro), not a stub - safe to write into unconditionally
 * for any field of that variant regardless of whether an LVGL screen is
 * currently reading it back. */
void fieldPrintf(Field *field, const char *fmt, ...) {
  va_list argp;
  va_start(argp, fmt);
  char buf[MAX_FIELD_LEN];
  vsnprintf(buf, sizeof(buf), fmt, argp);
  va_end(argp);
  if (field->variant == FieldDrawTextRW) {
    strncpy(field->rw->drawTextPtr.msg, buf, MAX_FIELD_LEN - 1);
    field->rw->drawTextPtr.msg[MAX_FIELD_LEN - 1] = 0;
    field->rw->dirty = true;
  }
}
void updateReadOnlyStr(Field *field, const char *str) {
  (void)field; (void)str;
}
void updateReadOnlyLabelStr(Field *field, const char *str) {
  (void)field; (void)str;
}
void updateTimeStr(uint8_t hours, uint8_t minutes, Field *field) {
  (void)hours; (void)minutes; (void)field;
}
bool renderDrawTextCommon(FieldLayout *layout, const char *msg) {
  (void)layout; (void)msg; return false;
}
int32_t convertUnits(int32_t val, ConvertUnitsType type) {
  (void)type; return val;
}
void update_battery_power_usage_label(void) {}

/* screen.c's graph sampler; the real firmware drives it from a timer ISR.
 * No-op here: there is no graph to feed until real LVGL screen work lands. */
void rt_graph_process(void) {}

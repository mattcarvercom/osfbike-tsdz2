#pragma once
#include "lvgl.h"

/* Registry of selectable dashboard visual styles ("themes"). Each theme
 * lays out the same underlying telemetry data (read from the domain layer -
 * state.h's rt_vars/ui_vars, screen.h's Field/FieldRW) in a different way.
 * Only one placeholder theme exists for now; the whole point of this
 * structure is that more can be added later without touching the domain
 * layer or the screen-switching logic.
 *
 * build_* functions construct a screen's LVGL widgets under `parent`; the
 * caller passes lv_scr_act() (or a newly created screen object). The
 * periodic `update_main_screen` is called once per main-loop tick and is
 * where a real theme would push fresh telemetry values into its widgets.
 */
typedef struct {
  const char *name;                     /* shown in the settings-menu picker */
  void (*build_main_screen)(lv_obj_t *parent);
  void (*update_main_screen)(void);      /* called from the periodic field-update path */
  void (*build_graph_screen)(lv_obj_t *parent);
  void (*update_graph_screen)(void);    /* called from the periodic field-update path, same cadence as update_main_screen */
  /* Config screen: both may be NULL. dashboard_theme_tick() then falls
   * back to osf_modern_theme's own implementation (declared below) rather
   * than requiring every theme to supply one. This is deliberate, not a
   * gap to fill in later: the config menu walks configscreen.c's entire
   * real Field tree (dozens of settings, several menus deep) - genuinely
   * flash-expensive - and restyling it per theme buys nothing a rider
   * would notice, unlike the main screen where the whole point of a theme
   * is to look different. A theme's job is the main riding screen; the
   * config menu is meant to always look like OSF Modern regardless of
   * which theme is active, on purpose. Only override this if a theme has
   * a real reason to (e.g. a monochrome/low-res target where OSF Modern's
   * own rendering assumptions don't fit). */
  void (*build_config_screen)(lv_obj_t *parent);
  void (*update_config_screen)(void);
  /* Boot screen: shown once at startup while the real motor UART handshake
   * (state.h's g_motor_init_state) runs, same real gating logic
   * mainscreen.c's bootScreenOnPreUpdate() used to own before this LVGL
   * port (see dashboard_theme.c's dashboard_theme_boot_complete() doc
   * comment for how that logic was re-hosted). update_boot_screen may be
   * NULL only in theory - every real theme should supply one, since
   * without it the boot screen would show forever (nothing else ever
   * calls dashboard_theme_boot_complete()). */
  void (*build_boot_screen)(lv_obj_t *parent);
  void (*update_boot_screen)(void);
  /* Fault screen: the real crash/assert/hardfault handler
   * (common/src/fault.c's app_error_fault_handler()) calls
   * dashboard_theme_show_fault() below to render this once, then parks
   * forever - there is no update_fault_screen because nothing on this
   * screen ever changes again after that point (the device is meant to be
   * power-cycled, not resumed). */
  void (*build_fault_screen)(lv_obj_t *parent);
} dashboard_theme_t;

extern const dashboard_theme_t *g_available_themes[];
extern const uint8_t g_available_themes_count;

/* The canonical config-screen implementation and fallback target for any
 * theme that leaves build_config_screen/update_config_screen NULL - see
 * the doc comment above. Defined in theme_osf_modern.c; every theme
 * (including that one) goes through this same struct for config, not
 * their own g_available_themes entry, so a future theme can't
 * accidentally end up with no config screen at all. */
extern const dashboard_theme_t osf_modern_theme;

/* Called once at boot (main.c / wasm-display-sim/sim_glue.c's sim_init()),
 * after LVGL's driver/tick/input are ready: selects the active theme from
 * EEPROM's saved index and builds the initial (main) screen. */
void dashboard_theme_init(void);

/* Called every ~20ms tick (main.c's main loop / sim_glue.c's sim_tick()),
 * after main_idle()/lv_timer_handler(): refreshes whichever screen is
 * currently showing, and reacts to the real button-driven request to
 * enter the config screen (mainscreen.c's appwide_onpress(), on the
 * SCREENCLICK_ENTER_CONFIGURATIONS combo, calls the real, compiled
 * screenShow(&configScreen) - screen.c's own renderer, which used to
 * consume that call, is gone, so ugui_shim.c now bridges it into the LVGL
 * theme layer instead of no-opping it; see screen.h's g_lvgl_requested_screen/
 * g_lvgl_screen_on_press for the other half of that bridge). Leaving the
 * config screen is entirely the config screen's own doing (there is no
 * real "show the main screen" domain event to hook), so this only ever
 * reacts to a request for &configScreen specifically. */
void dashboard_theme_tick(void);

/* Called by the active config screen (theme_osf_modern.c) when the user
 * backs all the way out to return to the main screen - see
 * dashboard_theme_tick()'s doc comment for why this isn't routed through
 * screenShow()/g_lvgl_requested_screen like entering config is. */
void dashboard_theme_return_to_main(void);

/* Called by the active theme's own update_boot_screen() once the boot
 * gate (motor handshake complete, on/off button released - real logic
 * ported from mainscreen.c's old bootScreenOnPreUpdate()) is satisfied.
 * Same "screen owns its own exit, not routed through
 * g_lvgl_requested_screen" reasoning as dashboard_theme_return_to_main()
 * above - there is no real domain-level event for "boot finished" either. */
void dashboard_theme_boot_complete(void);

/* Called by common/src/fault.c's app_error_fault_handler() - the real
 * crash/assert/stack-overflow/hardfault handler - once it has formatted
 * fault details into fault.c's own faultCode/addrCode/infoCode Fields
 * (now rendered for real, see ugui_shim.c's fieldPrintf()). Builds and
 * loads the active theme's fault screen and returns immediately; the
 * caller is responsible for keeping LVGL alive afterwards (it parks in an
 * infinite loop pumping lv_timer_handler() itself, since control never
 * returns to main()'s own loop - see fault.c for why). */
void dashboard_theme_show_fault(void);

/* Which of the two graph-bearing slots in mainscreen-850.c's real screens[]
 * cycle (mainScreen2 -> slot 0, mainScreen3 -> slot 1 - mainScreen1 maps to
 * the ordinary main screen instead, see dashboard_theme_tick()'s own
 * comment) is currently showing. Set by dashboard_theme_tick() right before
 * calling build_graph_screen(), read back by that same call so it knows
 * which of graph2/graph3's real, persisted variable-selector Fields to draw
 * from - a plain global rather than a build_graph_screen(lv_obj_t*, int)
 * parameter so every theme's build_graph_screen keeps the same signature as
 * build_main_screen/build_config_screen. */
extern uint8_t g_graph_screen_slot;

/* Set true only by wasm-display-sim/sim_glue.c's sim_init(), before calling
 * dashboard_theme_init() - never by real firmware's main.c, which leaves
 * this false. See theme_osf_modern.c's own doc comment on it (right above
 * where it's defined) for what it changes and why a runtime flag was used
 * instead of a build-time #ifdef. */
extern bool g_graph_screen_demo_mode;

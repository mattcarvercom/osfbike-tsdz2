/* Shared screen-switching logic between the LVGL theme registry
 * (dashboard_theme.h) and the real button-driven navigation still living
 * in mainscreen.c (screenShow()/screenOnPress(), bridged from
 * screen.c-less ugui_shim.c - see screen.h's doc comment on
 * g_lvgl_requested_screen/g_lvgl_screen_on_press). Used identically by
 * both the real firmware (860C_850C/src/main.c) and the WASM sim
 * (wasm-display-sim/sim_glue.c), so this logic exists in exactly one
 * place instead of being duplicated and drifting between the two.
 */
#include "dashboard_theme.h"
#include "screen.h"
#include "configscreen.h"
#include "state.h"

typedef enum {
  DASHBOARD_SCREEN_BOOT = 0,
  DASHBOARD_SCREEN_MAIN,
  DASHBOARD_SCREEN_CONFIG,
  DASHBOARD_SCREEN_GRAPH,
  DASHBOARD_SCREEN_FAULT,
} dashboard_screen_t;

static const dashboard_theme_t *g_active_theme;
static dashboard_screen_t g_active_screen;
uint8_t g_graph_screen_slot;

static void (*active_build_config_screen(void))(lv_obj_t *) {
  return g_active_theme->build_config_screen ? g_active_theme->build_config_screen : osf_modern_theme.build_config_screen;
}

static void (*active_update_config_screen(void))(void) {
  return g_active_theme->update_config_screen ? g_active_theme->update_config_screen : osf_modern_theme.update_config_screen;
}

/* mainscreen-850.c's real screens[] cycle (unmodified domain logic - see
 * showNextScreen()/screenShow() in mainscreen.c/ugui_shim.c) still requests
 * these three Screen structs by pointer identity on every PWR press, same as
 * it always has - only what we DO with that request changed. mainScreen1 (no
 * embedded graph in its real field layout, see mainscreen-850.c) maps to the
 * ordinary main screen; mainScreen2/mainScreen3 (each carrying its own real,
 * independently-persisted graphed-variable selector, graph2/graph3) both map
 * to the one LVGL graph screen, distinguished by g_graph_screen_slot - a
 * deliberate collapse of upstream's 3 near-duplicate main-screen pages (which
 * differed only in which 4 quick-stat fields and which graph slot showed)
 * down to 2 conceptual screens, matching dashboard_theme_t's actual shape
 * (one build_main_screen + one build_graph_screen, not three of each). */
extern Screen mainScreen1;
extern Screen mainScreen2;
extern Screen mainScreen3;

void dashboard_theme_init(void) {
  g_active_theme = g_available_themes[ui_vars.ui8_active_theme_index % g_available_themes_count];
  g_active_screen = DASHBOARD_SCREEN_BOOT;
  g_active_theme->build_boot_screen(lv_scr_act());
}

/* Rebuilds whichever screen `want` is (MAIN or GRAPH) fresh, freeing
 * whatever was showing before FIRST - LV_MEM_SIZE (lv_conf.h) is only
 * 16KB total, and the old screen's objects must be freed before the new
 * screen's build_*() call runs, not after: building first and freeing
 * after (the original order here) briefly holds both screens' objects at
 * once, which the main screen alone (mini-card tiles, side-bar peak
 * markers, mini graph overlay labels) plus the graph screen (its own
 * overlay labels + avg cursor) can exceed, corrupting the LVGL heap and
 * hanging - reproduced 2026-08-20 by cycling PWR past the last graph page
 * back to the main screen. `lv_scr_load(scr)` on the still-empty new
 * screen is safe (LVGL screens are ordinary objects); nothing renders it
 * before build_*_screen() below populates it in this same tick. `slot` is
 * only meaningful for GRAPH (which of graph2/graph3). */
static void switch_to_screen(dashboard_screen_t want, uint8_t slot) {
  lv_obj_t *old_scr = lv_scr_act();
  g_active_screen = want;
  g_graph_screen_slot = slot;
  lv_obj_t *scr = lv_obj_create(NULL);
  lv_scr_load(scr);
  lv_obj_del(old_scr);
  if (want == DASHBOARD_SCREEN_MAIN) {
    g_active_theme->build_main_screen(scr);
  } else {
    g_active_theme->build_graph_screen(scr);
  }
}

void dashboard_theme_tick(void) {
  /* One-shot: consume the request now regardless of what it's for, so a
   * value we don't act on (e.g. &bootScreen) can't linger and be misread on
   * a later tick. &configScreen and screens[]'s three real main-screen
   * variants (mainScreen1/2/3, mainscreen-850.c - still requested by the
   * real, unmodified showNextScreen()/screenShow() on every PWR press) are
   * the only things meaningful to us - everything else is a screen this
   * LVGL build doesn't have an equivalent for yet. */
  Screen *requested = g_lvgl_requested_screen;
  g_lvgl_requested_screen = NULL;

  if (requested == &mainScreen1 && g_active_screen != DASHBOARD_SCREEN_MAIN) {
    switch_to_screen(DASHBOARD_SCREEN_MAIN, 0);
    if (requested->onEnter) requested->onEnter();
  } else if (requested == &mainScreen2) {
    switch_to_screen(DASHBOARD_SCREEN_GRAPH, 0);
    if (requested->onEnter) requested->onEnter();
  } else if (requested == &mainScreen3) {
    switch_to_screen(DASHBOARD_SCREEN_GRAPH, 1);
    if (requested->onEnter) requested->onEnter();
  } else if (requested == &configScreen && g_active_screen != DASHBOARD_SCREEN_CONFIG) {
    /* The main screen is deleted here, not kept alive - unlike everything
     * else in this file, that's not a style choice, it's a direct
     * response to a real measurement: config's ~13-row root list, styled
     * as leanly as this heap allows (theme_osf_modern.c's own memory
     * comments), still only left ~2.6KB free out of LV_MEM_SIZE's 16KB
     * (lv_conf.h) with the main screen's own objects also resident -
     * uncomfortably tight for submenus not yet exercised as thoroughly.
     * Freeing the ~9.7KB the main screen normally holds while config is
     * showing (rebuilt fresh on the way back out, see
     * dashboard_theme_return_to_main()) buys real headroom for a screen
     * users reach rarely, at the cost of an extra rebuild on exit - a
     * trade worth making on a target this RAM-constrained. */
    lv_obj_t *old_main_scr = lv_scr_act();
    g_active_screen = DASHBOARD_SCREEN_CONFIG;
    /* Rebuilt fresh on every entry - always starts back at the config
     * root rather than remembering where the user last left it, which
     * also means there's no stale nav state (cursor position, which
     * submenu was open) to worry about carrying over between visits. */
    lv_obj_t *scr = lv_obj_create(NULL);
    lv_scr_load(scr);
    lv_obj_del(old_main_scr);
    active_build_config_screen()(scr);
    if (configScreen.onEnter) configScreen.onEnter();
  }

  switch (g_active_screen) {
    case DASHBOARD_SCREEN_BOOT:
      if (g_active_theme->update_boot_screen) g_active_theme->update_boot_screen();
      break;
    case DASHBOARD_SCREEN_MAIN:
      if (g_active_theme->update_main_screen) g_active_theme->update_main_screen();
      break;
    case DASHBOARD_SCREEN_CONFIG: {
      void (*update)(void) = active_update_config_screen();
      if (update) update();
      break;
    }
    case DASHBOARD_SCREEN_GRAPH:
      if (g_active_theme->update_graph_screen) g_active_theme->update_graph_screen();
      break;
    case DASHBOARD_SCREEN_FAULT:
      /* Terminal - nothing to refresh, see dashboard_theme_show_fault(). */
      break;
  }
}

/* Called by the config screen itself (theme_osf_modern.c) when the user
 * backs all the way out - there is no real domain-level "show the main
 * screen" event to hook (see dashboard_theme.h's doc comment), so this is
 * a plain function call, not routed through g_lvgl_requested_screen. */
void dashboard_theme_return_to_main(void) {
  if (configScreen.onExit) configScreen.onExit();
  g_active_screen = DASHBOARD_SCREEN_MAIN;
  lv_obj_t *old_config_scr = lv_scr_act();
  lv_obj_t *scr = lv_obj_create(NULL);
  lv_scr_load(scr);
  lv_obj_del(old_config_scr);
  g_active_theme->build_main_screen(scr);
}

void dashboard_theme_boot_complete(void) {
  g_active_screen = DASHBOARD_SCREEN_MAIN;
  lv_obj_t *old_boot_scr = lv_scr_act();
  lv_obj_t *scr = lv_obj_create(NULL);
  lv_scr_load(scr);
  lv_obj_del(old_boot_scr);
  g_active_theme->build_main_screen(scr);
  /* mainScreen1 (not bootScreen) is the real Screen the rest of the app's
   * button/state logic treats as "the main screen is showing" - same
   * mainScreen1.onEnter() call the mainScreen1 branch in
   * dashboard_theme_tick() above makes on every other path into the main
   * screen, so entering via boot-completion doesn't skip whatever real
   * per-entry setup that expects. */
  if (mainScreen1.onEnter) mainScreen1.onEnter();
}

/* See dashboard_theme.h's doc comment. Deliberately never returns to any
 * other screen - a fault is terminal for this boot of the firmware. */
void dashboard_theme_show_fault(void) {
  g_active_screen = DASHBOARD_SCREEN_FAULT;
  lv_obj_t *old_scr = lv_scr_act();
  lv_obj_t *scr = lv_obj_create(NULL);
  lv_scr_load(scr);
  lv_obj_del(old_scr);
  g_active_theme->build_fault_screen(scr);
}

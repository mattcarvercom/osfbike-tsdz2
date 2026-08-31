/* "OSF Modern" dashboard theme - the v1 theme built for real per the LVGL
 * rewrite plan's Phase 5 (main riding screen first). Reads the same
 * domain-layer data every theme will (state.h's rt_vars/ui_vars, the global
 * ui8_g_battery_soc, rtc.h's clock) - a theme only decides how to lay that
 * data out, never what it means. The graph, boot, and fault screens are all
 * real now too (see their own sections further down). The config screen is
 * a real, generic renderer over configscreen.c's own Field/Screen data (see
 * that section further down) - it's also the canonical config screen for
 * every theme, not just this one (dashboard_theme.h's osf_modern_theme
 * doc comment), so it's held to the same bar as the main screen, not
 * treated as a placeholder.
 */
#include <stdio.h>
#include <string.h>
#include <strings.h> /* strcasecmp() - not declared by <string.h> alone */

#include "buttons.h"
#include "dashboard_theme.h"
#include "icons_osf_modern.h"
#include "rtc.h"
#include "screen.h"
#include "configscreen.h"
#include "state.h"
#include "timer.h"
#include "utils.h"

/* Real-hardware-only: the RX byte counter incrementing in usart1.c's
 * USART1_IRQHandler, shown on the boot screen as a live "is anything
 * arriving from the motor?" diagnostic while the handshake stalls. Not
 * included (and not referenced) in the WASM display sim, which has no real
 * UART and fakes an instantly-ready motor. */
#ifdef STM32F10X_MD
#include "usart1.h"
#endif

/* Custom digits-only speed font, lv_font_speed_hero.c - not part of any
 * LVGL header (unlike the built-in lv_font_montserrat_* fonts, declared in
 * lvgl's own lv_font.h), so it needs its own extern here. */
extern const lv_font_t lv_font_speed_hero;

/* Boot screen's hardware label - was hardcoded "860C" regardless of which
 * DISPLAY_VERSION this binary was actually built for (main.h defines exactly
 * one of these per build, see 860C_850C/src/Makefile). Mirrors the target
 * names the web configurator's TARGET_LABELS uses, so the boot splash and
 * the flash-page picker never disagree about what to call the board. */
#if defined(DISPLAY_850C_2021)
  #define BOOT_SCREEN_TARGET_LABEL "850C (2021)"
#elif defined(DISPLAY_850C)
  #define BOOT_SCREEN_TARGET_LABEL "850C"
#else
  #define BOOT_SCREEN_TARGET_LABEL "860C"
#endif

#define COLOR_BG      lv_color_black()
#define COLOR_TILE_BG lv_color_hex(0x121722)
#define COLOR_DIVIDER lv_color_hex(0x1E2530)
#define COLOR_ACCENT  lv_color_hex(0x29D9C4)
#define COLOR_TEXT    lv_color_hex(0xF5F7FA)
#define COLOR_MUTED   lv_color_hex(0x7C8698)
/* Side power bars' empty track is the same black as the screen background
 * (and the physical bezel) - only the white fill is ever visible. */
#define COLOR_BAR_TRACK lv_color_black()

#define COLOR_BATTERY_OK   lv_color_hex(0x4CD964)
#define COLOR_BATTERY_LOW  lv_color_hex(0xFFCC00)
#define COLOR_BATTERY_CRIT lv_color_hex(0xFF3B30)
/* Blue, not the previous yellow - blue is the universally-understood
 * "headlights/high beam on" telltale color on a dashboard (yellow reads as
 * a warning instead). */
#define COLOR_LIGHTS_ON    lv_color_hex(0x3B9EFF)
#define COLOR_ERROR        lv_color_hex(0xFF3B30)
/* Temperature icon's middle tier - distinct from COLOR_BATTERY_LOW's yellow
 * (used for the icon's own "back off, min is close" tier) and COLOR_ERROR's
 * red, so all three temperature tiers read as visually distinct steps. */
#define COLOR_ORANGE       lv_color_hex(0xFF9500)
/* Mini graph's average-value cursor line - needs to read clearly against
 * both COLOR_ACCENT's teal data line/fill and COLOR_TILE_BG's dark tile, so
 * a warm yellow rather than another teal/blue shade. */
#define COLOR_GRAPH_AVG    lv_color_hex(0xFFD60A)

/* Screen is 320x480 portrait. The side power bars own the outer 3px on
 * each edge; everything else is inset by CONTENT_MARGIN so nothing
 * overlaps them. */
#define SCREEN_W        320
#define SIDE_BAR_W      3
#define CONTENT_MARGIN  12
#define CONTENT_W       (SCREEN_W - 2 * CONTENT_MARGIN)

/* Hero band: the two dividers the assist card/speed/unit cluster sits
 * between. Shared by build_main_screen() (initial layout) and
 * update_main_screen() (re-centers the cluster every tick, since the
 * assist card's visibility and the speed digit count both change its
 * total width). TOP trimmed from 42 - the status row above it (battery bar/
 * pct, error/lights icons, clock) is a full-width row that reads clearly
 * with less vertical breathing room than it had; the 2px freed up went to
 * widening the gap above the riding-mode card near the bottom of the screen
 * (see its own divider's comment). */
#define HERO_BAND_TOP    40
#define HERO_BAND_BOTTOM 168
#define HERO_BAND_MID    ((HERO_BAND_TOP + HERO_BAND_BOTTOM) / 2)
#define ASSIST_CARD_W    48
/* Static, not centered with the speed - inset from the left edge (not
 * flush against CONTENT_MARGIN, so it doesn't read as a corner badge) but
 * clear of where the speed cluster's left edge ever reaches, so it never
 * shifts or gets crowded as speed digit count changes. */
#define ASSIST_CARD_X 32
/* Gap between the speed digits and the unit label - update_main_screen()
 * needs the exact same value build_main_screen() used, to compute the
 * speed+unit cluster's total width for centering. */
#define HERO_UNIT_GAP 4

/* Both side bars scale against a fixed 500W, not either rider's own
 * configured motor power ceiling - originally the motor bar scaled against
 * ui_vars.ui16_max_motor_power (the rider's real configured watt limit),
 * but that made the bar's visual scale move every time that limit changed
 * (real-hardware bring-up 2026-08-29: raising the offroad power limit
 * config to 1200W made the same real wattage fill barely half the bar it
 * used to fill against a smaller limit). pct_clamped() already pegs at
 * 100% for anything over this, so a genuine >500W reading just holds the
 * bar full instead of being scaled down - exactly the desired behavior. */
#define HUMAN_POWER_BAR_MAX_WATTS 500
#define MOTOR_POWER_BAR_MAX_WATTS 500

/* Built once in build_main_screen(), refreshed every tick in
 * update_main_screen() - same split every theme's screens will use. */
static lv_obj_t *human_power_bar;
static lv_obj_t *motor_power_bar;
/* Peak-hold markers - children of their own bar (so hiding the bar via
 * "Disable bars"/"Disable all" hides the marker with it for free), see
 * PowerBarPeakState/power_bar_peak_tick() above. */
static lv_obj_t *human_power_peak;
static lv_obj_t *motor_power_peak;
static lv_obj_t *speed_label;
static lv_obj_t *speed_unit_label;
static lv_obj_t *battery_bar;
static lv_obj_t *battery_pct_label;
static lv_obj_t *error_icon;
static lv_obj_t *lights_icon;
static lv_obj_t *service_icon;
static lv_obj_t *clock_label;
static lv_obj_t *assist_card;
static lv_obj_t *assist_card_label;
static lv_obj_t *motor_temp_value;
static lv_obj_t *hero_temp_icon;
/* Mini-cards: 2 slots, each independently configurable (Configuration ->
 * Theme -> "Mini-Card 1"/"Mini-Card 2", see MiniCardOption below) between a
 * single-value stat tile and the two-line trip tile - both shapes are built
 * for both slots, and update_main_screen() shows/hides whichever one
 * matches that slot's current selection, so switching the config field
 * takes effect immediately without rebuilding the screen. */
static lv_obj_t *mini_card_stat_head[2];
static lv_obj_t *mini_card_stat_value[2]; /* lv_obj_get_parent() of this is the stat tile itself, for show/hide */
static lv_obj_t *mini_card_trip_head[2];
static lv_obj_t *mini_card_trip_value[2]; /* lv_obj_get_parent() of this is the trip tile itself, for show/hide */
static lv_obj_t *assist_mode_label;
static lv_obj_t *assist_mode_frame;
static lv_obj_t *odometer_value;
static lv_obj_t *human_power_value;
static lv_obj_t *motor_power_value;

/* Boot screen only. */
static lv_obj_t *boot_status_label;
/* Animated ellipsis and RX byte counter are separate labels from the status
 * text so the base text ("Connecting to motor", etc.) never shifts sideways
 * as the dots grow/shrink. */
static lv_obj_t *boot_status_dots_label;
static lv_obj_t *boot_status_rx_label;
/* Ticks (20ms each) since the boot screen was built - see
 * update_boot_screen()'s doc comment on why there's a minimum dwell time
 * even though the real motor handshake usually takes far longer than it on
 * its own. */
static uint16_t boot_screen_ticks;
/* Set once firmware_integrity_check_ok() has actually run - gates it to
 * exactly one tick, both so its ~100-200ms CRC-over-the-whole-image
 * blocking call only ever costs one frame and so its result (integrity_ok)
 * stays stable afterwards instead of re-running every 20ms. */
static bool boot_integrity_checked;
static bool boot_integrity_ok;

/* Small header-over-value stat tile; returns the value label so the caller
 * can update it later. out_header (NULL if the caller's header text never
 * changes after creation, e.g. the full graph screen's fixed "MIN"/"AVG"/
 * "MAX" tiles) receives the header label too, for callers whose header text
 * needs to track a live selection (e.g. the main screen's mini-cards, whose
 * header switches between "CADENCE"/"AVG SPEED"/etc. as the rider changes
 * Configuration -> Theme -> "Mini-Card 1"/"Mini-Card 2"). */
static lv_obj_t *make_stat_tile(lv_obj_t *parent, lv_coord_t x, lv_coord_t y, lv_coord_t w, const char *header, lv_obj_t **out_header) {
  lv_obj_t *tile = lv_obj_create(parent);
  lv_obj_remove_style_all(tile);
  lv_obj_clear_flag(tile, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_pos(tile, x, y);
  /* Height and pad_all both trimmed 2-3px from their original 58/8 to
   * tighten the row up and free vertical space lower on the screen (see
   * build_main_screen()'s bottom-of-screen odometer readout) - header/value
   * text still fits with room to spare at this size. */
  lv_obj_set_size(tile, w, 53);
  lv_obj_set_style_bg_color(tile, COLOR_TILE_BG, 0);
  lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(tile, 8, 0);
  lv_obj_set_style_pad_all(tile, 6, 0);

  lv_obj_t *head = lv_label_create(tile);
  lv_label_set_text(head, header);
  lv_obj_set_style_text_color(head, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(head, &lv_font_montserrat_14, 0);
  lv_obj_set_width(head, w - 12); /* tile width minus its 6px pad_all on both sides */
  lv_obj_set_style_text_align(head, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(head, LV_ALIGN_TOP_MID, 0, 0);

  /* Value sits directly under the header (small fixed gap) instead of
   * anchored to the tile's bottom - the tile is sized to fit both snugly,
   * not left with slack in between. */
  lv_obj_t *value = lv_label_create(tile);
  lv_label_set_text(value, "--");
  lv_obj_set_style_text_color(value, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(value, &lv_font_montserrat_20, 0);
  lv_obj_set_width(value, w - 12);
  lv_obj_set_style_text_align(value, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(value, LV_ALIGN_TOP_MID, 0, 20);

  if (out_header) *out_header = head;
  return value;
}

/* Trip A/B tile: same tile chrome as make_stat_tile() above, but with a
 * two-line value ("A <dist>\nB <dist>") and a header whose unit suffix
 * follows screenConvertMiles (like the speed readout) rather than a fixed
 * string - make_stat_tile() only returns the value label and never
 * changes its header after creation, so this is a small dedicated variant
 * rather than growing that one to cover a case none of its other callers
 * need. Value font is 14pt, not make_stat_tile()'s 20pt - two lines need
 * to fit the same 58px-tall tile a single 20pt line does elsewhere on this
 * row. `out_header` receives the header label so update_main_screen() can
 * keep its unit suffix current. */
static lv_obj_t *make_trip_tile(lv_obj_t *parent, lv_coord_t x, lv_coord_t y, lv_coord_t w, lv_obj_t **out_header) {
  lv_obj_t *tile = lv_obj_create(parent);
  lv_obj_remove_style_all(tile);
  lv_obj_clear_flag(tile, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_pos(tile, x, y);
  /* Same 58->53 / 8->6 trims as make_stat_tile() above, same reasoning. */
  lv_obj_set_size(tile, w, 53);
  lv_obj_set_style_bg_color(tile, COLOR_TILE_BG, 0);
  lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(tile, 8, 0);
  /* pad_top/pad_bottom = 4, not pad_all(6) like make_stat_tile() above -
   * montserrat_14's line_height is 16px (lv_font_montserrat_14.c), so the
   * two-line value block (2*16 - 3 line_space) plus the header's own 16px
   * comes to exactly 45px, which a uniform 6/6 pad (41px available) didn't
   * fit: at pad_all=6 the value's second line rendered 5px past the tile's
   * padded bottom edge, clipping/overlapping the tile's rounded corner - the
   * reported "artifacts". 4/4 is symmetric on purpose (an earlier 1/6 fix
   * killed the overflow but left the block sitting high in the tile,
   * un-centered - 4/4 both fits the 45px block exactly AND keeps it
   * centered, since the fit is tight either way). */
  lv_obj_set_style_pad_top(tile, 4, 0);
  lv_obj_set_style_pad_bottom(tile, 4, 0);
  lv_obj_set_style_pad_left(tile, 6, 0);
  lv_obj_set_style_pad_right(tile, 6, 0);

  lv_obj_t *head = lv_label_create(tile);
  lv_obj_set_style_text_color(head, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(head, &lv_font_montserrat_14, 0);
  lv_obj_set_width(head, w - 12);
  lv_obj_set_style_text_align(head, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(head, LV_ALIGN_TOP_MID, 0, 0);

  lv_obj_t *value = lv_label_create(tile);
  lv_label_set_text(value, "--\n--:--");
  lv_obj_set_style_text_color(value, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(value, &lv_font_montserrat_14, 0);
  lv_obj_set_width(value, w - 12);
  lv_obj_set_style_text_align(value, LV_TEXT_ALIGN_CENTER, 0);
  /* Tightened from the font's default line gap so both lines clear the
   * tile's own bottom edge under the header above them. */
  lv_obj_set_style_text_line_space(value, -3, 0);
  lv_obj_align(value, LV_ALIGN_TOP_MID, 0, 16);

  if (out_header) *out_header = head;
  return value;
}

static lv_obj_t *make_divider(lv_obj_t *parent, lv_coord_t y) {
  lv_obj_t *div = lv_obj_create(parent);
  lv_obj_remove_style_all(div);
  lv_obj_set_size(div, CONTENT_W, 1);
  lv_obj_set_pos(div, CONTENT_MARGIN, y);
  lv_obj_set_style_bg_color(div, COLOR_DIVIDER, 0);
  lv_obj_set_style_bg_opa(div, LV_OPA_COVER, 0);
  return div;
}

/* Tesla-style power/regen bar: a thin always-visible track, filled white
 * bottom-up in proportion to a 0-100% value. No numeric readout on the
 * bar itself - the stat tiles below still show the real wattage.
 * out_peak (never NULL) receives a small bright peak-hold marker, a child
 * of the bar itself - see PowerBarPeakState/power_bar_peak_tick() above. */
static lv_obj_t *make_power_bar(lv_obj_t *parent, lv_coord_t x, lv_obj_t **out_peak) {
  lv_obj_t *bar = lv_bar_create(parent);
  lv_obj_remove_style_all(bar);
  lv_obj_set_style_bg_color(bar, COLOR_BAR_TRACK, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_bg_color(bar, lv_color_white(), LV_PART_INDICATOR);
  lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, LV_PART_INDICATOR);
  lv_bar_set_range(bar, 0, 100);
  lv_bar_set_value(bar, 0, LV_ANIM_OFF); /* nothing to glide from yet at creation */
  /* update_power_bar()'s live updates use LV_ANIM_ON, which needs a nonzero
   * anim_time to actually glide (LVGL's default is 0, i.e. instant, same as
   * ANIM_OFF) - 300ms is a few real telemetry updates' worth (~100ms
   * cadence), smooth without visibly lagging behind. Was an instant
   * snap-to-value on every update until this fix - reported 2026-08-23 as
   * "choppy in sudden increments" during real-hardware bench testing (a
   * real characteristic, not a bench-only artifact - same code path drives
   * this on an actual ride, since real telemetry updates through here too). */
  lv_obj_set_style_anim_time(bar, 300, 0);
  /* Full screen height - vertical orientation is automatic (height > width). */
  lv_obj_set_size(bar, SIDE_BAR_W, 480);
  lv_obj_set_pos(bar, x, 0);

  lv_obj_t *peak = lv_obj_create(bar);
  lv_obj_remove_style_all(peak);
  lv_obj_clear_flag(peak, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_color(peak, COLOR_ACCENT, 0);
  lv_obj_set_style_bg_opa(peak, LV_OPA_COVER, 0);
  lv_obj_set_size(peak, SIDE_BAR_W, 2);
  lv_obj_set_pos(peak, 0, 480 - 2);
  *out_peak = peak;

  return bar;
}

/* Error indicator: a real vector icon (icons_osf_modern.h's icon_error, see
 * that file for provenance) instead of LVGL's built-in LV_SYMBOL_WARNING
 * glyph this used to draw - a dedicated icon design reads better at this
 * size than a generic font glyph. ALPHA_4BIT format has no color of its
 * own (see icons_osf_modern.c's own doc comment); img_recolor is what
 * actually paints it COLOR_ERROR. Hidden by default, shown by
 * update_main_screen(). */
static lv_obj_t *make_error_icon(lv_obj_t *parent, lv_coord_t x) {
  lv_obj_t *img = lv_img_create(parent);
  lv_img_set_src(img, &icon_error);
  lv_obj_set_style_img_recolor_opa(img, LV_OPA_COVER, 0);
  lv_obj_set_style_img_recolor(img, COLOR_ERROR, 0);
  lv_obj_set_pos(img, x, 11);
  lv_obj_add_flag(img, LV_OBJ_FLAG_HIDDEN);
  return img;
}

/* Headlight indicator: a real vector icon (icons_osf_modern.h's
 * icon_headlight - low-beam headlamp glyph, see that file for provenance)
 * instead of the hand-drawn primitive (a rect "bulb" + 3 lines) this used
 * to build - same img_recolor mechanism as make_error_icon() above. */
static lv_obj_t *make_headlight_icon(lv_obj_t *parent, lv_coord_t x) {
  lv_obj_t *img = lv_img_create(parent);
  lv_img_set_src(img, &icon_headlight);
  lv_obj_set_style_img_recolor_opa(img, LV_OPA_COVER, 0);
  lv_obj_set_style_img_recolor(img, COLOR_LIGHTS_ON, 0);
  lv_obj_set_pos(img, x, 11);
  lv_obj_add_flag(img, LV_OBJ_FLAG_HIDDEN);
  return img;
}

/* Service-due indicator: a real vector icon (icons_osf_modern.h's
 * icon_wrench, see that file for provenance) shown whenever either A or B
 * service (Configurations -> Bike) is enabled and its countdown distance
 * (mainscreen.c's rt_calc_odometer(), decremented once per real km ridden)
 * has reached 0 - the same condition mainscreen.c's own renderWarning()
 * checks for its one-time boot splash, just made persistent here instead
 * of only showing for a few seconds after power-on. Yellow (COLOR_BATTERY_LOW)
 * rather than COLOR_ERROR - a due service isn't a fault, just a reminder. */
static lv_obj_t *make_service_icon(lv_obj_t *parent, lv_coord_t x) {
  lv_obj_t *img = lv_img_create(parent);
  lv_img_set_src(img, &icon_wrench);
  lv_obj_set_style_img_recolor_opa(img, LV_OPA_COVER, 0);
  lv_obj_set_style_img_recolor(img, COLOR_BATTERY_LOW, 0);
  lv_obj_set_pos(img, x, 11);
  lv_obj_add_flag(img, LV_OBJ_FLAG_HIDDEN);
  return img;
}

static uint8_t pct_clamped(uint32_t value, uint32_t max) {
  if (max == 0) return 0;
  uint32_t pct = (value * 100) / max;
  return (uint8_t)(pct > 100 ? 100 : pct);
}

/* Configuration -> Theme -> "Human/Motor power bar scaling" - each option
 * order/count must match its own menu's enum options exactly (the menu's
 * stored index is used directly as that table's index). A plain multiplier
 * scales only the side power bar's fill percentage (fixed-point x10, no
 * float on this target) - never the watts number shown under it - so a
 * rider/motor with a lower real power ceiling can still visually reach the
 * top of the bar instead of it reading as permanently half-empty. "Disable
 * bars" hides just the bar (the watts number stays); "Disable all" hides
 * both. Motor's own table additionally offers 0.1x-0.9x (scaling DOWN) for
 * motors that can output well past a typical configured max - human's has
 * no equivalent since human power has no comparable "sometimes way over
 * the configured ceiling" case. */
typedef enum { PowerBarScale, PowerBarDisableBars, PowerBarDisableAll } PowerBarMode;

typedef struct {
  PowerBarMode mode;
  uint8_t scale_x10; /* only meaningful when mode == PowerBarScale */
} PowerBarOption;

static const PowerBarOption HUMAN_POWER_BAR_SCALE[] = {
  { PowerBarScale, 10 }, { PowerBarScale, 11 }, { PowerBarScale, 12 }, { PowerBarScale, 13 },
  { PowerBarScale, 14 }, { PowerBarScale, 15 }, { PowerBarScale, 16 }, { PowerBarScale, 17 },
  { PowerBarScale, 18 }, { PowerBarScale, 19 }, { PowerBarScale, 20 }, { PowerBarScale, 30 },
  { PowerBarScale, 40 }, { PowerBarScale, 50 },
  { PowerBarDisableAll, 0 }, { PowerBarDisableBars, 0 },
};
#define HUMAN_POWER_BAR_SCALE_COUNT (sizeof(HUMAN_POWER_BAR_SCALE) / sizeof(HUMAN_POWER_BAR_SCALE[0]))

static const PowerBarOption MOTOR_POWER_BAR_SCALE[] = {
  { PowerBarScale, 1 }, { PowerBarScale, 2 }, { PowerBarScale, 3 }, { PowerBarScale, 4 },
  { PowerBarScale, 5 }, { PowerBarScale, 6 }, { PowerBarScale, 7 }, { PowerBarScale, 8 }, { PowerBarScale, 9 },
  { PowerBarScale, 10 }, { PowerBarScale, 11 }, { PowerBarScale, 12 }, { PowerBarScale, 13 },
  { PowerBarScale, 14 }, { PowerBarScale, 15 }, { PowerBarScale, 16 }, { PowerBarScale, 17 },
  { PowerBarScale, 18 }, { PowerBarScale, 19 }, { PowerBarScale, 20 }, { PowerBarScale, 30 },
  { PowerBarScale, 40 }, { PowerBarScale, 50 },
  { PowerBarDisableAll, 0 }, { PowerBarDisableBars, 0 },
};
#define MOTOR_POWER_BAR_SCALE_COUNT (sizeof(MOTOR_POWER_BAR_SCALE) / sizeof(MOTOR_POWER_BAR_SCALE[0]))

/* Peak-hold marker state (one per side bar) - a small equalizer-style
 * "highest recent value" indicator that freezes at a new peak, holds
 * briefly, then falls back down toward the current value at a steady rate.
 * Plain integer percent + millisecond counters, no float. */
typedef struct {
  uint8_t peak_pct;
  int16_t hold_ms;
  uint16_t decay_accum_ms;
} PowerBarPeakState;

static PowerBarPeakState human_power_peak_state, motor_power_peak_state;

#define POWER_BAR_PEAK_HOLD_MS       500  /* freeze at a new peak this long before it starts falling */
#define POWER_BAR_PEAK_DECAY_MS_PER_PCT 25 /* ~2.5s to fall 100%->0% - a lazy "gravity" drop, not a jittery snap */

/* Advances one bar's peak-hold state by one real tick (20ms, matching every
 * other per-tick update in this file) given that bar's current fill
 * percent. Returns the peak's own percent, for the caller to position its
 * marker object. */
static uint8_t power_bar_peak_tick(PowerBarPeakState *st, uint8_t current_pct) {
  if (current_pct >= st->peak_pct) {
    st->peak_pct = current_pct;
    st->hold_ms = POWER_BAR_PEAK_HOLD_MS;
    st->decay_accum_ms = 0;
    return st->peak_pct;
  }
  if (st->hold_ms > 0) {
    st->hold_ms -= 20;
    return st->peak_pct;
  }
  st->decay_accum_ms += 20;
  while (st->decay_accum_ms >= POWER_BAR_PEAK_DECAY_MS_PER_PCT && st->peak_pct > current_pct) {
    st->decay_accum_ms -= POWER_BAR_PEAK_DECAY_MS_PER_PCT;
    st->peak_pct--;
  }
  return st->peak_pct;
}

/* Drives one side power bar end-to-end for one tick: applies the rider's
 * "power bar scaling" mode (a real multiplier, or one of the 2 disable
 * modes), sets the watts label (always the real unscaled value - only the
 * bar's fill is ever scaled), and positions that bar's peak-hold marker.
 * `watts` is the real reading; `bar_max` is what 100% fill represents. */
static void update_power_bar(lv_obj_t *bar, lv_obj_t *peak, lv_obj_t *value_label, uint32_t watts, uint32_t bar_max,
                              const PowerBarOption *options, uint8_t options_count, uint8_t scale_idx,
                              PowerBarPeakState *peak_state) {
  const PowerBarOption *opt = &options[scale_idx < options_count ? scale_idx : 0];

  if (opt->mode == PowerBarDisableAll) {
    lv_obj_add_flag(bar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(value_label, LV_OBJ_FLAG_HIDDEN);
    return;
  }
  lv_obj_clear_flag(value_label, LV_OBJ_FLAG_HIDDEN);
  lv_label_set_text_fmt(value_label, "%u W", watts);

  if (opt->mode == PowerBarDisableBars) {
    lv_obj_add_flag(bar, LV_OBJ_FLAG_HIDDEN);
    return;
  }
  lv_obj_clear_flag(bar, LV_OBJ_FLAG_HIDDEN);

  uint32_t scaled = (watts * opt->scale_x10) / 10;
  uint8_t pct = pct_clamped(scaled, bar_max);
  lv_bar_set_value(bar, pct, LV_ANIM_ON);

  uint8_t peak_pct = power_bar_peak_tick(peak_state, pct);
  lv_coord_t bar_h = 480; /* matches make_power_bar()'s own fixed height */
  lv_coord_t fill_h = ((int32_t)bar_h * peak_pct) / 100;
  lv_coord_t y = bar_h - fill_h - 2;
  if (y < 0) y = 0;
  lv_obj_set_pos(peak, 0, y);
}

/* ---- Shared chart helpers -------------------------------------------
 *
 * Used by both the main screen's mini graph (right below) and the full
 * graph screen (further down) - same "rescale to whatever's actually in
 * the chart's own buffer" and "prime it with a plausible-looking demo
 * wave" logic in both places, factored out once instead of duplicated. */

/* Rescans a chart series' own point buffer (its only backing storage - see
 * the full graph screen's header comment on why there's no separate
 * history array) for min/max/avg, and rescales the y-axis with a little
 * headroom so the line never touches the tile's top/bottom edge. Returns
 * false (leaves the chart's range alone) if there's no real data yet.
 * out_axis_min/out_axis_max (both optional, NULL if the caller only wants
 * min/max/avg of the data itself) report the padded range this actually set
 * via lv_chart_set_range() - the mini graph's average cursor line needs this
 * exact range, not the raw data min/max, to position itself at the correct
 * pixel row (see mini_graph_update()). */
static bool chart_rescale_to_data(lv_obj_t *chart, lv_chart_series_t *series, int npoints,
                                   int32_t *out_min, int32_t *out_max, int32_t *out_avg,
                                   int32_t *out_axis_min, int32_t *out_axis_max) {
  lv_coord_t *pts = lv_chart_get_y_array(chart, series);
  int32_t min = 0, max = 0, sum = 0;
  int count = 0;
  for (int i = 0; i < npoints; i++) {
    if (pts[i] == LV_CHART_POINT_NONE) continue;
    int32_t v = pts[i];
    if (count == 0 || v < min) min = v;
    if (count == 0 || v > max) max = v;
    sum += v;
    count++;
  }
  if (count == 0) return false;

  int32_t span = max - min;
  int32_t pad = span / 10;
  if (pad < 1) pad = 1;
  int32_t lower = min - pad;
  if (lower < 0) lower = 0; /* no field graphed here goes negative on real hardware - pin the axis floor instead of padding below zero */
  lv_chart_set_range(chart, LV_CHART_AXIS_PRIMARY_Y, lower, max + pad);
  lv_chart_refresh(chart);

  if (out_min) *out_min = min;
  if (out_max) *out_max = max;
  if (out_avg) *out_avg = sum / count;
  if (out_axis_min) *out_axis_min = lower;
  if (out_axis_max) *out_axis_max = max + pad;
  return true;
}

/* Sim-only "make it visibly alive for a quick look" mode - real hardware
 * never sets this (only wasm-display-sim/sim_glue.c's sim_init() does, see
 * its own comment), so it stays permanently false and free of runtime cost
 * there. A plain runtime flag rather than an #ifdef __EMSCRIPTEN__ block:
 * this file is one of the ones genuinely shared byte-for-byte between the
 * sim and real firmware builds (see this project's own established
 * "fake at the hardware boundary, not in shared domain/rendering code"
 * convention - sim_glue.c is where every other sim-only behavior already
 * lives), and a bool default-false costs nothing on real hardware, unlike
 * scattering platform conditionals through the actual screen code. Used by
 * both the mini graph and the full graph screen - see each one's own notes
 * on what it changes there. Declared here (rather than down by the full
 * graph screen, where it used to live) since the mini graph needs it too
 * and comes first in the file.
 *
 * Only controls sample cadence now (700ms vs. the real several-second
 * interval, so the graphs visibly fill within the sim's own boot warm-up
 * instead of needing real minutes of wall-clock time) - it used to also
 * trigger a fabricated wave-shaped seed fill (seed_chart_demo_wave(),
 * removed) so the graphs weren't empty at first paint, but
 * wasm-display-sim/sim_glue.c's sim_init() now runs ~90 simulated seconds
 * through this exact real tick path before the page is ever shown, which
 * - at this accelerated cadence - is enough to genuinely fill both charts
 * with real (if synthetic-telemetry-driven) samples the same way real
 * riding would, so a fake fallback wave is no longer needed. */
bool g_graph_screen_demo_mode;

extern Field graph2;
extern Field graph3;
extern Field wheelSpeedGraph; /* mainscreen.h - real speed graph field, see mini_graph_options[] below */
extern Field batteryPowerGraph; /* mainscreen.h - motor power graph field, see graph_screen_shows_motor_power() below */
extern Field humanPowerGraph; /* mainscreen.h - human power graph field, overlaid on batteryPowerGraph - see same */
extern Field tripADistanceField; /* mainscreen.h - real trip-A distance field, see the main screen's trip tile */
extern Field odoField; /* mainscreen.h - real lifetime odometer field, see the main screen's odometer readout */
extern bool mainScreenOnPress(buttons_events_t events); /* mainscreen.h - real UP/DOWN assist-level handler, see build_main_screen()/build_graph_screen() */
extern bool mainScreenIsSelectingAssistMode(void); /* mainscreen.h - true while a short PWR press (at assist level 0) has UP/DOWN cycling assist mode (Power/Torque/Cadence/eMTB/Hybrid) instead of assist level - NOT the same thing as Configuration -> "Riding mode" (street/off-road), see update_main_screen()'s assist_mode_frame highlight */

/* Forward decls - real definitions (and doc comments) live down by the
 * full graph screen, further in this file; the mini graph above needs them
 * too and comes first. */
static uint32_t field_read_uint(const Field *f);
static int32_t field_to_display_value(const Field *f, int32_t si);
static void format_number(char *buf, size_t n, int32_t v, uint8_t div_digits, bool hide_fraction, const char *units);
static const char *field_display_units(const Field *f);

/* ---- Mini-cards --------------------------------------------------------
 *
 * Configuration -> Theme -> "Mini-Card 1"/"Mini-Card 2" (configscreen.c)
 * pick, per slot, which of these live metrics the main screen's two mini-
 * cards show - option order/count here must match that menu's enum options
 * exactly (the menu's stored index is used directly as this array's
 * index). "Trip" (index 1) is special-cased (field left NULL): it needs its
 * own two-line tile with a live unit-suffixed header ("TRIP (MI)" vs
 * "TRIP (KM)"), not this table's single-value generic renderer - see
 * update_main_screen()'s mini-card block. Every other option reuses a real,
 * already-live Field from mainscreen.c through the same field_read_uint()/
 * field_to_display_value()/format_number() pipeline the mini graph and full
 * graph screen already render through - unit_override overrides that
 * field's own (often blank, meant for a different context) units string
 * with the metric's real physical unit for this standalone-tile context. */
extern Field cadenceField;        /* mainscreen.h - "rpm" units already built in */
extern Field tripAAvgSpeedField;  /* mainscreen.h - "kph" units, screenConvertMiles-aware */
extern Field batteryVoltageField; /* mainscreen.h */
extern Field batteryCurrentField; /* mainscreen.h */
extern Field motorCurrentField;   /* mainscreen.h */
extern Field motorErpsField;      /* mainscreen.h - real unit is erps (electrical rps), not rpm */

typedef struct {
  const char *header;        /* ALL-CAPS tile header, matches the existing CADENCE/TRIP style */
  const Field *field;        /* NULL only for MINI_CARD_TRIP, special-cased */
  const char *unit_override; /* NULL = use the field's own field_display_units() */
} MiniCardOption;

#define MINI_CARD_TRIP 1
static const MiniCardOption mini_card_options[] = {
  { "CADENCE", &cadenceField, NULL },
  { "TRIP", NULL, NULL },
  { "AVG SPEED", &tripAAvgSpeedField, NULL },
  { "BATT VOLTAGE", &batteryVoltageField, "V" },
  { "BATT CURRENT", &batteryCurrentField, "A" },
  { "MOTOR CURRENT", &motorCurrentField, "A" },
  { "MOTOR SPEED", &motorErpsField, "erps" },
};
#define MINI_CARD_OPTION_COUNT (sizeof(mini_card_options) / sizeof(mini_card_options[0]))

/* Out-of-range selector (e.g. a config snapshot from before an option was
 * added/removed) falls back to index 0 rather than indexing off the table's
 * end - same defensive convention as motor_error_text() (mainscreen.c). */
static uint8_t mini_card_selector(uint8_t raw) {
  return raw < MINI_CARD_OPTION_COUNT ? raw : 0;
}

/* Renders any non-Trip MiniCardOption's live value into a stat tile's value
 * label, through the same generic Field pipeline the mini graph/full graph
 * screen already use. */
static void mini_card_render_stat(lv_obj_t *head, lv_obj_t *value, uint8_t option) {
  const MiniCardOption *opt = &mini_card_options[option];
  lv_label_set_text(head, opt->header);
  const Field *f = opt->field;
  const char *units = opt->unit_override ? opt->unit_override : field_display_units(f);
  char buf[16];
  format_number(buf, sizeof(buf), field_to_display_value(f, (int32_t)field_read_uint(f)),
                f->editable.number.div_digits, f->editable.number.hide_fraction, units);
  lv_label_set_text(value, buf);
}

/* ---- Main-screen mini graph -------------------------------------------
 *
 * A small always-visible live trend, in the band that used to hold a dead
 * "GRAPH" placeholder box and then a plain "PWR for graphs" text hint
 * (see build_main_screen()'s call site below for that history) - this
 * replaces the hint with an actual glance-able graph, so a rider sees a
 * trend without ever pressing PWR.
 *
 * Source picked by Configuration -> Theme -> "Mini-Graph"
 * (ui_vars.ui8_mini_graph_field, configscreen.c) - a small dedicated table
 * below, not the legacy FieldCustomizable graph1/EEPROM_selector mechanism
 * mainscreen.c's stock main screen uses for its own equivalent graph field
 * (graph1/ui_vars.graphs_field_selectors[0], never exposed in this theme's
 * config menu). Only one real option exists today ("Speed/Avg Speed"), so
 * this always resolves to speed either way, but a real rider-visible
 * setting is what drives it rather than a fixed default no menu can change.
 *
 * Smaller than the full graph screen's own chart (MINI_GRAPH_POINTS vs.
 * GRAPH_CHART_POINTS) and no MIN/AVG/MAX row - this is a glance, not a
 * detailed readout, which still lives behind PWR. Own tiny accumulator,
 * not shared with the full graph screen's: only accumulates while the main
 * screen itself is showing (fed from update_main_screen(), same per-tick
 * pattern update_graph_screen() uses), so switching to the full graph
 * screen and back doesn't fight over one shared buffer. RAM cost either
 * way is trivial - lv_chart owns its own point array, tens of bytes for
 * MINI_GRAPH_POINTS, nothing like the old 46KB g_graphData (see the full
 * graph screen's header comment for that history). */
#define MINI_GRAPH_POINTS 40
/* mirrors GRAPH_POINT_MS's real per-point cadence, see that constant's own
 * comment for why both were dropped from 15000 (10/15-minute windows) to
 * 3000, then to 1000, on 2026-08-23 - was originally meant to match the
 * full graph screen's real-world timescale, but at 15000 a rider (or bench
 * tester) genuinely has to wait 10 real minutes to see this fill even
 * once. 1000 matches the existing "Display UI sim" page's own mini-graph
 * cadence (reported 2026-08-23: "about 1s (not 3s)"), which itself samples
 * every real GRAPH_DATA_0_INTERVAL_MS-equivalent tick via a different,
 * independent accumulator (screen.c's rt_graph_process(), not this file's
 * own point timer - see this file's "Deliberately does NOT port screen.c's
 * g_graphData..." comment further down for why the two are unrelated code
 * paths that just happen to now share the same cadence). */
#define MINI_GRAPH_POINT_MS 1000u
#define MINI_GRAPH_DEMO_POINT_MS 700u

static lv_obj_t *mini_graph_chart;
static lv_chart_series_t *mini_graph_series;
static lv_chart_cursor_t *mini_graph_avg_cursor; /* horizontal "average" reference line, see build site below */
/* Min/max/avg overlaid directly on the plot (top-left/bottom-left/top-right
 * corners) instead of LVGL's own gutter-reserved Y-axis tick labels - see
 * mini_graph_draw_part_cb()'s doc comment on why the gutter's gone, and
 * mini_graph_refresh_stat_labels() for what sets these. */
static lv_obj_t *mini_graph_min_label, *mini_graph_max_label, *mini_graph_avg_label;
static int32_t mini_graph_sample_sum;
static uint16_t mini_graph_sample_count;
/* Real timestamp (get_time_base_counter_1ms(), timer.h) the last point
 * landed at - was a "+= 20 assumed ms per tick" accumulator, which ran
 * ~4-6x slower than coded on real hardware for the same reason
 * buttons.c's TIME_1 did (see that file's header comment) - fixed
 * 2026-08-23 alongside it. */
static uint32_t mini_graph_last_point_ms;

/* Option order/count must match the "Mini-Graph" menu (configscreen.c) -
 * its stored index is used directly as this array's index. */
static const Field *mini_graph_options[] = { &wheelSpeedGraph };
#define MINI_GRAPH_OPTION_COUNT (sizeof(mini_graph_options) / sizeof(mini_graph_options[0]))

static const Field *mini_graph_source(void) {
  uint8_t idx = ui_vars.ui8_mini_graph_field < MINI_GRAPH_OPTION_COUNT ? ui_vars.ui8_mini_graph_field : 0;
  return mini_graph_options[idx]->graph.source;
}

/* Converts a value in a chart's own data units into that chart's local
 * pixel-space y (0 at the chart's top, h at its bottom - the same space
 * lv_chart_set_cursor_pos() expects, "with respect to paddings"/relative to
 * the chart's own top-left corner) and moves its average cursor line there.
 * Same value->pixel formula lv_chart.c's own draw_series_line() uses for
 * plotting a data point at a given axis range. Shared between the mini
 * graph and the full graph screen, which both now show this same dashed
 * average line. */
static void chart_position_avg_cursor(lv_obj_t *chart, lv_chart_cursor_t *cursor, int32_t series_avg,
                                       int32_t axis_min, int32_t axis_max) {
  lv_coord_t h = lv_obj_get_content_height(chart);
  int32_t span = axis_max - axis_min;
  lv_point_t pos = { .x = 0, .y = span ? (lv_coord_t)(h - ((int32_t)(series_avg - axis_min) * h) / span) : h / 2 };
  lv_chart_set_cursor_pos(chart, cursor, &pos);
}

/* Updates the 3 overlay labels that replaced this chart's old gutter-
 * reserved Y-axis ticks (min/max, muted, top-left/bottom-left) plus a new
 * gold average readout (top-right) - see mini_graph_draw_part_cb()'s doc
 * comment for why they're not real chart ticks any more. Bare numbers, no
 * units, matching the full graph screen's own MIN/AVG/MAX tiles - the
 * tile's own title label already states the metric once. */
static void mini_graph_refresh_stat_labels(int32_t min, int32_t max, int32_t avg) {
  const Field *source = mini_graph_source();
  uint8_t dd = source->editable.number.div_digits;
  bool hf = source->editable.number.hide_fraction;
  char buf[16];
  format_number(buf, sizeof(buf), min, dd, hf, "");
  lv_label_set_text(mini_graph_min_label, buf);
  format_number(buf, sizeof(buf), max, dd, hf, "");
  lv_label_set_text(mini_graph_max_label, buf);
  format_number(buf, sizeof(buf), avg, dd, hf, "");
  lv_label_set_text(mini_graph_avg_label, buf);
}

/* Called from update_main_screen() every tick while the main screen is
 * showing - same accumulate-then-post-a-point-and-rescale shape as
 * update_graph_screen(), just without the value/MIN/AVG/MAX label
 * formatting (there's no room here, and the moving line itself is the
 * "live" cue). */
static void mini_graph_update(void) {
  const Field *source = mini_graph_source();
  int32_t disp = field_to_display_value(source, (int32_t)field_read_uint(source));
  mini_graph_sample_sum += disp;
  mini_graph_sample_count++;

  uint32_t interval = g_graph_screen_demo_mode ? MINI_GRAPH_DEMO_POINT_MS : MINI_GRAPH_POINT_MS;
  if ((get_time_base_counter_1ms() - mini_graph_last_point_ms) >= interval) {
    mini_graph_last_point_ms = get_time_base_counter_1ms();
    int32_t avg = mini_graph_sample_count ? mini_graph_sample_sum / (int32_t)mini_graph_sample_count : disp;
    mini_graph_sample_sum = 0;
    mini_graph_sample_count = 0;
    lv_chart_set_next_value(mini_graph_chart, mini_graph_series, (lv_coord_t)avg);

    int32_t series_min, series_max, series_avg, axis_min, axis_max;
    if (chart_rescale_to_data(mini_graph_chart, mini_graph_series, MINI_GRAPH_POINTS, &series_min, &series_max,
                               &series_avg, &axis_min, &axis_max)) {
      chart_position_avg_cursor(mini_graph_chart, mini_graph_avg_cursor, series_avg, axis_min, axis_max);
      mini_graph_refresh_stat_labels(series_min, series_max, series_avg);
    }
  }
}

/* Turns a chart's plain line series into an area chart - shared between the
 * mini graph and the full graph screen, which both now use this same "area
 * chart, edge-to-edge, min/max/avg shown as overlays or nearby tiles
 * instead of a gutter-reserved Y-axis" motif. LVGL 8's lv_chart has no
 * built-in "fill under the line" mode (draw_series_line() in lv_chart.c
 * only ever draws the line itself) - this fires once per drawn segment (see
 * LV_CHART_DRAW_PART_LINE_AND_POINT in lv_chart.c, "non-crowded" path, the
 * one both charts' point counts always take at their pixel widths), during
 * LVGL's own DRAW_PART_BEGIN, i.e. strictly before it draws the real line on
 * top - so filling here reads as fill *under* the line, not over it.
 * There's no polygon/trapezoid primitive available in this LVGL build, so
 * the "quad under a slanted segment" is approximated with one 1px-wide
 * vertical line per pixel column between p1.x and p2.x, each dropped from
 * the interpolated segment height down to the chart's own content-area
 * bottom edge (coords.y2 minus its own pad_bottom/border - the mini graph
 * has neither so its baseline is just coords.y2, but the full graph screen's
 * chart has a real 10px pad_all, so this can't just hardcode coords.y2 the
 * way an earlier mini-graph-only version of this did) - cheap here since a
 * segment only spans a handful of pixels and this whole redraw only happens
 * once per new point, not per tick. */
static void chart_fill_area_under_line(lv_event_t *e, lv_color_t color) {
  lv_obj_draw_part_dsc_t *dsc = lv_event_get_draw_part_dsc(e);
  if (dsc->part != LV_PART_ITEMS || dsc->type != LV_CHART_DRAW_PART_LINE_AND_POINT || !dsc->p1 || !dsc->p2) return;

  lv_obj_t *chart = lv_event_get_target(e);
  lv_coord_t baseline = chart->coords.y2 - lv_obj_get_style_pad_bottom(chart, LV_PART_MAIN)
    - lv_obj_get_style_border_width(chart, LV_PART_MAIN);

  lv_draw_line_dsc_t fill_dsc;
  lv_draw_line_dsc_init(&fill_dsc);
  fill_dsc.color = color;
  fill_dsc.opa = LV_OPA_20;
  fill_dsc.width = 1;
  fill_dsc.raw_end = 1;

  lv_coord_t x1 = dsc->p1->x, x2 = dsc->p2->x;
  lv_coord_t y1 = dsc->p1->y, y2 = dsc->p2->y;
  for (lv_coord_t x = x1; x <= x2; x++) {
    lv_coord_t y = (x2 != x1) ? (lv_coord_t)(y1 + (int32_t)(y2 - y1) * (x - x1) / (x2 - x1)) : y1;
    lv_point_t top = { .x = x, .y = y };
    lv_point_t bottom = { .x = x, .y = baseline };
    lv_draw_line(dsc->draw_ctx, &fill_dsc, &top, &bottom);
  }
}

static void mini_graph_draw_part_cb(lv_event_t *e) {
  chart_fill_area_under_line(e, COLOR_ACCENT);
}

static void build_main_screen(lv_obj_t *parent) {
  /* Real mainScreen1/2/3 (mainscreen-850.c) all share one Screen.onPress -
   * mainScreenOnPress(), unmodified - which is what actually increments/
   * decrements ui_vars.ui8_assist_level on UP/DOWN. This LVGL build's
   * screenOnPress() (ugui_shim.c) only ever forwards to whatever
   * g_lvgl_screen_on_press currently points at - nothing set it for the
   * main/graph screens before this, so UP/DOWN silently did nothing
   * outside the config screen (which does register its own handler, see
   * config_screen_on_press()). Registering the real handler here restores
   * the same real assist-level-adjustment behavior the graph screen also
   * gets (see build_graph_screen()) - both match real firmware exactly. */
  g_lvgl_screen_on_press = mainScreenOnPress;

  lv_obj_set_style_bg_color(parent, COLOR_BG, 0);
  lv_obj_set_style_bg_opa(parent, LV_OPA_COVER, 0);
  lv_obj_clear_flag(parent, LV_OBJ_FLAG_SCROLLABLE);

  /* Flanking power bars: human power on the left, motor power on the
   * right - built first so they sit under everything else z-order-wise
   * (nothing else overlaps them, but this keeps intent obvious). */
  human_power_bar = make_power_bar(parent, 0, &human_power_peak);
  motor_power_bar = make_power_bar(parent, SCREEN_W - SIDE_BAR_W, &motor_power_peak);
  human_power_peak_state = (PowerBarPeakState){ 0 };
  motor_power_peak_state = (PowerBarPeakState){ 0 };

  /* Top bar: battery + clock. */
  battery_bar = lv_bar_create(parent);
  lv_obj_remove_style_all(battery_bar);
  lv_obj_set_style_bg_color(battery_bar, COLOR_DIVIDER, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(battery_bar, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(battery_bar, 3, LV_PART_MAIN);
  lv_obj_set_style_bg_color(battery_bar, COLOR_ACCENT, LV_PART_INDICATOR);
  lv_obj_set_style_bg_opa(battery_bar, LV_OPA_COVER, LV_PART_INDICATOR);
  lv_obj_set_style_radius(battery_bar, 3, LV_PART_INDICATOR);
  lv_bar_set_range(battery_bar, 0, 100);
  lv_obj_set_size(battery_bar, 64, 14);
  lv_obj_set_pos(battery_bar, CONTENT_MARGIN, 14);

  battery_pct_label = lv_label_create(parent);
  lv_obj_set_style_text_color(battery_pct_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(battery_pct_label, &lv_font_montserrat_14, 0);
  lv_obj_set_pos(battery_pct_label, 84, 12);

  /* Status icons between the battery% and the clock - plenty of clear
   * space on both sides regardless of "100%" vs "8%" or "HH:MM" width. */
  error_icon = make_error_icon(parent, 140);
  lights_icon = make_headlight_icon(parent, 160);
  service_icon = make_service_icon(parent, 180);

  clock_label = lv_label_create(parent);
  lv_obj_set_style_text_color(clock_label, COLOR_TEXT, 0); // see assist_mode_label's comment above (bottom-row labels)
  lv_obj_set_style_text_font(clock_label, &lv_font_montserrat_14, 0);
  lv_obj_align(clock_label, LV_ALIGN_TOP_RIGHT, -CONTENT_MARGIN, 12);

  make_divider(parent, HERO_BAND_TOP);

  /* Assist-level card, left of the speed - fixed teal square, just the
   * number, hidden entirely at PAS 0. Initial position here is a
   * placeholder only - update_main_screen() repositions the whole
   * card/speed/unit cluster every tick to keep it centered in the hero
   * band. Position is static (ASSIST_CARD_X) - unlike the speed cluster
   * below, this never moves as digit count changes, by design: it's a
   * fixed reference point on the dashboard, not part of that cluster. */
  assist_card = lv_obj_create(parent);
  lv_obj_remove_style_all(assist_card);
  lv_obj_clear_flag(assist_card, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_pos(assist_card, ASSIST_CARD_X, HERO_BAND_MID - ASSIST_CARD_W / 2);
  lv_obj_set_size(assist_card, ASSIST_CARD_W, ASSIST_CARD_W);
  lv_obj_set_style_radius(assist_card, 10, 0);
  lv_obj_set_style_bg_color(assist_card, COLOR_ACCENT, 0);
  lv_obj_set_style_bg_opa(assist_card, LV_OPA_COVER, 0);

  assist_card_label = lv_label_create(assist_card);
  lv_obj_set_style_text_color(assist_card_label, lv_color_black(), 0);
  lv_obj_set_style_text_font(assist_card_label, &lv_font_montserrat_32, 0);
  lv_label_set_text(assist_card_label, "0");
  lv_obj_center(assist_card_label);

  /* Hero speed readout - the dashboard's focal "quick glance" value, so it
   * gets the largest, most prominent font available. Speed+unit are
   * centered together as their own cluster in the hero band
   * (update_main_screen()) - separately from the assist card above, which
   * stays put regardless of digit count so the two never touch.
   *
   * lv_font_speed_hero (lv_font_speed_hero.c) is a custom digits-only
   * font generated from the same Montserrat-Medium.ttf every built-in
   * lv_font_montserrat_* here comes from, at 90px - LVGL's largest
   * built-in bitmap font tops out at 48px (lv_conf.h), nowhere near
   * prominent enough for this screen's focal value. Digits-only keeps the
   * flash cost of going this large down (no full Latin/symbol range).
   *
   * Speed-proportional *dynamic* scaling was tried and dropped: LVGL's
   * transform_zoom only draws when LV_COLOR_SCREEN_TRANSP is enabled (it
   * needs an alpha-capable layer buffer to render into) - confirmed by
   * testing, not assumption: with it off, the label silently stopped
   * drawing at all (LVGL logged "Couldn't create a new layer context").
   * That flag adds an alpha channel to every pixel buffer in the whole UI,
   * not just this label, which isn't worth it for one cosmetic effect on
   * this RAM-constrained target. This custom font is the "real fix"
   * option that comment used to point at - a fixed large size, no
   * transform needed - not the dynamic-scaling effect itself, which is
   * still dropped. */
  speed_label = lv_label_create(parent);
  lv_obj_set_style_text_color(speed_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(speed_label, &lv_font_speed_hero, 0);
  lv_obj_set_width(speed_label, LV_SIZE_CONTENT);
  lv_obj_set_height(speed_label, LV_SIZE_CONTENT);
  lv_obj_set_pos(speed_label, CONTENT_MARGIN, HERO_BAND_MID - 33);
  lv_label_set_text(speed_label, "0");

  /* Position tracked every tick (update_main_screen()) via lv_obj_align_to
   * against speed_label, since its width changes with digit count. */
  speed_unit_label = lv_label_create(parent);
  lv_obj_set_style_text_color(speed_unit_label, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(speed_unit_label, &lv_font_montserrat_14, 0);
  lv_label_set_text(speed_unit_label, "km/h");

  /* Motor temp readout, moved into the hero band's bottom-right corner
   * (used to be its own "MOTOR TEMP" stat tile below - that tile now shows
   * trip A/B instead, see the trip tile further down). Right-aligned as a
   * whole cluster the same way speed_unit_label hugs speed_label above -
   * both this label's own x and the icon's position are recomputed every
   * tick from the label's actual width (update_main_screen()), same
   * reasoning as speed_label/speed_x there: LV_SIZE_CONTENT means width
   * changes with digit count ("-5 C" vs "105 C"), so a one-shot position
   * can't stay right-aligned as the value changes. Plain lv_obj_set_pos +
   * explicit per-tick recompute, not lv_obj_align's stored style-align -
   * the latter did not keep this label's Y where it was set here despite
   * matching the pattern clock_label/assist_mode_label use successfully
   * elsewhere in this file; not worth chasing why when this is already
   * the established explicit-recompute alternative for anything whose
   * size changes. */
  /* Deliberately smaller than the rest of the hero band (14pt, not 20pt) -
   * this is a secondary readout tucked in the corner, not a focal value
   * like speed, and reads cluttered at the larger size next to it. */
  motor_temp_value = lv_label_create(parent);
  lv_obj_set_style_text_color(motor_temp_value, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(motor_temp_value, &lv_font_montserrat_14, 0);
  lv_label_set_text(motor_temp_value, "-- C");
  lv_obj_set_pos(motor_temp_value, CONTENT_MARGIN + CONTENT_W - lv_obj_get_width(motor_temp_value), HERO_BAND_BOTTOM - 24);

  hero_temp_icon = lv_img_create(parent);
  lv_img_set_src(hero_temp_icon, &icon_thermometer);
  lv_obj_set_style_img_recolor_opa(hero_temp_icon, LV_OPA_COVER, 0);
  lv_obj_set_style_img_recolor(hero_temp_icon, COLOR_MUTED, 0);
  /* NOT lv_img_set_zoom()'d down to match the smaller label next to it -
   * tried that (confirmed by testing, not assumption), and it silently
   * stopped rendering the icon entirely rather than drawing it smaller.
   * Same real limitation this file's speed_label comment already documents
   * for transform_zoom on this LVGL build (needs an alpha-capable layer
   * buffer, LV_COLOR_SCREEN_TRANSP, which is off) - applies here too even
   * though this is lv_img_set_zoom(), not the style-based transform.
   * Native 22x22 it stays. */
  lv_obj_align_to(hero_temp_icon, motor_temp_value, LV_ALIGN_OUT_LEFT_MID, -4, 0);

  make_divider(parent, HERO_BAND_BOTTOM);

  /* Two mini-card slots - the only two tiles left once motor/human power
   * moved to the side bars and motor temp moved into the hero above. Each
   * slot gets both possible tile shapes built at the same (x,y,w); only one
   * is ever visible at a time, picked by that slot's own Configuration ->
   * Theme selector (see the mini_card_options[] table above and this
   * function's own update_main_screen() counterpart). Building both shapes
   * up front (rather than tearing down/rebuilding on a config change) keeps
   * this in line with the rest of the theme's "static widget tree, update
   * per-tick" convention - LVGL object cost for 2 extra small tiles is
   * trivial next to the mini graph's own chart buffer. */
  lv_coord_t tile_w = (CONTENT_W - CONTENT_MARGIN) / 2;
  lv_coord_t mini_card_x[2] = { CONTENT_MARGIN, CONTENT_MARGIN + tile_w + CONTENT_MARGIN };
  for (int i = 0; i < 2; i++) {
    mini_card_stat_value[i] = make_stat_tile(parent, mini_card_x[i], 177, tile_w, "", &mini_card_stat_head[i]);
    mini_card_trip_value[i] = make_trip_tile(parent, mini_card_x[i], 177, tile_w, &mini_card_trip_head[i]);
  }

  /* Mini graph - see this section's own header comment further up for the
   * full "why" (used to be a bordered "GRAPH" placeholder box, then a
   * plain "PWR for graphs" text hint once the placeholder read as a
   * rendering bug to a user who never knew to press PWR - this replaces
   * the hint with an actual live trend, plus a small icon in the corner so
   * PWR's role stays discoverable). */
  lv_obj_t *mini_graph_tile = lv_obj_create(parent);
  lv_obj_remove_style_all(mini_graph_tile);
  lv_obj_clear_flag(mini_graph_tile, LV_OBJ_FLAG_SCROLLABLE);
  /* y and height both trimmed a few px (was 250/176) as part of tightening
   * every row's padding to free space for the bottom-of-screen odometer
   * readout further down. */
  lv_obj_set_pos(mini_graph_tile, CONTENT_MARGIN, 239);
  lv_obj_set_size(mini_graph_tile, CONTENT_W, 170); /* chart itself ends up ~137px tall below - close to real stock's own 136px-tall main-screen graph1 field */
  lv_obj_set_style_bg_color(mini_graph_tile, COLOR_TILE_BG, 0);
  lv_obj_set_style_bg_opa(mini_graph_tile, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(mini_graph_tile, 8, 0);

  const Field *mini_source = mini_graph_source();
  const char *mini_title = mini_source->editable.label;
  if (!mini_title || !mini_title[0]) mini_title = field_display_units(mini_source);
  lv_obj_t *mini_title_label = lv_label_create(mini_graph_tile);
  lv_obj_set_style_text_color(mini_title_label, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(mini_title_label, &lv_font_montserrat_14, 0);
  lv_label_set_text(mini_title_label, mini_title);
  lv_obj_set_pos(mini_title_label, 8, 5);

  /* Same discoverability role the old text-only hint served - PWR reaches
   * this same variable's full detail (title/live value/MIN-AVG-MAX) on the
   * dedicated graph screen. Tucked in the opposite corner from the title
   * so the two don't compete for attention. */
  lv_obj_t *mini_pwr_hint = lv_label_create(mini_graph_tile);
  lv_obj_set_style_text_color(mini_pwr_hint, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(mini_pwr_hint, &lv_font_montserrat_14, 0);
  lv_label_set_text(mini_pwr_hint, LV_SYMBOL_POWER);
  lv_obj_set_pos(mini_pwr_hint, CONTENT_W - 24, 5);

  /* Edge-to-edge: no reserved Y-axis gutter any more (LVGL draws its own Y
   * tick labels outside the chart's own box, to its left, hence the gutter
   * this used to need) - min/max/avg are now overlaid directly on the plot
   * (see the 3 labels created below) instead of being LVGL-drawn ticks, so
   * the freed ~30px goes to the chart itself. MINI_GRAPH_CHART_INSET is
   * just breathing room from the tile's own rounded corners/edge, not a
   * label gutter. */
#define MINI_GRAPH_CHART_INSET 2
  mini_graph_chart = lv_chart_create(mini_graph_tile);
  lv_obj_remove_style_all(mini_graph_chart);
  lv_obj_set_pos(mini_graph_chart, MINI_GRAPH_CHART_INSET, 25);
  lv_obj_set_size(mini_graph_chart, CONTENT_W - 2 * MINI_GRAPH_CHART_INSET, 137);
  lv_obj_set_style_line_width(mini_graph_chart, 2, LV_PART_ITEMS);
  lv_obj_set_style_size(mini_graph_chart, 0, LV_PART_INDICATOR); /* hide point markers, same reasoning as the full graph screen's chart */
  lv_obj_set_style_line_color(mini_graph_chart, COLOR_DIVIDER, LV_PART_MAIN);
  lv_obj_set_style_line_width(mini_graph_chart, 1, LV_PART_MAIN);
  /* lv_chart's vdiv_cnt is the TOTAL line count including both edges
   * (lv_chart.c's draw_div_lines(): p1.x = w*i/(vdiv_cnt-1) for i in
   * [0,vdiv_cnt), so i=0 lands exactly on the left edge and
   * i=vdiv_cnt-1 on the right) - it draws vdiv_cnt-1 gaps, not
   * vdiv_cnt+1. MINI_GRAPH_POINTS=40 at 4 points/min = 10 one-minute
   * gaps, so vdiv=11 (11 lines, 10 gaps) is what actually lines up with
   * real minute boundaries - vdiv=9 (the previous value here) silently
   * produced 8 gaps of 1.25 real minutes each, not 1. */
  lv_chart_set_div_line_count(mini_graph_chart, 2, 11);
  /* No real Y-axis ticks any more (see edge-to-edge comment above) - only
   * disabling the label, not the whole axis config call, since
   * lv_chart_set_axis_tick() also drives internal min/max-line bookkeeping
   * other than the label draw. */
  lv_chart_set_axis_tick(mini_graph_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 0, 2, 1, false, 0);
  lv_obj_add_event_cb(mini_graph_chart, mini_graph_draw_part_cb, LV_EVENT_DRAW_PART_BEGIN, NULL);
  lv_chart_set_type(mini_graph_chart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(mini_graph_chart, MINI_GRAPH_POINTS);
  lv_chart_set_update_mode(mini_graph_chart, LV_CHART_UPDATE_MODE_SHIFT);

  /* Min (bottom-left)/max (top-left) overlaid directly on the plot - white,
   * not muted, since muted read too low-contrast against the teal fill
   * (confirmed by testing, not assumption); avg (top-right) in the same
   * gold as the dashed cursor line below it. Children of the chart itself,
   * not the tile, so their position tracks the chart's own edge-to-edge
   * bounds automatically. */
  mini_graph_max_label = lv_label_create(mini_graph_chart);
  lv_obj_set_style_text_color(mini_graph_max_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(mini_graph_max_label, &lv_font_montserrat_14, 0);
  lv_obj_set_pos(mini_graph_max_label, 4, 2);

  mini_graph_min_label = lv_label_create(mini_graph_chart);
  lv_obj_set_style_text_color(mini_graph_min_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(mini_graph_min_label, &lv_font_montserrat_14, 0);
  lv_obj_align(mini_graph_min_label, LV_ALIGN_BOTTOM_LEFT, 4, -2);

  mini_graph_avg_label = lv_label_create(mini_graph_chart);
  lv_obj_set_style_text_color(mini_graph_avg_label, COLOR_GRAPH_AVG, 0);
  lv_obj_set_style_text_font(mini_graph_avg_label, &lv_font_montserrat_14, 0);
  lv_obj_align(mini_graph_avg_label, LV_ALIGN_TOP_RIGHT, -4, 2);

  mini_graph_series = lv_chart_add_series(mini_graph_chart, COLOR_ACCENT, LV_CHART_AXIS_PRIMARY_Y);
  lv_chart_set_all_value(mini_graph_chart, mini_graph_series, LV_CHART_POINT_NONE);
  lv_chart_set_range(mini_graph_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 1); /* placeholder until the first point lands (demo or real) and chart_rescale_to_data() rescales it */
  mini_graph_sample_sum = 0;
  mini_graph_sample_count = 0;
  /* Backdated (not "now") so the very next mini_graph_update() tick already
   * sees a full interval elapsed and posts a real first point immediately,
   * instead of leaving the chart empty and the min/max/avg labels at
   * LVGL's own default placeholder text ("Text", lv_label_create()'s stock
   * content until the first real lv_label_set_text() call - never happens
   * until a point lands, since mini_graph_refresh_stat_labels() only runs
   * from inside that same gated branch) for a full interval after every
   * boot/screen entry - reported 2026-08-23 ("the graph paint on first
   * startup so it doesn't say 'Text'"). */
  mini_graph_last_point_ms =
    get_time_base_counter_1ms() - (g_graph_screen_demo_mode ? MINI_GRAPH_DEMO_POINT_MS : MINI_GRAPH_POINT_MS);

  /* Average-value reference line - horizontal only (LV_DIR_HOR), full chart
   * width, dashed + a contrasting yellow so it reads as distinct from the
   * teal data line/fill even where they cross. Position gets set below (and
   * on every new real point, mini_graph_update()) once there's real data to
   * average - lv_chart_add_cursor() itself leaves it unset (LV_CHART_POINT_NONE,
   * undrawn) until the first lv_chart_set_cursor_pos() call. */
  mini_graph_avg_cursor = lv_chart_add_cursor(mini_graph_chart, COLOR_GRAPH_AVG, LV_DIR_HOR);
  lv_obj_set_style_line_width(mini_graph_chart, 1, LV_PART_CURSOR);
  lv_obj_set_style_line_dash_width(mini_graph_chart, 4, LV_PART_CURSOR);
  lv_obj_set_style_line_dash_gap(mini_graph_chart, 3, LV_PART_CURSOR);

  /* Divider moved up from 436 - the accumulated 2-3px trims to every row
   * above (tiles, mini graph tile) free up room here, spent on the
   * odometer readout below rather than left as slack. 2 more px than that
   * came from HERO_BAND_TOP shrinking (see its own comment) - at 416 the
   * assist_mode_frame card's top edge sat only 1px below this divider (card
   * top = assist_mode_label's y=423 + montserrat_20's line_height/2 minus
   * half the frame's own +10px pad, worked out to 418), reading as if the
   * card was touching the rule. */
  make_divider(parent, 414);

  /* Assist mode (Power/Torque/Cadence/eMTB/Hybrid - ui_vars.ui8_riding_mode,
   * a stock/vendor field name that predates this theme and is NOT the same
   * concept as Configuration -> "Riding mode", which is the separate
   * street-vs-off-road toggle (ui_vars.ui8_street_mode_enabled,
   * configscreen.c). Same spot the stock UI's STATUS_BAR macro
   * (mainscreen-850.c) uses for its own bottom-of-screen status text,
   * though stock only flashes this transiently on a button combo
   * (mainscreen.c's ui8_set_riding_mode path - also a stock name, same
   * "riding mode" == assist mode caveat applies); this theme keeps it up
   * permanently. Text/color both get overridden while walk assist is
   * active (update_main_screen()).
   *
   * assist_mode_frame is a plain border (transparent fill) sized to hug
   * the label every tick - see update_main_screen()'s own comment on why
   * that's explicit per-tick work rather than relying on LVGL's
   * LV_SIZE_CONTENT auto-sizing to just do it, same reasoning as
   * motor_temp_value's own "explicit recompute, not lv_obj_align's stored
   * style-align" note above. Created before the label so the label draws
   * on top (z-order), though the frame being fill-less makes that moot in
   * practice. */
  assist_mode_frame = lv_obj_create(parent);
  lv_obj_remove_style_all(assist_mode_frame);
  lv_obj_clear_flag(assist_mode_frame, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_bg_opa(assist_mode_frame, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_color(assist_mode_frame, COLOR_DIVIDER, 0);
  lv_obj_set_style_border_width(assist_mode_frame, 1, 0);
  lv_obj_set_style_radius(assist_mode_frame, 8, 0);

  assist_mode_label = lv_label_create(parent);
  // COLOR_TEXT (near-white), not COLOR_MUTED - this and the bottom row below are
  // glanced at mid-ride, and COLOR_MUTED's grey-on-black is real low contrast in
  // direct sun. Fixed 2026-08-28, reported as unreadable outdoors.
  lv_obj_set_style_text_color(assist_mode_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(assist_mode_label, &lv_font_montserrat_20, 0);
  lv_label_set_text(assist_mode_label, "POWER ASSIST");
  lv_obj_align(assist_mode_label, LV_ALIGN_TOP_MID, 0, 423);

  /* Bottom footer row - human power (left), lifetime odometer (center),
   * motor power (right), all sharing one line as close to the physical
   * bezel as the other edges' own CONTENT_MARGIN inset allows. Used to be
   * two separate rows (riding-mode's own line held the odometer, human/
   * motor power sat higher up in the corners) - one shared row reads
   * cleaner and leaves the riding-mode frame above with real breathing
   * room instead of overlapping this band by design. */
  human_power_value = lv_label_create(parent);
  lv_obj_set_style_text_color(human_power_value, COLOR_TEXT, 0); // see assist_mode_label's comment above
  lv_obj_set_style_text_font(human_power_value, &lv_font_montserrat_14, 0);
  lv_label_set_text(human_power_value, "-- W");
  lv_obj_align(human_power_value, LV_ALIGN_BOTTOM_LEFT, CONTENT_MARGIN, -8);

  odometer_value = lv_label_create(parent);
  lv_obj_set_style_text_color(odometer_value, COLOR_TEXT, 0); // see assist_mode_label's comment above
  lv_obj_set_style_text_font(odometer_value, &lv_font_montserrat_14, 0);
  lv_label_set_text(odometer_value, "ODO -- km");
  lv_obj_align(odometer_value, LV_ALIGN_BOTTOM_MID, 0, -8);

  motor_power_value = lv_label_create(parent);
  lv_obj_set_style_text_color(motor_power_value, COLOR_TEXT, 0); // see assist_mode_label's comment above
  lv_obj_set_style_text_font(motor_power_value, &lv_font_montserrat_14, 0);
  lv_label_set_text(motor_power_value, "-- W");
  lv_obj_align(motor_power_value, LV_ALIGN_BOTTOM_RIGHT, -CONTENT_MARGIN, -8);
}

static void update_main_screen(void) {
  /* Internal speed unit is always tenths-of-km/h; convert for display with
   * the same integer 100/161 scale mainscreen.c's own mile-conversion
   * helpers use elsewhere (e.g. onSetConfigurationWheelOdometer()). */
  uint16_t speed_x10 = screenConvertMiles
    ? (uint16_t)(((uint32_t)ui_vars.ui16_wheel_speed_x10 * 100) / 161)
    : ui_vars.ui16_wheel_speed_x10;
  lv_label_set_text_fmt(speed_label, "%u", speed_x10 / 10);
  lv_label_set_text(speed_unit_label, screenConvertMiles ? "mph" : "km/h");

  if (ui_vars.ui8_assist_level == 0) {
    lv_obj_add_flag(assist_card, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(assist_card, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text_fmt(assist_card_label, "%u", ui_vars.ui8_assist_level);
  }

  /* Center the speed DIGITS themselves on the screen - the unit label
   * hangs off their right edge (align_to below) without participating in
   * the centering math, so it doesn't pull the digits off-center to make
   * room for itself. speed_label is LV_SIZE_CONTENT-width
   * (build_main_screen()), so its rendered width changes with digit
   * count, meaning a fixed x can't keep it centered; recomputed every
   * tick instead. The assist card is deliberately NOT part of this either
   * (see build_main_screen()'s comment on ASSIST_CARD_X) - it has its own
   * static position and never moves here, so it can't ever end up
   * touching the speed digits. */
  lv_coord_t speed_w = lv_obj_get_width(speed_label);
  lv_coord_t speed_x = CONTENT_MARGIN + (CONTENT_W - speed_w) / 2;

  lv_obj_set_pos(speed_label, speed_x, HERO_BAND_MID - 33);
  lv_obj_align_to(speed_unit_label, speed_label, LV_ALIGN_OUT_RIGHT_TOP, HERO_UNIT_GAP, 6);

  /* Configuration -> Display -> "Battery field": 0=percentage (default),
   * 1=disabled (hides the bar+label entirely, leaving a gap - same
   * convention Clock field's own "disable" already uses), 2=battery
   * voltage (bar stays, since it's still a useful at-a-glance SOC
   * indicator regardless of unit - only the label switches to volts, same
   * ui_vars.ui16_battery_voltage_soc_x10/"%u.%uV" formatting the Clock
   * field's own "batt volts" option uses). */
  if (ui_vars.ui8_battery_field_enable == 1) {
    lv_obj_add_flag(battery_bar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(battery_pct_label, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_clear_flag(battery_bar, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(battery_pct_label, LV_OBJ_FLAG_HIDDEN);

    lv_bar_set_value(battery_bar, ui8_g_battery_soc, LV_ANIM_OFF);
    if (ui_vars.ui8_battery_field_enable == 2) {
      uint16_t volts_x10 = ui_vars.ui16_battery_voltage_soc_x10;
      lv_label_set_text_fmt(battery_pct_label, "%u.%uV", volts_x10 / 10, volts_x10 % 10);
    } else {
      lv_label_set_text_fmt(battery_pct_label, "%u%%", ui8_g_battery_soc);
    }

    /* Percentage-based for now, not literal "N cells remaining" - the display
     * firmware has no equivalent of the motor's BATTERY_CELLS_NUMBER (a
     * motor-only compile-time constant, src/config.h), so it has no way to
     * know pack cell count or do real per-cell voltage math. Thresholds
     * chosen to roughly track a typical 2-cells-left/1-cell-left feel. */
    lv_color_t battery_color = ui8_g_battery_soc >= 40 ? COLOR_BATTERY_OK
      : ui8_g_battery_soc >= 15 ? COLOR_BATTERY_LOW
      : COLOR_BATTERY_CRIT;
    lv_obj_set_style_bg_color(battery_bar, battery_color, LV_PART_INDICATOR);
  }

  /* "Clock field" (configscreen.c's displayMenus) previously had no effect
   * at all - clock_label always showed the real clock regardless of
   * ui_vars.ui8_time_field_enable. Now genuinely switches between the two
   * live options the menu offers (index 0=disable, 1=clock, 2=batt volts) -
   * "batt SOC %" was cut from the menu rather than wired up too, since the
   * header's own battery bar/percentage already shows that persistently,
   * right next to this label. */
  switch (ui_vars.ui8_time_field_enable) {
    case 1: {
      rtc_time_t *t = rtc_get_time();
      lv_label_set_text_fmt(clock_label, "%02u:%02u", t->ui8_hours, t->ui8_minutes);
      lv_obj_clear_flag(clock_label, LV_OBJ_FLAG_HIDDEN);
      break;
    }
    case 2: {
      uint16_t volts_x10 = ui_vars.ui16_battery_voltage_soc_x10;
      lv_label_set_text_fmt(clock_label, "%u.%uV", volts_x10 / 10, volts_x10 % 10);
      lv_obj_clear_flag(clock_label, LV_OBJ_FLAG_HIDDEN);
      break;
    }
    default:
      lv_obj_add_flag(clock_label, LV_OBJ_FLAG_HIDDEN);
      break;
  }

  if (ui_vars.ui8_error_states != 0) {
    lv_obj_clear_flag(error_icon, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(error_icon, LV_OBJ_FLAG_HIDDEN);
  }
  if (ui_vars.ui8_lights) {
    lv_obj_clear_flag(lights_icon, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(lights_icon, LV_OBJ_FLAG_HIDDEN);
  }
  if ((ui_vars.ui8_service_a_distance_enable && !rt_vars.ui16_service_a_distance)
      || (ui_vars.ui8_service_b_distance_enable && !rt_vars.ui16_service_b_distance)) {
    lv_obj_clear_flag(service_icon, LV_OBJ_FLAG_HIDDEN);
  } else {
    lv_obj_add_flag(service_icon, LV_OBJ_FLAG_HIDDEN);
  }

  /* Always Celsius, never converted by screenConvertMiles - the sensor
   * behind this field (the optional LM35, or the motor's own thermal
   * reporting) outputs Celsius directly by hardware design, so showing it
   * in the rider's chosen speed/distance unit system would be wrong, not
   * just an unwanted default. Same reasoning now applies codebase-wide -
   * see field_to_display_value()'s own doc comment further down, which
   * every other "C"-unit field (config screen thresholds, a graphable
   * motor-temp variable) already goes through. This one bypasses that
   * shared helper entirely rather than calling it (motorTempField isn't
   * wired into this LVGL build's field-walk), but must stay consistent
   * with it. */
  lv_label_set_text_fmt(motor_temp_value, "%u C", ui_vars.ui8_motor_temperature);
  /* Re-right-align every tick, same reasoning as speed_x above - digit
   * count (and now the "-" of a below-freezing reading) changes this
   * label's width, so a fixed x can't stay flush with the hero's right
   * edge. hero_temp_icon then chases the label's new position too. */
  lv_obj_set_pos(motor_temp_value, CONTENT_MARGIN + CONTENT_W - lv_obj_get_width(motor_temp_value), HERO_BAND_BOTTOM - 24);
  lv_obj_align_to(hero_temp_icon, motor_temp_value, LV_ALIGN_OUT_LEFT_MID, -4, 0);

  /* Temperature icon/value visibility are independent display preferences,
   * not gated on whether a temperature sensor is physically wired. */
  if (ui_vars.ui8_display_temp_value_enabled)
    lv_obj_clear_flag(motor_temp_value, LV_OBJ_FLAG_HIDDEN);
  else
    lv_obj_add_flag(motor_temp_value, LV_OBJ_FLAG_HIDDEN);

  if (ui_vars.ui8_display_temp_icon_enabled) {
    lv_obj_clear_flag(hero_temp_icon, LV_OBJ_FLAG_HIDDEN);

    /* Icon color: compare the live motor-reported temperature against
     * ui_vars.ui8_motor_temperature_min/max_limit_value - the same values
     * this display transmits to the motor in the CONFIGURATIONS frame, and
     * (per the real UART port) what the motor's own apply_temperature_
     * limiting() actually enforces, so despite being display-side storage
     * they're the real thresholds in practice for this build. Surfaced
     * directly as read-only "Temp. min/max limit" fields in the Temperature
     * menu (configscreen.c) rather than hidden behind icon-color math only.
     *
     * Three tiers, checked most-severe first, contiguous, no blue:
     *   grey   < min + min_warn_offset   (well clear, nothing to do)
     *   yellow [min + min_warn_offset, min)  (back off, min is close)
     *   orange [min, max)                (already at/past min, derating)
     *   red    >= max                    (at the fault limit) */
    int32_t temp_min = ui_vars.ui8_motor_temperature_min_limit_value;
    int32_t temp_max = ui_vars.ui8_motor_temperature_max_limit_value;
    int32_t temp_now = ui_vars.ui8_motor_temperature;
    lv_color_t temp_icon_color = COLOR_MUTED;
    if (temp_now >= temp_max)
      temp_icon_color = COLOR_ERROR;
    else if (temp_now >= temp_min)
      temp_icon_color = COLOR_ORANGE;
    else if (temp_now >= temp_min + ui_vars.ui8_temp_min_warn_offset)
      temp_icon_color = COLOR_BATTERY_LOW; /* yellow */
    lv_obj_set_style_img_recolor(hero_temp_icon, temp_icon_color, 0);
  } else {
    lv_obj_add_flag(hero_temp_icon, LV_OBJ_FLAG_HIDDEN);
  }

  /* Two mini-card slots (Configuration -> Theme -> "Mini-Card 1"/"2") - each
   * independently either the special two-line Trip tile or a generic
   * single-value stat tile, per mini_card_options[]/build_main_screen()'s
   * own comment on why both shapes exist at every slot regardless of which
   * is currently selected. Trip's own distance/time text is computed once
   * (not per-slot) since either or both slots could select it. */
  char trip_a_buf[16];
  format_number(trip_a_buf, sizeof(trip_a_buf),
    field_to_display_value(&tripADistanceField, (int32_t)field_read_uint(&tripADistanceField)),
    tripADistanceField.editable.number.div_digits, tripADistanceField.editable.number.hide_fraction, "");
  uint32_t trip_secs = ui_vars.ui32_trip_a_time % 86400;
  uint8_t trip_h = trip_secs / 3600;
  uint8_t trip_m = (trip_secs % 3600) / 60;
  uint8_t trip_s = trip_secs % 60;
  char trip_t_buf[16];
  if (trip_h > 0)
    snprintf(trip_t_buf, sizeof(trip_t_buf), "%u:%02u", trip_h, trip_m);
  else
    snprintf(trip_t_buf, sizeof(trip_t_buf), "%u:%02u", trip_m, trip_s);

  uint8_t mini_card_sel[2] = {
    mini_card_selector(ui_vars.ui8_mini_card_1_field),
    mini_card_selector(ui_vars.ui8_mini_card_2_field),
  };
  for (int i = 0; i < 2; i++) {
    lv_obj_t *stat_tile = lv_obj_get_parent(mini_card_stat_value[i]);
    lv_obj_t *trip_tile = lv_obj_get_parent(mini_card_trip_value[i]);
    if (mini_card_sel[i] == MINI_CARD_TRIP) {
      lv_obj_add_flag(stat_tile, LV_OBJ_FLAG_HIDDEN);
      lv_obj_clear_flag(trip_tile, LV_OBJ_FLAG_HIDDEN);
      lv_label_set_text_fmt(mini_card_trip_head[i], "TRIP (%s)", screenConvertMiles ? "MI" : "KM");
      lv_label_set_text_fmt(mini_card_trip_value[i], "%s\n%s", trip_a_buf, trip_t_buf);
    } else {
      lv_obj_clear_flag(stat_tile, LV_OBJ_FLAG_HIDDEN);
      lv_obj_add_flag(trip_tile, LV_OBJ_FLAG_HIDDEN);
      mini_card_render_stat(mini_card_stat_head[i], mini_card_stat_value[i], mini_card_sel[i]);
    }
  }

  /* Side power bars: both scale against a fixed 500W (see
   * HUMAN_POWER_BAR_MAX_WATTS/MOTOR_POWER_BAR_MAX_WATTS's own comment above
   * for why the motor bar isn't scaled against the rider's own configured
   * watt limit). Watts aren't a unit screenConvertMiles touches (only
   * distance/speed/weight/temperature are), so no conversion needed even in
   * imperial mode. */
  update_power_bar(human_power_bar, human_power_peak, human_power_value, rt_vars.ui16_pedal_power_filtered,
                    HUMAN_POWER_BAR_MAX_WATTS, HUMAN_POWER_BAR_SCALE, HUMAN_POWER_BAR_SCALE_COUNT,
                    ui_vars.ui8_human_power_bar_scale, &human_power_peak_state);
  update_power_bar(motor_power_bar, motor_power_peak, motor_power_value, rt_vars.ui16_battery_power_filtered,
                    MOTOR_POWER_BAR_MAX_WATTS, MOTOR_POWER_BAR_SCALE, MOTOR_POWER_BAR_SCALE_COUNT,
                    ui_vars.ui8_motor_power_bar_scale, &motor_power_peak_state);

  /* Walk assist overrides the normal assist-mode text while genuinely
   * active - both flags mirror the exact gating mainscreen.c's own
   * screen_clock() uses for its transient "WALK" setWarning() (see its
   * comment there): ui8_walk_assist is the rider's own DOWN_LONG_CLICK
   * input latch (anyscreen_onpress()/walk_assist_state()), ui8_walk_assist_state
   * is the motor's own confirmed state (state.c). Red, not the usual muted
   * color, so it reads as a distinct, attention-grabbing mode. */
  if (ui_vars.ui8_walk_assist && ui8_walk_assist_state) {
    lv_obj_set_style_bg_opa(assist_mode_frame, LV_OPA_TRANSP, 0);
    lv_obj_set_style_text_color(assist_mode_label, COLOR_ERROR, 0);
    lv_label_set_text(assist_mode_label, "WALK ASSIST");
  } else {
    /* Filled teal, same "you're changing this" treatment assist_card
     * already uses - PWR at assist level 0 puts UP/DOWN in assist-mode-
     * select instead of assist-level-select (mainScreenIsSelectingAssistMode(),
     * mainscreen.c's ui8_set_riding_mode - a stock/vendor name, not the
     * Configuration -> "Riding mode" street/off-road toggle), which was
     * otherwise silent/indistinguishable from ordinary riding until a
     * UP/DOWN press visibly changed the text - this makes the "you're now
     * cycling modes, not levels" state itself visible before the first
     * press. */
    if (mainScreenIsSelectingAssistMode()) {
      lv_obj_set_style_bg_color(assist_mode_frame, COLOR_ACCENT, 0);
      lv_obj_set_style_bg_opa(assist_mode_frame, LV_OPA_COVER, 0);
      lv_obj_set_style_text_color(assist_mode_label, lv_color_black(), 0);
    } else {
      lv_obj_set_style_bg_opa(assist_mode_frame, LV_OPA_TRANSP, 0);
      lv_obj_set_style_text_color(assist_mode_label, COLOR_TEXT, 0); // see this label's creation-time comment
    }
    /* Same assist-mode strings/mapping as mainscreen.c's own transient
     * display (screen_clock()'s "display riding mode" block - stock's own
     * comment there also uses "riding mode" for this, its established
     * internal name for ui_vars.ui8_riding_mode) - 1-5, no 0. */
    switch (ui_vars.ui8_riding_mode) {
      case 1: lv_label_set_text(assist_mode_label, "POWER ASSIST"); break;
      case 2: lv_label_set_text(assist_mode_label, "TORQUE ASSIST"); break;
      case 3: lv_label_set_text(assist_mode_label, "CADENCE ASSIST"); break;
      case 4: lv_label_set_text(assist_mode_label, "eMTB ASSIST"); break;
      case 5: lv_label_set_text(assist_mode_label, "HYBRID ASSIST"); break;
      default: break;
    }
  }
  /* Frame resized/recentered every tick to hug whatever text just landed
   * above ("WALK ASSIST" is wider than "POWER ASSIST", etc.) - see its
   * build_main_screen() comment on why this is explicit, not automatic. */
  lv_obj_set_size(assist_mode_frame, lv_obj_get_width(assist_mode_label) + 28, lv_obj_get_height(assist_mode_label) + 10);
  lv_obj_align_to(assist_mode_frame, assist_mode_label, LV_ALIGN_CENTER, 0, 0);

  /* Lifetime odometer - same real Field-based unit-conversion path the
   * trip A/B tile above uses (odoField is the same FIELD_READONLY_UINT
   * shape as tripADistanceField/tripBDistanceField, just backed by
   * ui_vars.ui32_odometer_x10 instead). */
  char odo_buf[16];
  format_number(odo_buf, sizeof(odo_buf),
    field_to_display_value(&odoField, (int32_t)field_read_uint(&odoField)),
    odoField.editable.number.div_digits, odoField.editable.number.hide_fraction,
    field_display_units(&odoField));
  lv_label_set_text_fmt(odometer_value, "ODO %s", odo_buf);

  mini_graph_update();
}


/* ---- Config screen -----------------------------------------------------
 *
 * A generic renderer over configscreen.c's own real Field/Screen data
 * (screen.h) - NOT a hand-built list of settings. configscreen.c still
 * declares the entire real config tree (every menu, every field's label/
 * min/max/enum choices/EEPROM target pointer) exactly as it always did;
 * only the old µGUI renderer that used to walk that data (screen.c) is
 * gone from this build. This file's job is to walk the same data and
 * render/navigate it in LVGL instead - so every real setting shows up
 * here automatically, with no per-field code to write or keep in sync.
 *
 * Per dashboard_theme.h's own doc comment on build_config_screen: this is
 * the canonical config screen for every theme, not just this one - it's
 * deliberately not restyled per theme (the field tree alone is
 * substantial; duplicating this renderer per theme would cost real flash
 * for no rider-visible benefit beyond the main screen, which is where a
 * theme's look is actually supposed to differ).
 *
 * Real button semantics, reused from screen.h's own SCREENCLICK_* mapping
 * for this board (M_CLICK = start/stop editing a value, ONOFF_CLICK =
 * back out one level or exit entirely at the root) - up/down move the
 * selection cursor, or adjust the selected value's magnitude while
 * editing. Long-press combos (assist-level shortcuts etc.) aren't
 * meaningful here and are simply swallowed along with everything else -
 * see config_screen_on_press()'s own comment on why it must never let an
 * event fall through to appwide_onpress() while this screen is showing.
 *
 * Scope cut, deliberate: only the field variants configscreen.c's real
 * tree actually uses (FieldScrollable, FieldEditable, FieldEnd - verified
 * by grepping configscreen.c itself, not assumed) are handled;
 * FieldGraph/FieldCustom/FieldCustomizable/FieldDrawText* exist in
 * screen.h's variant enum for mainscreen.c's own use, never appear in the
 * config tree, and are silently skipped by field_is_supported() below if
 * that ever changes.
 */

#define CONFIG_MAX_DEPTH  8
#define CONFIG_TITLE_Y    14
#define CONFIG_LIST_Y     46

typedef struct {
  const Field *entries; /* NULL-terminated (FieldEnd) array of Field - the level's own row list. */
  const char *label;    /* This level's title, from the FieldScrollable that led here. */
  int selected;          /* Cursor index among this level's *supported* fields (field_is_supported()). */
} config_nav_level_t;

static config_nav_level_t g_config_stack[CONFIG_MAX_DEPTH];
static int g_config_depth;

static bool g_config_editing;
/* The value being edited, in DISPLAY units (miles/F/lb when imperial is
 * active, matching screenConvertMiles - see field_to_display_value()) -
 * not raw SI. Mirrors screen.c's own real curEditableValueConverted:
 * "we only convert to displayed units once, when the user starts editing,
 * so that when the user increments/decrements they see the value change
 * by the expected amount" - converted back to SI only on commit. For
 * EditEnum fields this is just the option index (no unit conversion
 * applies to a string choice). */
static int32_t g_config_edit_value;

static lv_obj_t *g_config_title_label;
static lv_obj_t *g_config_list;

static bool field_is_supported(const Field *f) {
  return f->variant == FieldScrollable || f->variant == FieldEditable;
}

static int count_supported_fields(const Field *entries) {
  int n = 0;
  for (const Field *f = entries; f->variant != FieldEnd; f++) {
    if (field_is_supported(f)) n++;
  }
  return n;
}

static const Field *nth_supported_field(const Field *entries, int idx) {
  int n = 0;
  for (const Field *f = entries; f->variant != FieldEnd; f++) {
    if (field_is_supported(f)) {
      if (n == idx) return f;
      n++;
    }
  }
  return NULL;
}

static int count_enum_options(const Field *f) {
  int n = 0;
  for (const char **opt = f->editable.editEnum.options; *opt; opt++) n++;
  return n;
}

/* Reads a FieldEditable's raw target value, in SI units, sized per
 * .editable.size - EXCEPT for EditEnum, which always reads a plain
 * uint8_t regardless of .editable.size. That's not a simplification, it's
 * a real cross-platform bug workaround: FIELD_EDITABLE_ENUM (screen.h)
 * sets .size = sizeof(EditableType), and EditableType's compiled size is
 * NOT portable - confirmed by directly compiling the same enum with both
 * toolchains this project uses: 1 byte on the real ARM firmware target
 * (ARM EABI packs small enums by default, no -fshort-enums needed) but 4
 * bytes under the WASM sim's Emscripten/clang (plain C enum-as-int
 * default). Every real EditEnum target in this codebase (ui_vars.ui8_*)
 * is actually a uint8_t, so trusting the ARM-only sizeof() value here
 * would silently read/write 3 bytes past a real uint8_t field's own
 * struct member on the sim build - reading as constant 1 byte instead
 * matches the real intended target type on both platforms. */
static uint32_t field_read_uint(const Field *f) {
  if (f->editable.typ == EditEnum) return *(const uint8_t *)f->editable.target;
  if (f->editable.number.is_signed) {
    /* Sign-extend so a stored int8_t -10 reads back as -10 (as int32_t) rather
     * than as 246. field_write_uint() needs no matching case - its low-byte/
     * low-word truncation of the two's-complement value already round-trips. */
    switch (f->editable.size) {
      case 1: return (uint32_t)(int32_t)*(const int8_t *)f->editable.target;
      case 2: return (uint32_t)(int32_t)*(const int16_t *)f->editable.target;
      case 4: return (uint32_t)*(const int32_t *)f->editable.target;
      default: return 0;
    }
  }
  switch (f->editable.size) {
    case 1: return *(const uint8_t *)f->editable.target;
    case 2: return *(const uint16_t *)f->editable.target;
    case 4: return *(const uint32_t *)f->editable.target;
    default: return 0;
  }
}

static void field_write_uint(const Field *f, uint32_t v) {
  if (f->editable.typ == EditEnum) {
    *(uint8_t *)f->editable.target = (uint8_t)v;
    return;
  }
  switch (f->editable.size) {
    case 1: *(uint8_t *)f->editable.target = (uint8_t)v; break;
    case 2: *(uint16_t *)f->editable.target = (uint16_t)v; break;
    case 4: *(uint32_t *)f->editable.target = v; break;
    default: break;
  }
}

/* SI -> display-unit conversion for a numeric field, keyed off its real
 * .units string (screen.c's own getUnits()/getEditableNumber() match the
 * same strings - "kph"/"km", "C", "kg" - the only ones this codebase's
 * config tree actually uses, confirmed by grep). Reuses the same
 * screenConvertMiles-driven approach the main screen's speed readout
 * already uses (this session's own precedent, not screen.c's dead
 * convertUnits() stub - see update_main_screen() for why that function
 * can't be trusted: it's a deliberate no-op in ugui_shim.c, since screen.c
 * itself isn't part of this LVGL build). Round-trip correct by
 * construction - field_from_display_value() below is this function's
 * exact algebraic inverse.
 *
 * Deliberately does NOT convert "C" to Fahrenheit, unlike screen.c's own
 * motorTempField (gated on screenConvertFarenheit there, not
 * screenConvertMiles - see update_main_screen()'s own note on that
 * distinction). Every real "C"-unit field in this codebase (motor temp,
 * throttle/temperature limit thresholds) reads a hardware sensor (the
 * optional LM35, or the motor's own thermal reporting) that outputs
 * Celsius directly - showing it in the rider's chosen speed/distance unit
 * system would be actively wrong, not just an unwanted default, so "C"
 * stays "C" regardless of screenConvertMiles. */
static int32_t field_to_display_value(const Field *f, int32_t si) {
  if (!screenConvertMiles) return si;
  const char *u = f->editable.number.units;
  if (!u) return si;
  if (strcasecmp(u, "kph") == 0 || strcasecmp(u, "km") == 0) return (si * 100) / 161;
  if (strcmp(u, "kg") == 0) return (si * 220) / 100;
  /* Wh/km -> Wh/mi: an inverse-distance rate, so this goes the OPPOSITE
   * direction from the kph/km case above (a mile is longer than a km, so it
   * costs more Wh) - same 1.609 factor (161/100) screen.c's own real
   * screenConvertWhPerMiles conversion uses, just multiplying instead of
   * dividing. */
  if (strcmp(u, "Wh/km") == 0) return (si * 161) / 100;
  return si;
}

static int32_t field_from_display_value(const Field *f, int32_t disp) {
  if (!screenConvertMiles) return disp;
  const char *u = f->editable.number.units;
  if (!u) return disp;
  if (strcasecmp(u, "kph") == 0 || strcasecmp(u, "km") == 0) return (disp * 161) / 100;
  if (strcmp(u, "kg") == 0) return (disp * 100) / 220;
  if (strcmp(u, "Wh/km") == 0) return (disp * 100) / 161;
  return disp;
}

static const char *field_display_units(const Field *f) {
  const char *u = f->editable.number.units;
  if (!u) return "";
  if (screenConvertMiles) {
    if (strcasecmp(u, "kph") == 0) return "mph";
    if (strcasecmp(u, "km") == 0) return "mi";
    if (strcmp(u, "kg") == 0) return "lb";
    if (strcmp(u, "Wh/km") == 0) return "Wh/mi";
  }
  return u;
}

/* Fixed-point formatter (no float on this target) - div_digits/
 * hide_fraction match screen.h's own Field.editable.number doc comment:
 * "how many digits to divide by for fractions ... if set, don't ever show
 * the fractional part". */
static void format_number(char *buf, size_t n, int32_t v, uint8_t div_digits, bool hide_fraction, const char *units) {
  bool neg = v < 0;
  uint32_t av = neg ? (uint32_t)(-v) : (uint32_t)v;
  uint32_t scale = 1;
  for (int i = 0; i < div_digits; i++) scale *= 10;
  uint32_t whole = av / scale;
  const char *sep = (units && units[0]) ? " " : ""; /* skip the separator entirely for "" (callers that already show units elsewhere, e.g. refresh_graph_stats()'s MIN/AVG/MAX tiles) rather than leaving a trailing space */
  if (div_digits == 0 || hide_fraction) {
    snprintf(buf, n, "%s%lu%s%s", neg ? "-" : "", (unsigned long)whole, sep, units);
  } else {
    uint32_t frac = av % scale;
    char fracbuf[8];
    snprintf(fracbuf, sizeof(fracbuf), "%0*lu", (int)div_digits, (unsigned long)frac);
    snprintf(buf, n, "%s%lu.%s%s%s", neg ? "-" : "", (unsigned long)whole, fracbuf, sep, units);
  }
}

/* ---- Graph screen --------------------------------------------------------
 *
 * dashboard_theme_tick() maps mainscreen-850.c's real mainScreen2/mainScreen3
 * (reached the normal way - short-pressing PWR cycles screens[], unmodified
 * domain logic) onto this one LVGL screen, distinguished by
 * g_graph_screen_slot (see dashboard_theme.h's doc comment on it). Each slot
 * is backed by its own real, independently EEPROM-persisted graph2/graph3
 * FieldCustomizable (mainscreen-850.c) - real functionality, not new state.
 *
 * Deliberately does NOT port screen.c's g_graphData[VARS_SIZE][3] (46,260
 * bytes, permanently allocated for all 15 variables x all 3 timescales
 * regardless of what's shown - upstream's own comment already flags this as
 * wasteful, see UNIVERSAL_FIRMWARE_PLAN.md's Phase 0.1/Phase 5 notes) or call
 * screen.c's rt_graph_process() (which keeps writing into that array every
 * 100ms once activeGraphs is set, whether this screen is even showing or
 * not - unhooked from wasm-display-sim/sim_glue.c's advance_tick() for
 * exactly this reason). Instead: lv_chart owns the only history buffer that
 * exists (GRAPH_CHART_POINTS lv_coord_t's, via lv_chart_set_point_count() -
 * tens of bytes, not 46KB), fed directly by lv_chart_set_next_value() from a
 * tiny running accumulator (g_graph_sample_sum/_count - reset every time a
 * point lands) that only ever tracks the ONE variable currently on screen.
 * Switching variables or leaving the screen drops whatever history existed
 * for the previous selection - an accepted simplification (real values start
 * refilling immediately), not a bug.
 *
 * Known, deliberate scope boundary for this pass: there is no in-screen
 * control to change which of the 14 graphable variables is showing (real
 * screen.c had this behind SCREENCLICK_START_CUSTOMIZING, entirely inside
 * the input-handling layer this rewrite replaces) or to change the 15-
 * minute window to 1h/4h (screen.c's other two timescales) - both are real,
 * addressable follow-ups, not forgotten; today's slot/variable is whatever
 * EEPROM already has persisted (configscreen.c's real defaults). */
#define GRAPH_CHART_POINTS 60
/* Originally 15000 (60 points * 15s = 15-minute rolling window, matching
 * screen.c's shortest real timescale) - dropped to 3000 on 2026-08-23
 * (60 points * 3s = 3-minute window) after real-hardware bench testing
 * (motor-handshake.ts's emulator) showed a 15-minute-to-fill graph reads as
 * broken - "Text" placeholder labels and no visible line for many real
 * minutes on first visit, easily mistaken for a hang rather than a slow,
 * working accumulator. Dropped again to 1000 same day to match the
 * existing "Display UI sim" page's own mini-graph cadence (60 points * 1s
 * = 1-minute window). Same tradeoff as the mini graph's own
 * MINI_GRAPH_POINT_MS just above. */
#define GRAPH_POINT_MS     1000u
#define GRAPH_DEMO_POINT_MS 700u /* see g_graph_screen_demo_mode, declared up by the mini graph section */

static lv_obj_t *g_graph_title_label;
static lv_obj_t *g_graph_value_label;
static lv_obj_t *g_graph_chart;
static lv_chart_series_t *g_graph_series;
static lv_chart_cursor_t *g_graph_avg_cursor; /* same dashed gold "average" line as the mini graph, see chart_position_avg_cursor() */
static lv_obj_t *g_graph_min_value;
static lv_obj_t *g_graph_avg_value;
static lv_obj_t *g_graph_max_value;
/* Same min/max/avg overlay-on-the-plot treatment as the mini graph (white/
 * white/gold, top-left/bottom-left/top-right) - carries that same motif
 * over here too, on top of the MIN/AVG/MAX tiles below which already show
 * the same 3 numbers as plain text. */
static lv_obj_t *g_graph_min_label, *g_graph_max_label, *g_graph_avg_label;
static const Field *g_graph_var; /* the FieldGraph choice currently on screen */
static int32_t g_graph_sample_sum;
static uint16_t g_graph_sample_count;

/* Per-slot history so re-entering this screen (PWR-cycling back to it, or
 * switching slots and back) shows the real recent trend immediately instead
 * of an empty chart that takes another GRAPH_CHART_POINTS*GRAPH_POINT_MS to
 * refill - real-hardware bring-up 2026-08-29: a rider switching screens
 * mid-ride kept finding this blank. This is genuinely cheap (2 slots x 60
 * lv_coord_t = well under 256 bytes total), unlike the old upstream
 * g_graphData[VARS_SIZE][3] this file's header comment already explains
 * avoiding (46KB, permanently allocated for all 14 variables) - the RAM
 * argument that justified dropping that array doesn't apply to keeping just
 * the 2 currently-configured slots' own tiny history around. Reset whenever
 * the slot's configured variable changes (old history is meaningless for a
 * different quantity), same as switching slots already resets on-screen
 * state today. */
static lv_coord_t g_graph_history[2][GRAPH_CHART_POINTS];
static uint8_t g_graph_history_count[2];
static const Field *g_graph_history_source[2];
/* Real timestamp (get_time_base_counter_1ms(), timer.h), same fix/reasoning
 * as mini_graph_last_point_ms just above. */
static uint32_t g_graph_last_point_ms;

/* Human-power overlay, Motor Power slot only (real-hardware bring-up
 * 2026-08-29: rider wants to see how much the motor was actually assisting
 * vs. own effort, not just the motor's own number in isolation). A second
 * lv_chart series on the same axis/scale as the primary one, driven by its
 * own tiny accumulator/history exactly mirroring the primary series' own -
 * see build_graph_screen()/update_graph_screen() for where this turns on.
 * Deliberately NOT wired into MIN/AVG/MAX (those stay scoped to whichever
 * variable is actually configured for this slot, i.e. motor power) or its
 * own persisted color/legend beyond the line itself - a second full stats
 * row would need a real layout redesign of the 3-tile strip below, out of
 * scope for what was actually asked (see just how much it was assisting
 * and when it wasn't - the overlaid line shape already answers that). */
static lv_chart_series_t *g_graph_series_human;
static int32_t g_graph_sample_sum_human;
static uint16_t g_graph_sample_count_human;
static lv_coord_t g_graph_history_human[2][GRAPH_CHART_POINTS];
static uint8_t g_graph_history_human_count[2];

static bool graph_screen_shows_motor_power(void) {
  return g_graph_var == &batteryPowerGraph;
}

/* Area-fill only now - this chart has no Y-axis tick labels any more (see
 * build_graph_screen()'s "edge-to-edge" comment on why: the MIN/AVG/MAX
 * tiles below it already show that same information, so a gutter reserved
 * just for redundant axis numbers wasn't worth the plot-area cost).
 *
 * One callback for the whole chart, so the human-power overlay's own area
 * (when present) fills in this same accent teal rather than its own orange
 * - chart_fill_area_under_line() doesn't discriminate by series. Left as
 * one shared wash rather than teasing series identity out of the draw-part
 * event: both are translucent (LV_OPA_20) and the line colors themselves
 * already distinguish the two series clearly. */
static void graph_draw_part_cb(lv_event_t *e) {
  chart_fill_area_under_line(e, COLOR_ACCENT);
}

/* Formats min/max/avg (computed by the shared chart_rescale_to_data(),
 * which also handles the y-axis rescale) through the same div_digits path
 * every other numeric field on this theme uses. No-op if there's no real
 * data yet. Units deliberately omitted here - the title label above
 * already states them once, and repeating them on all three tiles was
 * exactly what was pushing longer strings (e.g. "12.3 Wh/km") past the
 * ~85px-wide tile, forcing an ellipsis truncation that hid real digits -
 * a genuine correctness problem on a bike computer, not just cosmetics. */
static void refresh_graph_stats(const Field *source) {
  int32_t min, max, avg, axis_min, axis_max;
  if (!chart_rescale_to_data(g_graph_chart, g_graph_series, GRAPH_CHART_POINTS, &min, &max, &avg, &axis_min, &axis_max))
    return;

  char buf[24];
  uint8_t dd = source->editable.number.div_digits;
  bool hf = source->editable.number.hide_fraction;
  format_number(buf, sizeof(buf), min, dd, hf, "");
  lv_label_set_text(g_graph_min_value, buf);
  lv_label_set_text(g_graph_min_label, buf);
  format_number(buf, sizeof(buf), avg, dd, hf, "");
  lv_label_set_text(g_graph_avg_value, buf);
  lv_label_set_text(g_graph_avg_label, buf);
  format_number(buf, sizeof(buf), max, dd, hf, "");
  lv_label_set_text(g_graph_max_value, buf);
  lv_label_set_text(g_graph_max_label, buf);

  chart_position_avg_cursor(g_graph_chart, g_graph_avg_cursor, avg, axis_min, axis_max);
}

/* Shift-left-append `value` into a GRAPH_CHART_POINTS history buffer -
 * shared helper for the primary series and the human-power overlay, both
 * of which need the exact same bookkeeping (see g_graph_history's own
 * comment for why this exists at all). */
static void graph_history_push(lv_coord_t *hist, uint8_t *count, lv_coord_t value) {
  if (*count < GRAPH_CHART_POINTS) {
    hist[(*count)++] = value;
  } else {
    memmove(hist, hist + 1, (GRAPH_CHART_POINTS - 1) * sizeof(lv_coord_t));
    hist[GRAPH_CHART_POINTS - 1] = value;
  }
}

static void update_graph_screen(void) {
  if (!g_graph_var) return;
  const Field *source = g_graph_var->graph.source;
  bool human_overlay = graph_screen_shows_motor_power();
  const Field *human_source = humanPowerGraph.graph.source;

  int32_t disp = field_to_display_value(source, (int32_t)field_read_uint(source));
  g_graph_sample_sum += disp;
  g_graph_sample_count++;

  int32_t disp_human = 0;
  if (human_overlay) {
    disp_human = field_to_display_value(human_source, (int32_t)field_read_uint(human_source));
    g_graph_sample_sum_human += disp_human;
    g_graph_sample_count_human++;
  }

  char buf[24];
  format_number(buf, sizeof(buf), disp, source->editable.number.div_digits,
                source->editable.number.hide_fraction, field_display_units(source));
  lv_label_set_text(g_graph_value_label, buf);

  if ((get_time_base_counter_1ms() - g_graph_last_point_ms) >= (g_graph_screen_demo_mode ? GRAPH_DEMO_POINT_MS : GRAPH_POINT_MS)) {
    g_graph_last_point_ms = get_time_base_counter_1ms();
    int32_t avg = g_graph_sample_count ? g_graph_sample_sum / (int32_t)g_graph_sample_count : disp;
    g_graph_sample_sum = 0;
    g_graph_sample_count = 0;
    lv_chart_set_next_value(g_graph_chart, g_graph_series, (lv_coord_t)avg);
    refresh_graph_stats(source);
    graph_history_push(g_graph_history[g_graph_screen_slot], &g_graph_history_count[g_graph_screen_slot], (lv_coord_t)avg);

    if (human_overlay && g_graph_series_human) {
      int32_t avg_human = g_graph_sample_count_human
          ? g_graph_sample_sum_human / (int32_t)g_graph_sample_count_human : disp_human;
      g_graph_sample_sum_human = 0;
      g_graph_sample_count_human = 0;
      lv_chart_set_next_value(g_graph_chart, g_graph_series_human, (lv_coord_t)avg_human);
      graph_history_push(g_graph_history_human[g_graph_screen_slot], &g_graph_history_human_count[g_graph_screen_slot], (lv_coord_t)avg_human);
    }
  }
}

static void build_graph_screen(lv_obj_t *parent) {
  /* Real mainScreen2/mainScreen3 share the exact same Screen.onPress as
   * mainScreen1 - mainScreenOnPress() - so UP/DOWN still adjusts
   * ui_vars.ui8_assist_level from the graph screen too, not just the main
   * one. See build_main_screen()'s own comment on why this registration
   * is needed at all under this LVGL build's screenOnPress() bridge. */
  g_lvgl_screen_on_press = mainScreenOnPress;

  lv_obj_set_style_bg_color(parent, COLOR_BG, 0);
  lv_obj_set_style_bg_opa(parent, LV_OPA_COVER, 0);
  lv_obj_clear_flag(parent, LV_OBJ_FLAG_SCROLLABLE);

  const Field *slot_field = g_graph_screen_slot == 0 ? &graph2 : &graph3;
  uint8_t idx = *slot_field->customizable.selector;
  const Field *choice = slot_field->customizable.choices[idx];
  const Field *source = choice->graph.source;

  g_graph_var = choice;
  g_graph_sample_sum = 0;
  g_graph_sample_count = 0;
  g_graph_sample_sum_human = 0;
  g_graph_sample_count_human = 0;
  /* Backdated - same reasoning/fix as mini_graph_last_point_ms above, so
   * this screen's MIN/AVG/MAX tiles and overlay labels show a real number
   * instead of "Text" on the very first frame after switching here. */
  g_graph_last_point_ms =
    get_time_base_counter_1ms() - (g_graph_screen_demo_mode ? GRAPH_DEMO_POINT_MS : GRAPH_POINT_MS);

  /* A couple of the 14 graphable fields (batteryPowerUsageFieldGraph is the
   * one this build actually reaches) use a mutable char[] label instead of a
   * plain string literal, meant to be filled with "Wh/km"/"Wh/mi" by
   * screen.c's real renderer depending on the active unit system - that
   * renderer isn't part of this LVGL build, so the buffer is still all-
   * zeros (an empty string) here. Falling back to the field's own units
   * string covers this correctly (it's what the label would have said
   * anyway) without needing to special-case that one field by name. */
  const char *title = source->editable.label;
  if (!title || !title[0]) title = field_display_units(source);
  g_graph_title_label = lv_label_create(parent);
  lv_obj_set_style_text_color(g_graph_title_label, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(g_graph_title_label, &lv_font_montserrat_14, 0);
  if (graph_screen_shows_motor_power()) {
    /* Names the overlay's own color inline rather than a separate legend
     * widget - cheap and this title is otherwise idle space. 0xFF9500 must
     * match COLOR_ORANGE, used for g_graph_series_human's own line below -
     * LVGL's recolor markup takes a literal hex, not a macro reference. */
    lv_label_set_text_fmt(g_graph_title_label, "%s (+ #FF9500 human#)", title);
    lv_label_set_recolor(g_graph_title_label, true);
  } else {
    lv_label_set_text(g_graph_title_label, title);
  }
  lv_obj_set_pos(g_graph_title_label, CONTENT_MARGIN, 20);

  g_graph_value_label = lv_label_create(parent);
  lv_obj_set_style_text_color(g_graph_value_label, COLOR_ACCENT, 0);
  lv_obj_set_style_text_font(g_graph_value_label, &lv_font_montserrat_32, 0);
  lv_label_set_text(g_graph_value_label, "--");
  lv_obj_set_pos(g_graph_value_label, CONTENT_MARGIN, 42);

  make_divider(parent, 96);

  /* Edge-to-edge, same motif as the mini graph now uses (see its own build
   * site's comment): no reserved Y-axis gutter - the MIN/AVG/MAX tiles
   * below already show that same min/max/avg information as real numbers,
   * so a gutter reserved just for redundant axis ticks wasn't worth the
   * plot-area cost. Chart spans the full content width instead. */
  g_graph_chart = lv_chart_create(parent);
  lv_obj_remove_style_all(g_graph_chart);
  lv_obj_set_pos(g_graph_chart, CONTENT_MARGIN, 112);
  lv_obj_set_size(g_graph_chart, CONTENT_W, 210);
  lv_obj_set_style_bg_color(g_graph_chart, COLOR_TILE_BG, LV_PART_MAIN);
  lv_obj_set_style_bg_opa(g_graph_chart, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_radius(g_graph_chart, 12, LV_PART_MAIN);
  lv_obj_set_style_pad_all(g_graph_chart, 10, LV_PART_MAIN);
  lv_obj_set_style_line_color(g_graph_chart, COLOR_DIVIDER, LV_PART_MAIN);
  lv_obj_set_style_line_width(g_graph_chart, 1, LV_PART_MAIN);
  /* 3 horizontal; vertical per the same vdiv_cnt-is-total-lines-including-
   * both-edges formula explained on the mini graph's own
   * lv_chart_set_div_line_count() call above - GRAPH_CHART_POINTS=60 at 4
   * points/min = 15 one-minute gaps, so vdiv=16 (16 lines, 15 gaps), not 14. */
  lv_chart_set_div_line_count(g_graph_chart, 3, 16);
  /* No real Y-axis ticks any more (see edge-to-edge comment above) - only
   * disabling the label, not the whole axis config call, same reasoning as
   * the mini graph's own lv_chart_set_axis_tick() call. No X-axis labels
   * either (interval lines alone are enough - the title/live value above
   * already establish what's being shown; adding tick timestamps isn't
   * worth the space on a screen this size). */
  lv_chart_set_axis_tick(g_graph_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 0, 3, 1, false, 0);
  lv_obj_add_event_cb(g_graph_chart, graph_draw_part_cb, LV_EVENT_DRAW_PART_BEGIN, NULL);
  lv_chart_set_type(g_graph_chart, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(g_graph_chart, GRAPH_CHART_POINTS);
  lv_chart_set_update_mode(g_graph_chart, LV_CHART_UPDATE_MODE_SHIFT);
  lv_obj_set_style_line_width(g_graph_chart, 3, LV_PART_ITEMS);
  lv_obj_set_style_size(g_graph_chart, 0, LV_PART_INDICATOR); /* hide point markers - a clean continuous line, not a dot-per-sample plot */

  g_graph_series = lv_chart_add_series(g_graph_chart, COLOR_ACCENT, LV_CHART_AXIS_PRIMARY_Y);
  lv_chart_set_all_value(g_graph_chart, g_graph_series, LV_CHART_POINT_NONE);
  lv_chart_set_range(g_graph_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 1); /* placeholder until the first point lands (demo or real) and refresh_graph_stats() rescales it */

  /* Backfill from this slot's own history if we're re-entering on the same
   * configured variable - see g_graph_history's own comment for why. A
   * variable change invalidates the old history outright (different units/
   * scale), same as switching slots already resets everything else here. */
  if (g_graph_history_source[g_graph_screen_slot] != source) {
    g_graph_history_source[g_graph_screen_slot] = source;
    g_graph_history_count[g_graph_screen_slot] = 0;
    g_graph_history_human_count[g_graph_screen_slot] = 0;
  } else {
    for (uint8_t i = 0; i < g_graph_history_count[g_graph_screen_slot]; i++) {
      lv_chart_set_next_value(g_graph_chart, g_graph_series, g_graph_history[g_graph_screen_slot][i]);
    }
  }

  /* Human-power overlay - Motor Power slot only, see g_graph_series_human's
   * own comment for why this doesn't get its own MIN/AVG/MAX row. Backfills
   * the same way the primary series just did, from its own history. */
  if (graph_screen_shows_motor_power()) {
    g_graph_series_human = lv_chart_add_series(g_graph_chart, COLOR_ORANGE, LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(g_graph_chart, g_graph_series_human, LV_CHART_POINT_NONE);
    for (uint8_t i = 0; i < g_graph_history_human_count[g_graph_screen_slot]; i++) {
      lv_chart_set_next_value(g_graph_chart, g_graph_series_human, g_graph_history_human[g_graph_screen_slot][i]);
    }
  } else {
    g_graph_series_human = NULL;
  }

  /* Same dashed gold average line as the mini graph - see its own build
   * site's comment for why dashed/gold. */
  g_graph_avg_cursor = lv_chart_add_cursor(g_graph_chart, COLOR_GRAPH_AVG, LV_DIR_HOR);
  lv_obj_set_style_line_width(g_graph_chart, 1, LV_PART_CURSOR);
  lv_obj_set_style_line_dash_width(g_graph_chart, 4, LV_PART_CURSOR);
  lv_obj_set_style_line_dash_gap(g_graph_chart, 3, LV_PART_CURSOR);

  /* Same min (bottom-left)/max (top-left, white)/avg (top-right, gold)
   * overlay-on-the-plot labels as the mini graph - see its own build site's
   * comment. */
  g_graph_max_label = lv_label_create(g_graph_chart);
  lv_obj_set_style_text_color(g_graph_max_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(g_graph_max_label, &lv_font_montserrat_14, 0);
  lv_obj_set_pos(g_graph_max_label, 4, 2);

  g_graph_min_label = lv_label_create(g_graph_chart);
  lv_obj_set_style_text_color(g_graph_min_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(g_graph_min_label, &lv_font_montserrat_14, 0);
  lv_obj_align(g_graph_min_label, LV_ALIGN_BOTTOM_LEFT, 4, -2);

  g_graph_avg_label = lv_label_create(g_graph_chart);
  lv_obj_set_style_text_color(g_graph_avg_label, COLOR_GRAPH_AVG, 0);
  lv_obj_set_style_text_font(g_graph_avg_label, &lv_font_montserrat_14, 0);
  lv_obj_align(g_graph_avg_label, LV_ALIGN_TOP_RIGHT, -4, 2);

  lv_coord_t stat_w = (CONTENT_W - 16) / 3; /* 2 * 8px gaps between 3 tiles */
  g_graph_min_value = make_stat_tile(parent, CONTENT_MARGIN, 340, stat_w, "MIN", NULL);
  g_graph_avg_value = make_stat_tile(parent, CONTENT_MARGIN + stat_w + 8, 340, stat_w, "AVG", NULL);
  g_graph_max_value = make_stat_tile(parent, CONTENT_MARGIN + 2 * (stat_w + 8), 340, stat_w, "MAX", NULL);
  /* make_stat_tile()'s default 20pt value font (sized for short strings like
   * "72%"/"11 mph" on the main screen) overflows a ~85px-wide tile for this
   * screen's longer "12.3 units" values (worst case here: "Wh/km") - drop to
   * 14pt and clip with an ellipsis as a hard backstop rather than letting
   * text spill past the tile edge. */
  lv_obj_t *stat_values[3] = {g_graph_min_value, g_graph_avg_value, g_graph_max_value};
  for (int i = 0; i < 3; i++) {
    lv_obj_set_style_text_font(stat_values[i], &lv_font_montserrat_14, 0);
    lv_label_set_long_mode(stat_values[i], LV_LABEL_LONG_DOT);
  }

  /* Must run after the MIN/AVG/MAX labels above exist - refresh_graph_stats()
   * writes into them directly (g_graph_min_value/_avg_value/_max_value), so
   * calling this any earlier hits stale pointers left over from whichever
   * screen was showing before this one was built - real accumulation
   * (update_graph_screen(), same on real hardware) fills and refreshes this
   * naturally as soon as points start landing, same as an empty chart on
   * real hardware at boot. Also where the history backfill above (if any)
   * gets its first real stats instead of waiting for the next live point. */
  if (g_graph_history_count[g_graph_screen_slot] > 0) refresh_graph_stats(source);

  /* Small page-dot pair (only 2 graph slots exist, see this section's
   * header comment) - the same "which of a small fixed set of pages am I
   * on" affordance every touch UI uses, cheap to build from a plain lv_obj
   * (no LVGL widget needed for two circles). */
  for (int i = 0; i < 2; i++) {
    lv_obj_t *dot = lv_obj_create(parent);
    lv_obj_remove_style_all(dot);
    lv_obj_set_size(dot, 8, 8);
    lv_obj_set_style_radius(dot, 4, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, i == g_graph_screen_slot ? COLOR_ACCENT : COLOR_DIVIDER, 0);
    lv_obj_set_pos(dot, SCREEN_W / 2 - 12 + i * 16, 424);
  }
}

static void format_field_value(const Field *f, char *buf, size_t n) {
  if (f->variant == FieldScrollable) {
    snprintf(buf, n, LV_SYMBOL_RIGHT);
    return;
  }
  /* FieldEditable from here down. */
  if (f->editable.typ == ReadOnlyStr) {
    const char *s = (const char *)f->editable.target;
    snprintf(buf, n, "%s", s ? s : "");
  } else if (f->editable.typ == EditEnum) {
    uint8_t idx = (uint8_t)field_read_uint(f);
    int count = count_enum_options(f);
    if (count == 0 || idx >= count) {
      buf[0] = 0;
    } else {
      snprintf(buf, n, "%s", f->editable.editEnum.options[idx]);
    }
  } else {
    int32_t disp = field_to_display_value(f, (int32_t)field_read_uint(f));
    format_number(buf, n, disp, f->editable.number.div_digits, f->editable.number.hide_fraction, field_display_units(f));
  }
}

static const char *field_label_str(const Field *f) {
  return f->variant == FieldScrollable ? f->scrollable.label : f->editable.label;
}

/* Live-updates just the row currently being edited, without a full
 * rebuild_config_list() (which would also cost an unnecessary
 * lv_obj_clean()/recreate of every other row on every single UP/DOWN
 * click while adjusting a value). */
static lv_obj_t *g_config_editing_row;

static void refresh_editing_row(const Field *f) {
  if (!g_config_editing_row) return;
  char buf[24];
  if (f->editable.typ == EditEnum) {
    int count = count_enum_options(f);
    int idx = g_config_edit_value;
    if (count == 0 || idx < 0 || idx >= count) {
      buf[0] = 0;
    } else {
      snprintf(buf, sizeof(buf), "%s", f->editable.editEnum.options[idx]);
    }
  } else {
    format_number(buf, sizeof(buf), g_config_edit_value, f->editable.number.div_digits, f->editable.number.hide_fraction,
      field_display_units(f));
  }
  lv_label_set_text_fmt(g_config_editing_row, "%s\n%s", field_label_str(f), buf);
}

static void rebuild_config_list(void);

static void enter_edit_mode(const Field *f) {
  if (f->editable.typ == EditEnum) {
    g_config_edit_value = (int32_t)field_read_uint(f);
  } else {
    g_config_edit_value = field_to_display_value(f, (int32_t)field_read_uint(f));
  }
  g_config_editing = true;
  rebuild_config_list();
}

/* Writes the edited value back (SI units) and fires the field's real
 * onSetEditable side-effect hook, if any - screen.c's own
 * setActiveEditable() calls onSetEditable with the DISPLAY-unit value
 * before writing target back in SI, and several real config fields
 * (odometer, service distances, charge cycles, clock, backlight) depend
 * on that ordering for correctness (e.g. onSetConfigurationWheelOdometer
 * does its own screenConvertMiles-aware math on the value it's given) -
 * matched exactly here, not simplified away. Only EditUInt fields ever
 * set onSetEditable (it lives in the .number union member, which
 * overlaps .editEnum for EditEnum fields - reading it there would be
 * reading garbage, not just "usually NULL"). */
static void commit_edit(const Field *f) {
  if (f->editable.typ == EditEnum) {
    field_write_uint(f, (uint32_t)g_config_edit_value);
    return;
  }
  if (f->editable.number.onSetEditable) f->editable.number.onSetEditable((uint32_t)g_config_edit_value);
  int32_t si = field_from_display_value(f, g_config_edit_value);
  field_write_uint(f, (uint32_t)si);
}

/* Real screen.c semantics: increment/decrement WRAP at the bounds (not
 * clamp) for EditEnum, and for EditUInt fields that don't set no_wrap -
 * confirmed by reading changeEditable()'s own "loop around" comments,
 * matched here since riders coming from the stock UI already expect that
 * behavior. An EditUInt field with no_wrap set instead clamps at the
 * bound - see changeEditable()'s own no_wrap branch (screen.c). This is a
 * second, independent reimplementation of that same switch (the LVGL
 * config screen doesn't call changeEditable() at all) - 2026-08-29: this
 * copy was missing the no_wrap branch entirely, so "Used Wh"/"Battery
 * total Wh" (configscreen.c, both set no_wrap since 2026-08-28 to stop a
 * hold-"-"-past-0 overshoot straight to their ~9990/2999 max) still wrapped
 * on this theme even after that fix landed, because this theme is what the
 * 860C (and this sim) actually run - screen.c's own copy is effectively
 * dead code here. Bounds are compared in DISPLAY units throughout
 * (field_to_display_value()) - comparing g_config_edit_value against the
 * field's raw SI min/max directly would be wrong under imperial (e.g. a
 * mile value clamped against a km-scaled bound).
 *
 * fast mirrors changeEditable()'s own x10 parameter: only ever multiplies
 * the step for numeric (EditUInt) fields - screen.c's own switch never
 * applies it to EditEnum (cycling a short options list 10 at a time would
 * mostly just skip past everything), matched here rather than simplified
 * away. */
static void adjust_edit_value(const Field *f, int dir, bool fast) {
  if (f->editable.typ == EditEnum) {
    int count = count_enum_options(f);
    if (count == 0) return;
    g_config_edit_value += dir;
    if (g_config_edit_value < 0) g_config_edit_value = count - 1;
    else if (g_config_edit_value >= count) g_config_edit_value = 0;
  } else {
    int32_t step = f->editable.number.inc_step ? (int32_t)f->editable.number.inc_step : 1;
    if (fast) step *= 10;
    int32_t disp_min = field_to_display_value(f, (int32_t)f->editable.number.min_value);
    int32_t disp_max = field_to_display_value(f, (int32_t)f->editable.number.max_value);
    if (disp_min > disp_max) { int32_t t = disp_min; disp_min = disp_max; disp_max = t; } /* conversion can flip order (e.g. C->F does not) - defensive */
    g_config_edit_value += dir * step;
    if (f->editable.number.no_wrap) {
      if (g_config_edit_value < disp_min) g_config_edit_value = disp_min;
      else if (g_config_edit_value > disp_max) g_config_edit_value = disp_max;
    } else {
      if (g_config_edit_value < disp_min) g_config_edit_value = disp_max;
      else if (g_config_edit_value > disp_max) g_config_edit_value = disp_min;
    }
  }
  refresh_editing_row(f);
}

/* Shared, statically-allocated styles for every row - NOT per-object
 * local style calls, and ONE lv_obj_t per row (a label, showing the
 * field's name and value stacked on two lines), not several. Both of
 * these are hard memory constraints, not style/layout preferences:
 * LV_MEM_SIZE (lv_conf.h) is 16KB total for LVGL's entire runtime heap on
 * this target, and the main screen's own objects already live in it
 * permanently (dashboard_theme.c never frees g_main_screen_obj) - direct
 * measurement (lv_mem_monitor()) showed only ~6.6KB still free by the
 * time this screen starts building. A first version (one row container +
 * 2 child labels, still using shared styles) still exhausted that
 * instantly ("lv_mem_realloc: couldn't allocate memory" the moment this
 * screen tried to build, confirmed directly, not guessed at). Cutting to
 * one object per row - accepting a two-line "Label\nValue" layout instead
 * of a side-by-side one - was what actually made a ~13-row list fit.
 * `lv_style_t` objects declared `static` live in .bss (compile-time
 * storage, zero heap cost to define); `lv_obj_add_style()` only costs a
 * small pointer-sized entry per object to reference one, however many
 * rows share it. */
static lv_style_t style_row;
static lv_style_t style_row_readonly;
static lv_style_t style_row_selected;
static lv_style_t style_row_selected_readonly;
static lv_style_t style_row_editing;
static bool g_config_styles_ready;

static void ensure_config_styles(void) {
  if (g_config_styles_ready) return;
  g_config_styles_ready = true;

  lv_style_init(&style_row);
  lv_style_set_bg_opa(&style_row, LV_OPA_COVER);
  lv_style_set_bg_color(&style_row, COLOR_TILE_BG);
  lv_style_set_radius(&style_row, 8);
  lv_style_set_pad_all(&style_row, 8);
  lv_style_set_text_color(&style_row, COLOR_TEXT);
  lv_style_set_text_font(&style_row, &lv_font_montserrat_14);
  lv_style_set_text_line_space(&style_row, 2);

  /* Unselected read-only field: the same COLOR_TILE_BG a regular row fills
   * itself with, just as an outline instead of a fill, permanently (not
   * only when highlighted - see style_row_selected_readonly below for that
   * case). COLOR_MUTED (used for muted text elsewhere) was tried first and
   * read as too loud/high-contrast for a border meant to be a subtle "this
   * one's different" cue, not a second accent color competing with the
   * teal selected-and-readonly outline. */
  lv_style_init(&style_row_readonly);
  lv_style_set_bg_opa(&style_row_readonly, LV_OPA_TRANSP);
  lv_style_set_radius(&style_row_readonly, 8);
  lv_style_set_pad_all(&style_row_readonly, 6);
  lv_style_set_border_width(&style_row_readonly, 2);
  lv_style_set_border_color(&style_row_readonly, COLOR_TILE_BG);
  lv_style_set_border_opa(&style_row_readonly, LV_OPA_COVER);
  lv_style_set_text_color(&style_row_readonly, COLOR_TEXT);
  lv_style_set_text_font(&style_row_readonly, &lv_font_montserrat_14);
  lv_style_set_text_line_space(&style_row_readonly, 2);

  lv_style_init(&style_row_selected);
  lv_style_set_bg_opa(&style_row_selected, LV_OPA_COVER);
  lv_style_set_bg_color(&style_row_selected, COLOR_ACCENT);
  lv_style_set_radius(&style_row_selected, 8);
  lv_style_set_pad_all(&style_row_selected, 8);
  lv_style_set_text_color(&style_row_selected, lv_color_black());
  lv_style_set_text_font(&style_row_selected, &lv_font_montserrat_14);
  lv_style_set_text_line_space(&style_row_selected, 2);

  /* Highlighted-but-read-only: same outline treatment as style_row_readonly
   * above, just with the accent color swapped from grey to teal - so
   * landing the cursor on a read-only field reads as "you can look, not
   * touch" rather than looking identical to a field you're about to be able
   * to edit (style_row_selected's solid teal fill). pad_all is 6, not
   * style_row's 8, since the border eats into the padding box in LVGL and
   * this keeps the text at the same visual inset it has everywhere else. */
  lv_style_init(&style_row_selected_readonly);
  lv_style_set_bg_opa(&style_row_selected_readonly, LV_OPA_TRANSP);
  lv_style_set_radius(&style_row_selected_readonly, 8);
  lv_style_set_pad_all(&style_row_selected_readonly, 6);
  lv_style_set_border_width(&style_row_selected_readonly, 2);
  lv_style_set_border_color(&style_row_selected_readonly, COLOR_ACCENT);
  lv_style_set_border_opa(&style_row_selected_readonly, LV_OPA_COVER);
  lv_style_set_text_color(&style_row_selected_readonly, COLOR_TEXT);
  lv_style_set_text_font(&style_row_selected_readonly, &lv_font_montserrat_14);
  lv_style_set_text_line_space(&style_row_selected_readonly, 2);

  /* Distinct from style_row_selected on purpose - a plain cursor move and
   * "UP/DOWN now change this value" looked visually identical before this
   * style existed (same teal fill either way), which read as "editing does
   * nothing" even though the value genuinely was changing underneath -
   * confirmed directly: a Playwright run against the sim showed "disable"
   * really did flip to "enable" on UP while still teal, just with no visual
   * cue a rider would notice. White-on-... i.e. white fill/black text (the
   * inverse of every other row state, which are all dark-fill/light-text)
   * reads as "armed" at a glance and can't be confused with plain
   * selection. */
  lv_style_init(&style_row_editing);
  lv_style_set_bg_opa(&style_row_editing, LV_OPA_COVER);
  lv_style_set_bg_color(&style_row_editing, lv_color_white());
  lv_style_set_radius(&style_row_editing, 8);
  lv_style_set_pad_all(&style_row_editing, 8);
  lv_style_set_text_color(&style_row_editing, lv_color_black());
  lv_style_set_text_font(&style_row_editing, &lv_font_montserrat_14);
  lv_style_set_text_line_space(&style_row_editing, 2);
}

/* Builds "label" + n_spaces spaces + the chevron symbol into buf. Broken out
 * of format_scrollable_row_text() so that function can call it repeatedly
 * while searching for the right space count. */
static void build_scrollable_candidate(char *buf, size_t bufsz, const char *label, int n_spaces) {
  int off = snprintf(buf, bufsz, "%s", label);
  if (off < 0) off = 0;
  while (n_spaces-- > 0 && (size_t)off < bufsz - 1) buf[(size_t)off++] = ' ';
  buf[off] = '\0';
  snprintf(buf + off, bufsz - (size_t)off, "%s", LV_SYMBOL_RIGHT);
}

/* Right-aligns a chevron against a proportional font without a second
 * object: a real second lv_obj_t per scrollable row (there can be a
 * dozen+ at some levels) was tried first and immediately re-exhausted the
 * same 16KB heap this file's other memory comment already describes -
 * confirmed directly (LVGL logged an out-of-memory assert again the
 * moment that build re-entered this screen), not assumed. Padding with
 * just-enough space characters to reach the row's right edge gets the same
 * visual result inside the ONE label object every other row variant
 * already uses, for zero heap cost.
 *
 * The space count is found by actually measuring each candidate's real
 * rendered width (lv_txt_get_width() on the full "label + spaces +
 * chevron" string), not by summing a per-glyph space width and dividing -
 * avoids ever trusting an assumed per-space width for the final answer.
 * The loop bound below, however, DOES need an estimate of the space
 * glyph's width, and getting that estimate wrong is exactly what broke
 * this the first time: this font's space glyph measures only ~4px wide
 * (confirmed directly via lv_txt_get_width(" ", 1, ...), not assumed), so
 * a short label like "Bike" genuinely needs ~60 spaces to cross a 280px
 * row - a hardcoded "n <= 48" cap silently truncated the search before it
 * ever got there, so every short label landed wherever 48 spaces happened
 * to reach (well short of the edge) while longer labels, needing fewer
 * spaces to begin with, never hit the cap and looked fine. Sizing the
 * bound from a real measurement of one space glyph, not a guessed
 * constant, fixes that regardless of what any given font's actual space
 * width turns out to be. */
static void format_scrollable_row_text(char *buf, size_t bufsz, const char *label) {
  const lv_font_t *font = &lv_font_montserrat_14;
  lv_coord_t row_inner_w = CONTENT_W - 16; /* style_row's pad_all(8) on both left and right */

  lv_coord_t space_w = lv_txt_get_width(" ", 1, font, 0, LV_TEXT_FLAG_NONE);
  int max_n = space_w > 0 ? (int)(row_inner_w / space_w) + 4 : 4; /* +4: slack for the label/chevron/kerning this estimate ignores */
  if (max_n < 4) max_n = 4;
  if (max_n > 120) max_n = 120; /* sanity ceiling only - bufsz below covers up to this */

  build_scrollable_candidate(buf, bufsz, label, 1);
  for (int n = 2; n <= max_n; n++) {
    char cand[160];
    build_scrollable_candidate(cand, sizeof(cand), label, n);
    lv_coord_t w = lv_txt_get_width(cand, (uint32_t)strlen(cand), font, 0, LV_TEXT_FLAG_NONE);
    if (w > row_inner_w) break; /* one space too many - buf already holds the last candidate that fit */
    memcpy(buf, cand, bufsz < sizeof(cand) ? bufsz : sizeof(cand));
  }
}

static lv_obj_t *make_config_row(lv_obj_t *parent, const Field *f, bool selected) {
  lv_obj_t *row = lv_label_create(parent);
  bool editing_this_row = selected && g_config_editing;
  /* Read-only fields (FieldEditable with .read_only set, or dynamically
   * .rw->locked - FieldScrollable submenu rows are always "enterable" so
   * never count) get the outline style instead of the solid-teal one when
   * highlighted - see style_row_selected_readonly's own comment. */
  bool read_only_field = f->variant == FieldEditable && (f->editable.read_only || f->rw->locked);
  lv_style_t *row_style = read_only_field ? &style_row_readonly : &style_row;
  if (editing_this_row) row_style = &style_row_editing;
  else if (selected) row_style = read_only_field ? &style_row_selected_readonly : &style_row_selected;
  lv_obj_add_style(row, row_style, 0);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);

  if (editing_this_row) {
    g_config_editing_row = row;
    refresh_editing_row(f);
  } else if (f->variant == FieldScrollable) {
    /* No real "value" to show for a submenu row - single line (not the
     * two-line label/value stack below) with a right-aligned chevron,
     * padded into the same string via format_scrollable_row_text(). */
    char rowbuf[160]; /* matches format_scrollable_row_text()'s own cand[160]/max_n<=120 sizing */
    format_scrollable_row_text(rowbuf, sizeof(rowbuf), field_label_str(f));
    lv_label_set_text(row, rowbuf);
  } else {
    char valbuf[24];
    format_field_value(f, valbuf, sizeof(valbuf));
    lv_label_set_text_fmt(row, "%s\n%s", field_label_str(f), valbuf);
  }

  return row;
}

static void rebuild_config_list(void) {
  config_nav_level_t *level = &g_config_stack[g_config_depth];
  lv_label_set_text(g_config_title_label, level->label ? level->label : "Configurations");

  lv_obj_clean(g_config_list);
  g_config_editing_row = NULL;

  int count = count_supported_fields(level->entries);
  if (count == 0) return;
  if (level->selected >= count) level->selected = count - 1;
  if (level->selected < 0) level->selected = 0;

  lv_obj_t *selected_row = NULL;
  for (int i = 0; i < count; i++) {
    const Field *f = nth_supported_field(level->entries, i);
    lv_obj_t *row = make_config_row(g_config_list, f, i == level->selected);
    if (i == level->selected) selected_row = row;
  }
  if (selected_row) lv_obj_scroll_to_view(selected_row, LV_ANIM_OFF);
}

static void push_level(const Field *scrollable_field) {
  if (g_config_depth + 1 >= CONFIG_MAX_DEPTH) return; /* real tree never nests this deep - defensive only */
  g_config_depth++;
  g_config_stack[g_config_depth].entries = scrollable_field->scrollable.entries;
  g_config_stack[g_config_depth].label = scrollable_field->scrollable.label;
  g_config_stack[g_config_depth].selected = 0;
  rebuild_config_list();
}

/* Returns true if it left the config screen entirely (depth was already
 * 0) - the caller uses this to know whether it's still safe to touch
 * config-screen state afterward. */
static bool pop_level_or_exit(void) {
  if (g_config_depth == 0) {
    g_lvgl_screen_on_press = NULL;
    dashboard_theme_return_to_main();
    return true;
  }
  g_config_depth--;
  rebuild_config_list();
  return false;
}

/* Registered as g_lvgl_screen_on_press (screen.h) while this screen is
 * showing - see that variable's own doc comment for the full mechanism.
 * MUST return true unconditionally (every path, including the final
 * fallback): mainscreen.c's handle_buttons() calls screenOnPress() first
 * and only falls through to appwide_onpress() if it returns false, so any
 * event this function ever let through would ALSO get processed as a
 * main-screen button press in the background (e.g. UP/DOWN silently
 * changing ui_vars.ui8_assist_level while the rider thinks they're just
 * moving the config cursor) - not a hypothetical, this is exactly what
 * happened before this function swallowed every event explicitly. */
static bool config_screen_on_press(buttons_events_t events) {
  config_nav_level_t *level = &g_config_stack[g_config_depth];
  int count = count_supported_fields(level->entries);
  const Field *f = count > 0 ? nth_supported_field(level->entries, level->selected) : NULL;

  if (g_config_editing) {
    if (f) {
      if (events & UP_CLICK) adjust_edit_value(f, 1, false);
      else if (events & DOWN_CLICK) adjust_edit_value(f, -1, false);
      else if (events & M_CLICK) { commit_edit(f); g_config_editing = false; rebuild_config_list(); }
      else if (events & ONOFF_CLICK) { commit_edit(f); g_config_editing = false; rebuild_config_list(); }
    }
    return true;
  }

  /* Wraps at both ends, same "loop around" convention as adjust_edit_value()
   * above - a long root menu (topMenus currently has a dozen-plus entries)
   * otherwise means holding DOWN all the way back up to reach the first
   * couple rows from the bottom. */
  if (events & DOWN_CLICK) {
    if (count > 0) { level->selected = (level->selected + 1) % count; rebuild_config_list(); }
  } else if (events & UP_CLICK) {
    if (count > 0) { level->selected = (level->selected - 1 + count) % count; rebuild_config_list(); }
  } else if (events & M_CLICK) {
    if (f) {
      if (f->variant == FieldScrollable) push_level(f);
      else if (f->variant == FieldEditable && !f->editable.read_only && !f->rw->locked) enter_edit_mode(f);
    }
  } else if (events & ONOFF_CLICK) {
    pop_level_or_exit();
  }
  return true;
}

/* Press-and-hold repeat for UP/DOWN, both while editing a value AND while
 * just moving the cursor through a row list - the latter is what actually
 * matters most given how long topMenus and some submenus run; a long list
 * is exactly what makes holding-to-fly-through worth having. Editing mirrors
 * real screen.c's own mechanism (onPressEditable()'s comment,
 * changeEditable()): a held UP/DOWN keeps changing the value, accelerating
 * to a x10 step after a few seconds. screen.c does this by polling raw
 * button state every BLINK_INTERVAL_MS (300ms) from its render tick and
 * leaving the discrete UP_CLICK/DOWN_CLICK handler a no-op while editing -
 * not reused verbatim here because a very short tap can fall between two
 * 300ms-aligned polls and produce no movement at all (confirmed by reading
 * changeEditable()'s call site - it's genuinely poll-only, not layered on
 * top of the click events). This instead keeps config_screen_on_press()'s
 * existing UP_CLICK/DOWN_CLICK path (already verified working) for a
 * guaranteed single step/row per tap, and adds hold-repeat as a separate,
 * purely additive mechanism gated behind an initial delay well past any
 * normal tap's press-release span - so the two can never double-count the
 * same press. Row-cursor repeat has no x10 acceleration or real-firmware
 * precedent (screen.c's cursor movement is discrete-click-only even on
 * real hardware) - it's a straight repeat, added because this fork's config
 * screen exposes deeper/longer lists than the real UI ever needed to.
 * Registered as update_config_screen (dashboard_theme.h), called every real
 * tick (20ms, matching mainscreen.c's handle_buttons() cadence on both real
 * firmware and the sim - see dashboard_theme.c). */
#define CONFIG_REPEAT_TICK_MS      20
#define CONFIG_REPEAT_INITIAL_MS   500  /* hold this long before repeat starts */
#define CONFIG_REPEAT_INTERVAL_MS  100  /* then repeat at this cadence */
#define CONFIG_REPEAT_FAST_AFTER_MS 3000 /* x10 edit step past this much continuous hold */

static void update_config_screen(void) {
  config_nav_level_t *level = &g_config_stack[g_config_depth];
  int count = count_supported_fields(level->entries);
  const Field *f = count > 0 ? nth_supported_field(level->entries, level->selected) : NULL;

#ifndef SW102
  // live-relock every tick, so editing a controlling field updates dependents
  // immediately - including mid-edit, before the value is committed (see
  // update_field_locks()'s own doc comment on editing_field/editing_value).
  update_field_locks(g_config_editing ? f : NULL, g_config_edit_value);
#endif

  static uint16_t up_held_ms, up_since_repeat_ms;
  static uint16_t down_held_ms, down_since_repeat_ms;

  if (buttons_get_up_state()) {
    up_held_ms += CONFIG_REPEAT_TICK_MS;
    if (up_held_ms >= CONFIG_REPEAT_INITIAL_MS) {
      up_since_repeat_ms += CONFIG_REPEAT_TICK_MS;
      if (up_since_repeat_ms >= CONFIG_REPEAT_INTERVAL_MS) {
        up_since_repeat_ms = 0;
        if (g_config_editing) {
          if (f) adjust_edit_value(f, 1, up_held_ms >= CONFIG_REPEAT_FAST_AFTER_MS);
        } else if (count > 0) {
          level->selected = (level->selected - 1 + count) % count;
          rebuild_config_list();
        }
      }
    }
  } else {
    up_held_ms = 0;
    up_since_repeat_ms = 0;
  }

  if (buttons_get_down_state()) {
    down_held_ms += CONFIG_REPEAT_TICK_MS;
    if (down_held_ms >= CONFIG_REPEAT_INITIAL_MS) {
      down_since_repeat_ms += CONFIG_REPEAT_TICK_MS;
      if (down_since_repeat_ms >= CONFIG_REPEAT_INTERVAL_MS) {
        down_since_repeat_ms = 0;
        if (g_config_editing) {
          if (f) adjust_edit_value(f, -1, down_held_ms >= CONFIG_REPEAT_FAST_AFTER_MS);
        } else if (count > 0) {
          level->selected = (level->selected + 1) % count;
          rebuild_config_list();
        }
      }
    }
  } else {
    down_held_ms = 0;
    down_since_repeat_ms = 0;
  }
}

static void build_config_screen(lv_obj_t *parent) {
  ensure_config_styles();

  lv_obj_set_style_bg_color(parent, COLOR_BG, 0);
  lv_obj_set_style_bg_opa(parent, LV_OPA_COVER, 0);
  lv_obj_clear_flag(parent, LV_OBJ_FLAG_SCROLLABLE);

  g_config_title_label = lv_label_create(parent);
  lv_obj_set_style_text_color(g_config_title_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(g_config_title_label, &lv_font_montserrat_20, 0);
  lv_obj_set_pos(g_config_title_label, CONTENT_MARGIN, CONFIG_TITLE_Y);

  make_divider(parent, CONFIG_LIST_Y - 8);

  g_config_list = lv_obj_create(parent);
  lv_obj_remove_style_all(g_config_list);
  lv_obj_set_pos(g_config_list, CONTENT_MARGIN, CONFIG_LIST_Y);
  lv_obj_set_size(g_config_list, CONTENT_W, 480 - CONFIG_LIST_Y - CONTENT_MARGIN);
  lv_obj_set_flex_flow(g_config_list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(g_config_list, 6, 0);
  lv_obj_add_flag(g_config_list, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_scroll_dir(g_config_list, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(g_config_list, LV_SCROLLBAR_MODE_AUTO);

  /* configScreen (configscreen.c) has exactly one FieldLayout, pointing
   * at a single root FieldScrollable ("Configurations" -> topMenus) -
   * screen.h's own FieldScrollable doc comment: "If at the root of a
   * screen, submenu will be automatically expanded to fill remaining
   * screen space", i.e. the root itself was never meant to be a
   * clickable row - so this starts one level "inside" it (topMenus)
   * rather than showing a single "Configurations" row to click into. */
  const Field *root = configScreen.fields[0].field;
  g_config_depth = 0;
  g_config_stack[0].entries = root->scrollable.entries;
  g_config_stack[0].label = root->scrollable.label;
  g_config_stack[0].selected = 0;
  g_config_editing = false;

  rebuild_config_list();

  g_lvgl_screen_on_press = config_screen_on_press;
}

static void build_boot_screen(lv_obj_t *parent) {
  lv_obj_set_style_bg_color(parent, COLOR_BG, 0);
  lv_obj_set_style_bg_opa(parent, LV_OPA_COVER, 0);
  lv_obj_clear_flag(parent, LV_OBJ_FLAG_SCROLLABLE);
  boot_screen_ticks = 0;
  boot_integrity_checked = false;
  boot_integrity_ok = false;

  /* Wordmark - "osf." in the normal text color, "bike" in the accent teal,
   * on one line (short enough at 32pt to fit this panel's 296px content
   * width, unlike the old two-line "OpenSource"/"EBike" split). Built via
   * LVGL's inline recolor markup (#RRGGBB text#) rather than two side-by-
   * side labels - one label keeps it trivially centered as a unit
   * regardless of digit/word width, which two independently-positioned
   * labels would need per-tick recompute for (same reasoning as
   * speed_label/speed_unit_label on the main screen). Hex values match
   * COLOR_TEXT/COLOR_ACCENT above - recolor markup needs literal hex in the
   * string, it can't reference an lv_color_t. */
  lv_obj_t *wordmark = lv_label_create(parent);
  lv_label_set_recolor(wordmark, true);
  lv_label_set_text(wordmark, "#F5F7FA osf.##29D9C4 bike#");
  lv_obj_set_style_text_font(wordmark, &lv_font_montserrat_32, 0);
  lv_obj_set_width(wordmark, CONTENT_W);
  lv_obj_set_style_text_align(wordmark, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(wordmark, CONTENT_MARGIN, 150);

  lv_obj_t *subtitle = lv_label_create(parent);
  lv_label_set_text(subtitle, "OpenSource Firmware Smart EBike");
  lv_obj_set_style_text_color(subtitle, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(subtitle, &lv_font_montserrat_14, 0);
  lv_obj_set_width(subtitle, CONTENT_W);
  lv_obj_set_style_text_align(subtitle, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(subtitle, CONTENT_MARGIN, 196);

  lv_obj_t *version = lv_label_create(parent);
  /* DISPLAY_FIRMWARE_MAJOR/MINOR/PATCH (Makefile.common), not VERSION_STRING
   * (the legacy combined motor+display OSF release identifier) - this is
   * the same display-only version configscreen.c's "Display firmware"
   * Technical info row shows, so the boot splash and the config menu never
   * disagree with each other. */
  /* DISPLAY_BUILD_DATE (Makefile.common, auto-computed every build - not
   * hand-maintained like the version above) trails in parens specifically
   * so a rebuild that didn't get DISPLAY_FIRMWARE_PATCH bumped still shows
   * something that visibly changes between flashes - see that variable's
   * own comment for why this exists. */
  lv_label_set_text(version,
                     BOOT_SCREEN_TARGET_LABEL "  " DISPLAY_FIRMWARE_MAJOR "." DISPLAY_FIRMWARE_MINOR "." DISPLAY_FIRMWARE_PATCH
                     " (" DISPLAY_BUILD_DATE ")");
  lv_obj_set_style_text_color(version, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(version, &lv_font_montserrat_14, 0);
  lv_obj_set_width(version, CONTENT_W);
  lv_obj_set_style_text_align(version, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(version, CONTENT_MARGIN, 232);

  /* Status text - centered within the content width (and, like the old
   * single-label version, free to wrap if an error string ever exceeds it).
   * Updated every tick by update_boot_screen() below; starting text doesn't
   * matter, it's overwritten before the first frame is ever flushed. */
  boot_status_label = lv_label_create(parent);
  lv_label_set_text(boot_status_label, "");
  lv_obj_set_style_text_color(boot_status_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(boot_status_label, &lv_font_montserrat_20, 0);
  lv_obj_set_width(boot_status_label, CONTENT_W);
  lv_obj_set_style_text_align(boot_status_label, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(boot_status_label, CONTENT_MARGIN, 320);

  /* Animated ellipsis - a separate label parked (by update_boot_screen)
   * immediately right of the status text's right edge, so the status text
   * never shifts sideways as the dots grow/shrink. */
  boot_status_dots_label = lv_label_create(parent);
  lv_label_set_text(boot_status_dots_label, "");
  lv_obj_set_style_text_color(boot_status_dots_label, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(boot_status_dots_label, &lv_font_montserrat_20, 0);
  lv_obj_add_flag(boot_status_dots_label, LV_OBJ_FLAG_HIDDEN);

  /* RX byte counter on its own line below the status text - smaller and
   * muted to match the version string above, with padding between the two. */
  boot_status_rx_label = lv_label_create(parent);
  lv_label_set_text(boot_status_rx_label, "");
  lv_obj_set_style_text_color(boot_status_rx_label, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(boot_status_rx_label, &lv_font_montserrat_14, 0);
  lv_obj_set_width(boot_status_rx_label, CONTENT_W);
  lv_obj_set_style_text_align(boot_status_rx_label, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(boot_status_rx_label, CONTENT_MARGIN, 352);
  lv_obj_add_flag(boot_status_rx_label, LV_OBJ_FLAG_HIDDEN);

  /* Real safety guidance from mainscreen.c's bootStatus1 message - riders
   * historically pull off pedaling/braking right as the display powers up,
   * which can confuse the motor's own startup calibration. */
  lv_obj_t *hint = lv_label_create(parent);
  lv_label_set_text(hint, "Keep pedals and brakes free");
  lv_obj_set_style_text_color(hint, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(hint, &lv_font_montserrat_14, 0);
  lv_obj_set_width(hint, CONTENT_W);
  lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(hint, CONTENT_MARGIN, 420);
}

/* Real gating logic, ported from mainscreen.c's bootScreenOnPreUpdate()
 * (screen.c's onPreUpdate mechanism that used to call it is dead in this
 * LVGL build - see ugui_shim.c's screenUpdate() - so this is now driven
 * from dashboard_theme_tick() instead, at the same ~20ms cadence): waits
 * for the real motor UART handshake (g_motor_init_state) to finish, then
 * for the on/off button to be released, before calling
 * dashboard_theme_boot_complete(). Any MOTOR_INIT_ERROR* state blocks here
 * forever, matching the real firmware's own documented behavior ("any
 * error state will block here and avoid leave the boot screen") - this
 * doubles as this build's motor-side error screen, so there's no separate
 * one for that case.
 *
 * BOOT_SCREEN_MIN_TICKS enforces a minimum splash duration this real
 * gating logic doesn't otherwise have. On real hardware the UART handshake
 * already takes longer than this on its own, so it's invisible there - but
 * the WASM sim fakes an instantly-ready motor (sim_glue.c's sim_init() sets
 * g_motor_init_state = MOTOR_INIT_SIMULATING before the first tick), which
 * would otherwise skip this screen in a single 20ms frame, impossible to
 * see or test. */
#define BOOT_SCREEN_MIN_TICKS 75 /* 75 * 20ms = 1.5s */

static void update_boot_screen(void) {
  const char *status = NULL;
  lv_color_t status_color = COLOR_TEXT;
  bool blocked = false;
  bool ready = false;
  bool animate = false;

#ifdef STM32F10X_MD
  /* Runs once, before the motor handshake status below ever shows -
   * confirms what's actually sitting in flash right now still matches what
   * was built, catching a bad/incomplete UART bootloader write (see
   * uart-flasher.ts) that byte-identical source could never reveal.
   * boot_screen_ticks==0 shows this message for one real frame before the
   * blocking CRC-over-the-whole-image call below runs (that call itself
   * takes on the order of 100-200ms on this hardware, which is what
   * actually makes the message visible - see firmware_integrity_check_ok()
   * for the cost estimate), otherwise the very first frame the user ever
   * sees would already show "Connecting to motor...", skipping this step
   * entirely. */
  if (!boot_integrity_checked) {
    if (boot_screen_ticks == 0) {
      lv_label_set_text(boot_status_label, "Checking firmware integrity...");
      lv_obj_set_style_text_color(boot_status_label, COLOR_TEXT, 0);
      boot_screen_ticks++;
      return;
    }
    boot_integrity_checked = true;
    boot_integrity_ok = firmware_integrity_check_ok();
  }

  if (!boot_integrity_ok) {
    /* Same permanently-blocked treatment as a MOTOR_INIT_ERROR* state below
     * - a corrupted image isn't something to proceed past. */
    lv_label_set_text(boot_status_label, "Firmware integrity check failed");
    lv_obj_set_style_text_color(boot_status_label, COLOR_ERROR, 0);
    if (boot_screen_ticks < 0xFFFF) boot_screen_ticks++;
    return;
  }
#endif

  switch (g_motor_init_state) {
    case MOTOR_INIT_GET_MOTOR_ALIVE:
    case MOTOR_INIT_WAIT_MOTOR_ALIVE:
      status = "Connecting to motor";
      animate = true;
      break;
    case MOTOR_INIT_GET_MOTOR_FIRMWARE_VERSION:
    case MOTOR_INIT_WAIT_MOTOR_FIRMWARE_VERSION:
    case MOTOR_INIT_GOT_MOTOR_FIRMWARE_VERSION:
    case MOTOR_INIT_RECEIVED_MOTOR_FIRMWARE_VERSION:
      status = "Reading motor firmware";
      animate = true;
      break;
    case MOTOR_INIT_SET_CONFIGURATIONS:
    case MOTOR_INIT_WAIT_CONFIGURATIONS_OK:
    case MOTOR_INIT_WAIT_GOT_CONFIGURATIONS_OK:
      status = "Sending configuration";
      animate = true;
      break;
    case MOTOR_INIT_READY:
    case MOTOR_INIT_SIMULATING:
      status = "Ready";
      ready = true;
      break;
    case MOTOR_INIT_ERROR_GET_FIRMWARE_VERSION:
    case MOTOR_INIT_ERROR_FIRMWARE_VERSION:
    case MOTOR_INIT_ERROR_SET_CONFIGURATIONS:
    case MOTOR_INIT_ERROR:
    default:
      status = "Motor error - check connections";
      status_color = COLOR_ERROR;
      blocked = true;
      break;
  }

  if (animate) {
    /* The status text only changes on a handshake state transition, which
     * never happens while no ALIVE frame arrives - so without a live dot
     * count the screen reads as hung exactly when the motor link is the
     * thing being debugged. Cycle 0-3 dots (one step per ~120ms) so there's
     * continuous visual motion, plus the raw RX byte counter on real
     * hardware so "bytes arriving but no valid frame" vs "nothing arriving
     * at all" are distinguishable at a glance. */
    static const char *const dots[] = { "", ".", "..", "..." };
    lv_label_set_text(boot_status_label, status);
    lv_label_set_text(boot_status_dots_label, dots[(boot_screen_ticks / 6) & 0x03]);
    /* Park the dots right after the status text's right edge so they grow
     * rightward without nudging the centered text sideways. */
    lv_coord_t text_w = lv_txt_get_width(status, (uint32_t) strlen(status),
                                         &lv_font_montserrat_20, 0, LV_TEXT_FLAG_NONE);
    lv_obj_set_pos(boot_status_dots_label, CONTENT_MARGIN + (CONTENT_W + text_w) / 2, 320);
    lv_obj_clear_flag(boot_status_dots_label, LV_OBJ_FLAG_HIDDEN);
#ifdef STM32F10X_MD
    lv_label_set_text_fmt(boot_status_rx_label, "RX %lu",
                          (unsigned long) ui32_usart1_rx_byte_count);
    lv_obj_clear_flag(boot_status_rx_label, LV_OBJ_FLAG_HIDDEN);
#endif
  } else {
    lv_label_set_text(boot_status_label, status);
    lv_obj_add_flag(boot_status_dots_label, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(boot_status_rx_label, LV_OBJ_FLAG_HIDDEN);
  }
  lv_obj_set_style_text_color(boot_status_label, status_color, 0);

  if (boot_screen_ticks < 0xFFFF) boot_screen_ticks++;

  if (!blocked && ready && boot_screen_ticks >= BOOT_SCREEN_MIN_TICKS &&
      buttons_get_onoff_state() == 0) {
    dashboard_theme_boot_complete();
  }
}

/* Real, dynamic fault text - defined here (not fault.c) because fault.c is
 * excluded from the WASM display sim build (wasm-display-sim/build.sh's own
 * comment: it has a raw ARM Thumb inline-asm helper that can't target
 * wasm32), while this file is compiled into both. fault.c still owns
 * writing into them, via fieldPrintf() (a real implementation now, see
 * ugui_shim.c) right before every panicScreenShow() call - see its own
 * extern declaration of these three there.
 *
 * FieldDrawTextRW, same as fault.c's faultHeading/addrHeading/infoHeading -
 * but unlike those three, this build never relies on screen.h's
 * FIELD_DRAWTEXT_RW macro applying a `.msg = "..."` initializer (it
 * doesn't - the macro's `...` args are captured but never referenced in
 * its expansion, a latent vendored quirk), since these three are always
 * populated dynamically via fieldPrintf() instead; build_fault_screen()
 * below uses its own plain literals for the "FAULT"/"Code"/"PC"/"Info"
 * headings rather than reading fault.c's (unreliable) heading Fields. */
Field faultCode = FIELD_DRAWTEXT_RW();
Field addrCode = FIELD_DRAWTEXT_RW();
Field infoCode = FIELD_DRAWTEXT_RW();

static lv_obj_t *make_fault_line(lv_obj_t *parent, lv_coord_t y, const char *heading, const char *value) {
  lv_obj_t *row = lv_label_create(parent);
  lv_label_set_text_fmt(row, "%s: %s", heading, value);
  lv_obj_set_style_text_color(row, COLOR_TEXT, 0);
  lv_obj_set_style_text_font(row, &lv_font_montserrat_14, 0);
  lv_obj_set_width(row, CONTENT_W);
  lv_obj_set_pos(row, CONTENT_MARGIN, y);
  return row;
}

/* Terminal crash screen - see dashboard_theme_show_fault()'s doc comment.
 * Built exactly once per crash and never updated again, so unlike every
 * other build_*_screen here this reads its data directly at build time
 * rather than deferring to an update_*_screen callback. */
static void build_fault_screen(lv_obj_t *parent) {
  lv_obj_set_style_bg_color(parent, COLOR_BG, 0);
  lv_obj_set_style_bg_opa(parent, LV_OPA_COVER, 0);
  lv_obj_clear_flag(parent, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *heading = lv_label_create(parent);
  lv_label_set_text(heading, "FAULT");
  lv_obj_set_style_text_color(heading, COLOR_ERROR, 0);
  lv_obj_set_style_text_font(heading, &lv_font_montserrat_32, 0);
  lv_obj_set_width(heading, CONTENT_W);
  lv_obj_set_style_text_align(heading, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(heading, CONTENT_MARGIN, 100);

  make_divider(parent, 160);

  make_fault_line(parent, 190, "Code", faultCode.rw->drawTextPtr.msg);
  make_fault_line(parent, 220, "PC", addrCode.rw->drawTextPtr.msg);
  make_fault_line(parent, 250, "Info", infoCode.rw->drawTextPtr.msg);

  lv_obj_t *hint = lv_label_create(parent);
  lv_label_set_text(hint, "Power cycle the display to restart");
  lv_obj_set_style_text_color(hint, COLOR_MUTED, 0);
  lv_obj_set_style_text_font(hint, &lv_font_montserrat_14, 0);
  lv_obj_set_width(hint, CONTENT_W);
  lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_set_pos(hint, CONTENT_MARGIN, 400);
}

/* Not static - this is the canonical config-screen fallback every theme
 * (including this one) is expected to go through, per dashboard_theme.h's
 * own doc comment; dashboard_theme.c references it by name. */
const dashboard_theme_t osf_modern_theme = {
    .name = "OSF Modern",
    .build_main_screen = build_main_screen,
    .update_main_screen = update_main_screen,
    .build_graph_screen = build_graph_screen,
    .update_graph_screen = update_graph_screen,
    .build_config_screen = build_config_screen,
    .update_config_screen = update_config_screen,
    .build_boot_screen = build_boot_screen,
    .update_boot_screen = update_boot_screen,
    .build_fault_screen = build_fault_screen,
};

const dashboard_theme_t *g_available_themes[] = {&osf_modern_theme};
const uint8_t g_available_themes_count = 1;

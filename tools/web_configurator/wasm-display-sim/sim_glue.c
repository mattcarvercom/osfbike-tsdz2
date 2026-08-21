/* Browser "host" for the 860C/850C display's real, unmodified UI logic
 * (Color_LCD_860C/firmware/common/src/{buttons,configscreen,eeprom,fonts,
 * mainscreen,screen,state,ugui,utils}.c - the same files also shared with
 * the SW102 build; fault.c is excluded, see build.sh's comment on it).
 * Nothing about how the display talks to the motor controller is touched;
 * this only swaps the real STM32/SPI/GPIO hardware for a fake one so the
 * UI can run and be watched/clicked in a browser tab.
 *
 * ugui.c's drawing primitives are all built on one pixel-set callback
 * (UG_Init's `pset` argument, confirmed by grep - fill/line/circle/font
 * rendering all route through `gui->pset`), so registering software pset
 * here (see sim_pset below) is enough - no need to reimplement ugui.c's
 * optional HW_FillFrame/HW_DrawLine/HW_FillArea acceleration hooks; ugui.c
 * already has a pset-based software fallback for all of them.
 *
 * Everything below this point is either:
 *  - a real telemetry/config field poked directly (sim_set_* functions,
 *    driven by the sim UI's sliders - there is no real motor to talk to,
 *    so this is a stand-in for what UART parsing would otherwise fill in),
 *  - or a tiny stub for a hardware entry point the portable UI code calls
 *    but a browser has no equivalent for (EEPROM flash, RTC, ADC, UART).
 *    flash_read_words() always reporting "blank" is deliberate: it makes
 *    eeprom_init() fall through to the firmware's own real
 *    m_eeprom_data_defaults table every run, which is a real, fully
 *    populated, always-sane config (wheel size, assist levels, etc.) -
 *    exactly what a sim needs and just as good as bespoke sim defaults.
 */
#include <emscripten.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>

#include "buttons.h"
#include "dashboard_theme.h"
#include "eeprom.h"
#include "eeprom_hw.h"
#include "lcd.h"
#include "lvgl.h"
#include "mainscreen.h"
#include "rtc.h"
#include "screen.h"
#include "state.h"
#include "timer.h"
#include "ugui_config.h"
#include "uart.h"
#include "adc.h"

/* state.c's own SOC percent, computed from battery voltage normally -
 * poked directly here so the sim's battery slider has immediate, exact
 * effect instead of needing a fake voltage curve. Not declared extern in
 * any header (it's a plain file-scope global in state.c, not part of
 * ui_vars_t), so it's redeclared here rather than editing the submodule. */
extern uint8_t ui8_g_battery_soc;

/* ---- Framebuffer + LVGL pixel driver ---------------------------------- */

/* LVGL renders into this same RGB565 framebuffer µGUI's sim_pset() used to
 * write; the RGBA conversion below is unchanged. */
static uint16_t framebuffer[SCREEN_WIDTH * SCREEN_HEIGHT];
static uint8_t rgba_buffer[SCREEN_WIDTH * SCREEN_HEIGHT * 4];

static lv_color_t sim_lv_buf[SCREEN_WIDTH * 20];
static lv_disp_draw_buf_t sim_lv_draw_buf;
static lv_disp_drv_t sim_lv_disp_drv;

static void sim_lv_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_p) {
  for (int y = area->y1; y <= area->y2; y++) {
    for (int x = area->x1; x <= area->x2; x++) {
      framebuffer[(unsigned)y * SCREEN_WIDTH + (unsigned)x] = (uint16_t)color_p->full;
      color_p++;
    }
  }
  lv_disp_flush_ready(drv);
}

/* Converts the RGB565 framebuffer to RGBA8888 (5/6/5 -> 8/8/8 bit
 * replication, not a scaled multiply, matching how real color LCDs do the
 * expansion) for canvas ImageData - only computed on demand, not per pset
 * call. */
EMSCRIPTEN_KEEPALIVE
uint8_t *sim_render_rgba(void) {
  for (unsigned i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    uint16_t c = framebuffer[i];
    uint8_t r5 = (c >> 11) & 0x1F;
    uint8_t g6 = (c >> 5) & 0x3F;
    uint8_t b5 = c & 0x1F;
    rgba_buffer[i * 4 + 0] = (uint8_t)((r5 << 3) | (r5 >> 2));
    rgba_buffer[i * 4 + 1] = (uint8_t)((g6 << 2) | (g6 >> 4));
    rgba_buffer[i * 4 + 2] = (uint8_t)((b5 << 3) | (b5 >> 2));
    rgba_buffer[i * 4 + 3] = 255;
  }
  return rgba_buffer;
}

EMSCRIPTEN_KEEPALIVE
int sim_get_width(void) { return SCREEN_WIDTH; }
EMSCRIPTEN_KEEPALIVE
int sim_get_height(void) { return SCREEN_HEIGHT; }

/* ---- Buttons: real debounce/click logic (buttons.c), fake raw state -- */

/* Indices match pins.h's BUTTON_*__PORT tags (1..4) minus one. */
static int sim_button_pressed[4] = {0, 0, 0, 0};

uint32_t GPIO_ReadInputDataBit(void *port, uint16_t pin) {
  (void)pin;
  int id = (int)(intptr_t)port - 1;
  if (id < 0 || id > 3) return 1;
  /* Active-low, same convention buttons.c already assumes for real
   * hardware: pressed -> 0, idle -> nonzero. */
  return sim_button_pressed[id] ? 0 : 1;
}

/* id: 0=up, 1=down, 2=onoff, 3=m */
EMSCRIPTEN_KEEPALIVE
void sim_set_button(int id, int pressed) {
  if (id < 0 || id > 3) return;
  sim_button_pressed[id] = pressed ? 1 : 0;
}

/* ---- EEPROM: no real flash, always reports blank (see file header) --- */

void eeprom_hw_init(void) {}
uint32_t eeprom_write(uint32_t address, uint8_t data) {
  (void)address;
  (void)data;
  return 0;
}
bool flash_write_words(const void *value, uint16_t length_words) {
  (void)value;
  (void)length_words;
  return true;
}
bool flash_read_words(void *dest, uint16_t length_words) {
  (void)dest;
  (void)length_words;
  return false;
}

/* ---- RTC: mirrors 860C_850C/src/rtc.c's real semantics ---------------
 *
 * The real file's two accessors read two genuinely different counters:
 * rtc_get_time() reads the RTC peripheral's own counter (only changed by
 * rtc_set_time()), while rtc_get_time_since_startup() reads a separate
 * seconds-since-boot counter the real RTC_IRQHandler increments once a
 * real second. No real RTC interrupt exists here, so
 * ui32_seconds_since_startup is instead derived every tick (advance_tick(),
 * below) from the same sim_ms_counter that already drives everything else -
 * same real formulas (hours/minutes.c's own divide-by-3600/60), just fed a
 * counter this sim actually has. */

uint32_t ui32_seconds_since_startup = 0;
uint32_t ui32_seconds_at_startup = 0;
static uint32_t sim_rtc_counter_seconds = 12 * 3600; /* boots showing 12:00, same as before */

void rtc_init(void) {}
void rtc_set_time(rtc_time_t *t) {
  if (t) sim_rtc_counter_seconds = ((uint32_t)t->ui8_hours) * 3600 + ((uint32_t)t->ui8_minutes) * 60;
}
rtc_time_t *rtc_get_time(void) {
  static rtc_time_t rtc_time;
  uint32_t s = sim_rtc_counter_seconds % 86400;
  rtc_time.ui8_hours = (uint8_t)(s / 3600);
  rtc_time.ui8_minutes = (uint8_t)((s % 3600) / 60);
  return &rtc_time;
}
rtc_time_t *rtc_get_time_since_startup(void) {
  static rtc_time_t rtc_time;
  uint32_t s = ui32_seconds_since_startup % 86400;
  rtc_time.ui8_hours = (uint8_t)(s / 3600);
  rtc_time.ui8_minutes = (uint8_t)((s % 3600) / 60);
  return &rtc_time;
}
uint32_t RTC_GetCounter(void) { return sim_rtc_counter_seconds; }

/* Driven from the sim page with the browser's real wall-clock time, so the
 * top-right clock reads like an actual display instead of a fixed 12:00.
 * Reuses the real rtc_set_time() - nothing sim-specific about the clock
 * field itself, only about where the time value comes from. Doesn't touch
 * "up time" (rtc_get_time_since_startup()) - that's a different counter,
 * see this section's header comment. */
EMSCRIPTEN_KEEPALIVE
void sim_set_wall_clock(uint8_t hour, uint8_t minute) {
  rtc_time_t t = {hour, minute};
  rtc_set_time(&t);
}

/* ---- Timer: JS drives the tick, not a real SysTick interrupt --------- */

static uint32_t sim_ms_counter = 0;
uint32_t get_time_base_counter_1ms(void) { return sim_ms_counter; }
void delay_ms(uint32_t ms) { (void)ms; }

/* ---- ADC / UART: no real sensors or motor link ----------------------- */

void battery_voltage_init(void) {}
uint16_t adc_light_sensor_get(void) { return 0; }

/* ---- LCD: only 2 symbols from lcd.h are actually referenced ---------- */

lcd_IC_t g_lcd_ic_type = LCD_ST7796; /* matches the real 860C_V13's panel */
void lcd_set_backlight_intensity(uint8_t intensity) { (void)intensity; }
/* Real impl (860C_850C/src/lcd.c) powers down the physical board; state.c
 * calls it on a low-battery/shutdown path. No hardware to power off here. */
void lcd_power_off(uint8_t update_distance_odo) { (void)update_distance_odo; }

/* ---- Misc no-ops declared via the main.h shim ------------------------ */

void Display850C_rt_processing_stop(void) {}
void Display850C_rt_processing_start(void) {}

void uart_init(void) {}
static uint8_t sim_uart_tx_buffer[UART_NUMBER_DATA_BYTES_TO_SEND];
/* NULL = "no new packet ready" - the same sentinel the real UART ISR uses
 * to tell state.c there's nothing to parse this cycle. Harmless either
 * way for the sim_set_* functions below: they target rt_vars, the same
 * struct a real UART parse would write into, not ui_vars directly - see
 * the comment above them for why. */
const uint8_t *uart_get_rx_buffer_rdy(void) { return 0; }
uint8_t *uart_get_tx_buffer(void) { return sim_uart_tx_buffer; }
void uart_send_tx_buffer(uint8_t *tx_buffer, uint8_t len) {
  (void)tx_buffer;
  (void)len;
}

/* ---- Fake telemetry, driven by the sim page's sliders ---------------- */

/* Target rt_vars, not ui_vars: state.c's copy_rt_to_ui_vars() (called every
 * 100ms from mainscreen.c's screen_clock(), unconditionally, regardless of
 * whether a real UART packet ever arrives) overwrites most of the same
 * ui_vars fields from rt_vars every cycle - rt_vars is what a real UART
 * parse would populate, so it's the actual source of truth to drive here,
 * confirmed field-by-field against copy_rt_to_ui_vars()'s own body.
 * ui8_assist_level and ui8_g_battery_soc are the exceptions - neither is
 * touched by that copy, so they're set directly. */

EMSCRIPTEN_KEEPALIVE
void sim_set_battery_soc(uint8_t percent) { ui8_g_battery_soc = percent > 100 ? 100 : percent; }
EMSCRIPTEN_KEEPALIVE
void sim_set_wheel_speed_x10(uint16_t speed_x10) { rt_vars.ui16_wheel_speed_x10 = speed_x10; }
EMSCRIPTEN_KEEPALIVE
void sim_set_cadence(uint8_t rpm) {
  rt_vars.ui8_pedal_cadence = rpm;
  rt_vars.ui8_pedal_cadence_filtered = rpm; /* cadenceField reads the _filtered copy */
}
EMSCRIPTEN_KEEPALIVE
void sim_set_assist_level(uint8_t level) { ui_vars.ui8_assist_level = level; }
EMSCRIPTEN_KEEPALIVE
void sim_set_battery_power(uint16_t watts) { rt_vars.ui16_battery_power_filtered = watts; }
EMSCRIPTEN_KEEPALIVE
void sim_set_motor_temperature(uint8_t celsius) { rt_vars.ui8_motor_temperature = celsius; }
EMSCRIPTEN_KEEPALIVE
void sim_set_human_power(uint16_t watts) { rt_vars.ui16_pedal_power_filtered = watts; }
EMSCRIPTEN_KEEPALIVE
void sim_set_battery_voltage_x10(uint16_t volts_x10) {
  rt_vars.ui16_battery_voltage_filtered_x10 = volts_x10;
  rt_vars.ui16_battery_voltage_soc_x10 = volts_x10;
}
/* ui8_lights is display-owned, not motor-reported telemetry: the real
 * display sets it (button press or the light-sensor auto path,
 * mainscreen.c) and sends it *to* the motor over UART tx
 * (state.c's ui8_usart1_tx_buffer packing) - copy_rt_to_ui_vars() never
 * copies it back from rt_vars, so writing ui_vars directly here is safe
 * and won't get clobbered next tick (unlike the rt_vars-targeted setters
 * above, which exist for exactly that reason - see this file's header
 * comment). */
EMSCRIPTEN_KEEPALIVE
void sim_set_lights(uint8_t on) { ui_vars.ui8_lights = on ? 1 : 0; }
/* Readback for the above: the real firmware can also flip ui8_lights on its
 * own (a long UP press - anyscreen_onpress(), mainscreen.c - toggles it
 * directly, reachable from the sim's own UP button), which the JS side has
 * no other way to learn about since applyTelemetry() only ever pushes
 * JS->WASM. Polled once per tick (display-sim-page.ts) to keep the "Lights"
 * checkbox in sync with what the firmware is actually doing instead of only
 * reflecting the checkbox's own last click. */
EMSCRIPTEN_KEEPALIVE
uint8_t sim_get_lights(void) { return ui_vars.ui8_lights; }
/* ui8_units_type is a real EEPROM-backed config value (eeprom.c), not
 * motor telemetry, so it's untouched by copy_rt_to_ui_vars() same as
 * ui8_lights above - safe to set directly. set_conversions() (mainscreen.h)
 * is the same real function configscreen.c calls after an in-menu units
 * change; it derives screenConvertMiles (and the pounds/Wh-per-mile/
 * Fahrenheit flags) from ui_vars.ui8_units_type right away, so this takes
 * effect immediately rather than only on next boot. */
EMSCRIPTEN_KEEPALIVE
void sim_set_units_imperial(uint8_t imperial) {
  ui_vars.ui8_units_type = imperial ? 1 : 0;
  set_conversions();
}
/* Readback for the same reason sim_get_lights() exists: the real on-device
 * config menu (Display -> Units) writes ui_vars.ui8_units_type directly
 * too, so a rider changing it from inside the sim (not just the JS-side
 * toggle) needs a way to report that back - polled once per tick, same as
 * lights. */
EMSCRIPTEN_KEEPALIVE
uint8_t sim_get_units_imperial(void) { return ui_vars.ui8_units_type; }
/* ui8_error_states is real motor-reported telemetry (state.c parses it from
 * received UART bytes, copy_rt_to_ui_vars() copies rt_vars -> ui_vars every
 * 100ms) - a bitmask of active fault codes, one bit per distinct fault
 * (mainscreen.c's renderWarning(): bit 0=motor not init, 1=torque sensor,
 * 2=cadence sensor, 3=motor blocked, 4=throttle, 5=fatal/undervoltage,
 * 6=battery overcurrent, 7=speed sensor - see mainscreen.h's ERROR_*
 * defines). Takes the raw bitmask directly rather than a bool, so the sim
 * page can trigger any one specific fault, not just "some fault is
 * active" - 0 clears it. */
EMSCRIPTEN_KEEPALIVE
void sim_set_error(uint8_t error_bits) { rt_vars.ui8_error_states = error_bits; }

/* ---- Entry points ------------------------------------------------------ */

/* state.c's rt_first_time_management()/rt_graph_process() are real firmware
 * logic that's supposed to run every 100ms from a timer ISR
 * (860C_850C/src/timers.c's rt_processing(), "called from ISR context every
 * 100ms") - but timers.c isn't part of this sim build (it's a real hardware
 * timer peripheral setup, see build.sh), so nothing was ever calling them.
 * Not declared in any header (only rt_processing(), which wraps a bunch of
 * other real-motor-only calcs this sim has no business running, is) - redeclared
 * here rather than editing the submodule, same as ui8_g_battery_soc above. */
extern uint8_t rt_first_time_management(void);

static int sim_rt_process_counter = 0;

/* One real firmware tick: main_idle() (the 20ms UI loop) plus, every 5th
 * call, the two rt_processing() pieces this sim actually needs at their
 * real 100ms cadence. rt_first_time_management() is what flips
 * ui8_g_motorVariablesStabilized (mainscreen.c's wheel_speed() hides speed
 * until then - a real safety feature) and, the same real moment, sets
 * activeGraphs (mainscreen.c's graphs only accumulate data once that's
 * non-NULL) - both after a real 5-simulated-second delay, not faked.
 * rt_graph_process() is what actually pushes accumulated samples into the
 * graph's ring buffer every 3.644s (screen.h's GRAPH_DATA_0_INTERVAL_MS). */
static void advance_tick(void) {
  sim_ms_counter += 20;
  ui32_seconds_since_startup = sim_ms_counter / 1000;
  main_idle();
  if (++sim_rt_process_counter >= 5) {
    sim_rt_process_counter = 0;
    rt_first_time_management();
    rt_graph_process();
    /* Real firmware derives this from a 100ms UART ISR
     * (rt_processing()->communications()->rt_send_tx_package()) the sim
     * never simulates - see rt_update_walk_cruise_state()'s own doc
     * comment (state.h/state.c) for why this direct call is needed for
     * walk assist to ever show as active in the sim. */
    rt_update_walk_cruise_state();
  }
}

EMSCRIPTEN_KEEPALIVE
void sim_init(void) {
  lv_init();
  lv_disp_draw_buf_init(&sim_lv_draw_buf, sim_lv_buf, NULL, SCREEN_WIDTH * 20);
  lv_disp_drv_init(&sim_lv_disp_drv);
  sim_lv_disp_drv.hor_res = SCREEN_WIDTH;
  sim_lv_disp_drv.ver_res = SCREEN_HEIGHT;
  sim_lv_disp_drv.flush_cb = sim_lv_flush_cb;
  sim_lv_disp_drv.draw_buf = &sim_lv_draw_buf;
  lv_disp_drv_register(&sim_lv_disp_drv);

  /* Real main.c calls eeprom_init() before screen_init()/lcd_init() - skip
   * it and config-derived values (wheel circumference, unit conversions,
   * ...) stay zeroed, which main_idle()'s real processing divides by. */
  eeprom_init();
  /* No real motor to hold a real UART handshake with, so
   * rt_first_time_management()'s stabilization check (state.c) would
   * otherwise stall forever in MOTOR_INIT_GET_MOTOR_ALIVE waiting for a
   * response that never arrives. MOTOR_INIT_SIMULATING is a real state
   * already built into the firmware for exactly this - state.c's own
   * comment on it: "If we are simulating received packets never send real
   * packets" - so this is the sanctioned way to say "there's no real motor
   * here", not a sim-only hack. */
  g_motor_init_state = MOTOR_INIT_SIMULATING;

  /* No real motor to answer a FIRMWARE_VERSION request, so seed the live
   * version fields with the motor firmware this display build targets (0/21/52,
   * matching Makefile.common's TSDZ2_FIRMWARE_*). The Technical menu's "Motor
   * firmware" read-only field reads these directly. */
  g_tsdz2_firmware_version.major = 0;
  g_tsdz2_firmware_version.minor = 21;
  g_tsdz2_firmware_version.patch = 52;

  /* Sim-only - real firmware's main.c never sets this, so it stays false
   * there. Must be set before dashboard_theme_init() (below), which builds
   * the first screen. See theme_osf_modern.c's doc comment on
   * g_graph_screen_demo_mode for what it changes and why. */
  g_graph_screen_demo_mode = true;

  /* Build the main screen through the theme registry, keyed by the
   * EEPROM-persisted ui8_active_theme_index. Same shared logic the real
   * firmware's main.c uses (common/src/dashboard_theme.c) - not
   * duplicated screen-switching logic between the two. */
  dashboard_theme_init();

  /* Warm up ~90 simulated seconds, through the exact same real tick path
   * sim_tick() itself uses, driving a gentle sine-wave "test ride" so the
   * page doesn't open to a blank speed graph. Two real firmware behaviors
   * make this necessary, not just nice-to-have: (1) telemetry is hidden
   * for the first real 5 simulated seconds until
   * rt_first_time_management()'s stabilization delay passes (see
   * advance_tick()'s comment) - motor_efficiency()'s unguarded division by
   * (battery_power + pedal_power), called unconditionally every 100ms from
   * screen_clock(), is also why the values below start nonzero rather than
   * at 0; (2) even once stabilized, the graph only gains one new point
   * every real 3.644s (GRAPH_DATA_0_INTERVAL_MS), so a fresh boot would
   * otherwise show a genuinely empty axis until the user had been idling
   * on the page a while. applyTelemetry() (called by the page right after
   * createDisplaySim() resolves) overwrites all of this with the page's
   * actual slider defaults immediately after, so it's purely a bootstrap -
   * nothing here has any lasting effect on the live sim. */
  for (int i = 0; i < 4500; i++) {
    double t = i * 0.02;
    rt_vars.ui16_wheel_speed_x10 = (uint16_t)(180 + 120 * sin(t * 0.15));
    rt_vars.ui8_pedal_cadence = rt_vars.ui8_pedal_cadence_filtered = (uint8_t)(60 + 20 * sin(t * 0.15));
    rt_vars.ui16_battery_power_filtered = (uint16_t)(150 + 100 * sin(t * 0.15));
    rt_vars.ui16_pedal_power_filtered = (uint16_t)(80 + 60 * sin(t * 0.15));
    rt_vars.ui16_battery_voltage_filtered_x10 = 420;
    rt_vars.ui16_battery_voltage_soc_x10 = 420;
    advance_tick();
  }
}

/* Called from JS on a fixed cadence, matching the real firmware's own
 * 20ms main_idle() loop period (main.c). */
EMSCRIPTEN_KEEPALIVE
void sim_tick(void) {
  advance_tick();
  lv_tick_inc(20);
  lv_timer_handler();
  dashboard_theme_tick();
}

/* LVGL display driver for the 860C/850C panel (ST7796/ILI9481, 16-bit
 * parallel interface). Reuses the panel bring-up and bus primitives from
 * ugui_driver/ugui_display_8x0c.c rather than reimplementing them.
 *
 * Partial-buffer mode: LVGL renders into a DISPLAY_WIDTH * 20 line buffer
 * and this flush callback pushes it to the panel's GRAM via its address-
 * window command sequence (0x2a/0x2b/0x2c). There is no MCU-side full
 * framebuffer (320*480*2 = 300KB, far beyond the 64KB RAM), so partial
 * buffer to GRAM is the intended LVGL pattern here, not a workaround.
 */
#include "lvgl.h"
#include "ugui_driver/ugui_display_8x0c.h"

static lv_color_t lv_disp_buf[DISPLAY_WIDTH * 20];
static lv_disp_draw_buf_t lv_disp_draw_buf;
static lv_disp_drv_t lv_disp_drv;

static void lv_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_p) {
  /* Same three-command address-window sequence HW_FillArea() uses
   * (0x2a coladdr / 0x2b pageaddr / 0x2c write-pixels) - factored into
   * lcd_window_set(), reused verbatim. */
  lcd_window_set(area->x1, area->x2, area->y1, area->y2);

  /* color_p is row-major, area->x1..x2 by area->y1..y2. lcd_write_data_8bits
   * takes the full 16-bit RGB565 and pulses WR once per pixel (despite the
   * name - see its body in ugui_display_8x0c.c). */
  uint32_t pixels = (uint32_t)(area->x2 - area->x1 + 1) * (uint32_t)(area->y2 - area->y1 + 1);
  for (uint32_t i = 0; i < pixels; i++) {
    lcd_write_data_8bits(color_p[i].full);
  }

  lv_disp_flush_ready(drv);
}

void lv_port_disp_init(void) {
  lv_init();

  lv_disp_draw_buf_init(&lv_disp_draw_buf, lv_disp_buf, NULL, DISPLAY_WIDTH * 20);

  lv_disp_drv_init(&lv_disp_drv);
  lv_disp_drv.hor_res = DISPLAY_WIDTH;
  lv_disp_drv.ver_res = DISPLAY_HEIGHT;
  lv_disp_drv.flush_cb = lv_flush_cb;
  lv_disp_drv.draw_buf = &lv_disp_draw_buf;
  lv_disp_drv_register(&lv_disp_drv);
}

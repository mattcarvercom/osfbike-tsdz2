/* LVGL input device for the 860C/850C button pad. Maps the firmware's
 * button click events (buttons.c's debounce/click state machine) onto LVGL
 * keypad navigation keys and feeds them into an LVGL input group.
 *
 * ONOFF_LONG_CLICK deliberately stays outside LVGL: it's the existing
 * hardware power-off trigger (lcd.c's power_off_management()), not a
 * navigation key. Long-press fast-scroll on editable fields is deferred
 * until the real config screen is built on top of LVGL.
 */
#include "lvgl.h"
#include "buttons.h"

static void lv_indev_read_cb(lv_indev_drv_t *drv, lv_indev_data_t *data) {
  (void)drv;

  buttons_events_t events = buttons_get_events();
  if (events & UP_CLICK) {
    data->key = LV_KEY_PREV;
    data->state = LV_INDEV_STATE_PRESSED;
  } else if (events & DOWN_CLICK) {
    data->key = LV_KEY_NEXT;
    data->state = LV_INDEV_STATE_PRESSED;
  } else if (events & M_CLICK) {
    data->key = LV_KEY_ENTER;
    data->state = LV_INDEV_STATE_PRESSED;
  } else if (events & ONOFF_CLICK) {
    data->key = LV_KEY_ESC;
    data->state = LV_INDEV_STATE_PRESSED;
  } else {
    data->state = LV_INDEV_STATE_RELEASED;
  }
  data->continue_reading = false;
}

void lv_port_indev_init(void) {
  static lv_indev_drv_t indev_drv;
  lv_indev_drv_init(&indev_drv);
  indev_drv.type = LV_INDEV_TYPE_KEYPAD;
  indev_drv.read_cb = lv_indev_read_cb;
  lv_indev_t *indev = lv_indev_drv_register(&indev_drv);

  /* Default input group; screen widgets are added to it as they're built
   * (later screen-building work, not part of the porting layer). */
  lv_group_t *group = lv_group_create();
  lv_indev_set_group(indev, group);
}

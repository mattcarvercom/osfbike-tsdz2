/*
 * Bafang / Aptdevelop 850C color display  firmware
 *
 * Copyright (C) Casainho, 2018.
 *
 * Released under the GPL License, Version 3
 */

#include "stdio.h"

#include "buttons.h"
#include "state.h"
#include "timer.h"

/* TIME_1..TIME_4 are real milliseconds, measured against
 * get_time_base_counter_1ms() (timer.h - the same SysTick-driven counter
 * mainscreen.c's screen_clock()/trip timer already use, hence why those
 * stayed accurate throughout the tick-counting bug below).
 *
 * Previously these compared against MS_TO_TICKS(TIME_N), a count of calls
 * to buttons_clock() (via main_idle(), assumed to run every 20ms per the
 * old BUTTONS_CLOCK_MS). That assumption held for the original µGUI-based
 * screen.c, but the OSF Modern LVGL theme's per-tick rendering
 * (dashboard_theme_tick(), called right after main_idle() in the same
 * main.c loop iteration) is heavy enough on real 860C hardware to push the
 * loop's real cadence well past 20ms - confirmed by 3 independent
 * real-hardware measurements landing on the same ~4-6x inflation, not just
 * this button timing: TIME_1=1500 felt like ~6s, TIME_1=500 felt like ~3s,
 * and theme_osf_modern.c's own GRAPH_POINT_MS/MINI_GRAPH_POINT_MS (same
 * tick-counting pattern) filled at roughly the same fraction of their coded
 * rate. Fixed at the root on 2026-08-23 by switching every one of these
 * (buttons.c here, plus the graph point timers) to real elapsed-ms
 * comparisons instead of tick counts - TIME_1..TIME_4 below are now the
 * actual real-world durations a rider will feel, not inflated ones.
 * Coded-vs-felt guesswork (1500->500->150->500 for TIME_1 alone) is no
 * longer needed now that this measures real time directly. */
#define TIME_1 500
#define TIME_2 200
#define TIME_3 300
#define TIME_4 1500

static uint32_t ui32_onoff_button_state = 0;
static uint32_t ui32_onoff_button_state_start_ms = 0;
static uint32_t ui32_down_button_state = 0;
static uint32_t ui32_down_button_state_start_ms = 0;
static uint32_t ui32_up_button_state = 0;
static uint32_t ui32_up_button_state_start_ms = 0;
static uint32_t ui32_m_button_state = 0;
static uint32_t ui32_m_button_state_start_ms = 0;
static uint32_t ui32_m_clear_event = 0;
buttons_events_t buttons_events = 0;

#if defined(DISPLAY_850C) || defined(DISPLAY_850C_2021) || defined(DISPLAY_860C) || defined(DISPLAY_860C_V12) || defined(DISPLAY_860C_V13)
#include "stm32f10x.h"
#include "stm32f10x_gpio.h"
#include "pins.h"

uint32_t buttons_get_up_state(void) {
	if (ui_vars.ui8_buttons_up_down_invert) {
		return GPIO_ReadInputDataBit(BUTTON_DOWN__PORT, BUTTON_DOWN__PIN) != 0 ?
				0 : 1;
	} else {
		return GPIO_ReadInputDataBit(BUTTON_UP__PORT, BUTTON_UP__PIN) != 0 ?
				0 : 1;
	}
}

uint32_t buttons_get_down_state(void) {
	if (ui_vars.ui8_buttons_up_down_invert) {
		return GPIO_ReadInputDataBit(BUTTON_UP__PORT, BUTTON_UP__PIN) != 0 ?
				0 : 1;
	} else {
		return GPIO_ReadInputDataBit(BUTTON_DOWN__PORT, BUTTON_DOWN__PIN) != 0 ?
				0 : 1;
	}
}

uint32_t buttons_get_onoff_state(void) {
	return GPIO_ReadInputDataBit(BUTTON_ONOFF__PORT, BUTTON_ONOFF__PIN) != 0 ?
			0 : 1;
}

uint32_t buttons_get_m_state(void) {
#if defined(DISPLAY_850C) || defined(DISPLAY_850C_2021)
	return 0; // no M button on 850C
#elif defined(DISPLAY_860C) || defined(DISPLAY_860C_V12) || defined(DISPLAY_860C_V13)
  return GPIO_ReadInputDataBit(BUTTON_M__PORT, BUTTON_M__PIN) != 0 ?
      0 : 1;
#endif
}
#else
#include "main.h"

uint32_t buttons_get_up_state (void)
{
  if(!ui_vars.ui8_buttons_up_down_invert)
  {
    return PollButton(&buttonUP);
  }
  else
  {
    return PollButton(&buttonDWN);
  }
}

uint32_t buttons_get_down_state (void)
{
  if(ui_vars.ui8_buttons_up_down_invert)
  {
    return PollButton(&buttonUP);
  }
  else
  {
    return PollButton(&buttonDWN);
  }
}

uint32_t buttons_get_onoff_state (void)
{
  return PollButton(&buttonPWR);
}

uint32_t buttons_get_m_state (void)
{
  return PollButton(&buttonM);
}
#endif

uint32_t buttons_get_m_click_event(void) {
	return (buttons_events & M_CLICK) ? 1 : 0;
}

uint32_t buttons_get_m_long_click_event(void) {
	return (buttons_events & M_LONG_CLICK) ? 1 : 0;
}

void buttons_clear_m_click_event(void) {
	buttons_events &= ~M_CLICK;
}

void buttons_clear_m_long_click_event(void) {
	buttons_events &= ~M_LONG_CLICK;
}

uint32_t buttons_get_up_click_event(void) {
	return (buttons_events & UP_CLICK) ? 1 : 0;
}

uint32_t buttons_get_up_long_click_event(void) {
	return (buttons_events & UP_LONG_CLICK) ? 1 : 0;
}

void buttons_clear_up_click_event(void) {
	buttons_events &= ~UP_CLICK;
}

void buttons_clear_up_long_click_event(void) {
	buttons_events &= ~UP_LONG_CLICK;
}

uint32_t buttons_get_down_click_event(void) {
	return (buttons_events & DOWN_CLICK) ? 1 : 0;
}

uint32_t buttons_get_down_long_click_event(void) {
	return (buttons_events & DOWN_LONG_CLICK) ? 1 : 0;
}

void buttons_clear_down_click_event(void) {
	buttons_events &= ~DOWN_CLICK;
}

void buttons_clear_down_long_click_event(void) {
	buttons_events &= ~DOWN_LONG_CLICK;
}

uint32_t buttons_get_onoff_click_event(void) {
	return (buttons_events & ONOFF_CLICK) ? 1 : 0;
}

uint32_t buttons_get_onoff_long_click_event(void) {
	return (buttons_events & ONOFF_LONG_CLICK) ? 1 : 0;
}

uint32_t buttons_get_onoff_click_long_click_event(void) {
	return (buttons_events & ONOFF_CLICK_LONG_CLICK) ? 1 : 0;
}

void buttons_clear_onoff_click_event(void) {
	buttons_events &= ~ONOFF_CLICK;
}

void buttons_clear_onoff_click_long_click_event(void) {
	buttons_events &= ~ONOFF_CLICK_LONG_CLICK;
}

void buttons_clear_onoff_long_click_event(void) {
	buttons_events &= ~ONOFF_LONG_CLICK;
}

uint32_t buttons_get_up_down_click_event(void) {
	return (buttons_events & UPDOWN_LONG_CLICK) ? 1 : 0;
}

void buttons_clear_up_down_click_event(void) {
	buttons_events &= ~UPDOWN_LONG_CLICK;
}

buttons_events_t buttons_get_events(void) {
	return buttons_events;
}

void buttons_set_events(buttons_events_t events) {
	buttons_events |= events;
}

void buttons_clear_all_events(void) {
	ui32_m_clear_event = 1;
	buttons_events = 0;
	ui32_onoff_button_state = 0;
	ui32_up_button_state = 0;
	ui32_down_button_state = 0;
	ui32_m_button_state = 0;
}

void buttons_clock(void) {
	// exit if any button is pressed after clear event
	if ((ui32_m_clear_event)
			&& (buttons_get_up_state() || buttons_get_down_state() || buttons_get_m_state()
					|| buttons_get_onoff_state())) {
		return;
	} else {
		ui32_m_clear_event = 0;
	}

	switch (ui32_onoff_button_state) {
	case 0:
		if (buttons_get_onoff_state()) {
			ui32_onoff_button_state_start_ms = get_time_base_counter_1ms();
			ui32_onoff_button_state = 1;
		}
		break;

	case 1:
		// event long click
		if ((get_time_base_counter_1ms() - ui32_onoff_button_state_start_ms) > TIME_1) {
			buttons_set_events(ONOFF_LONG_CLICK);
			ui32_onoff_button_state = 2;
			break;
		}

		// if button release
		if (!buttons_get_onoff_state()) {
			// let's validade if will be a quick click + long click
			if ((get_time_base_counter_1ms() - ui32_onoff_button_state_start_ms) <= TIME_2) {
				ui32_onoff_button_state_start_ms = get_time_base_counter_1ms();
				ui32_onoff_button_state = 3;
				break;
			}
			// event click
			else {
				buttons_set_events(ONOFF_CLICK);
				ui32_onoff_button_state = 0;
				break;
			}
		}
		break;

	case 2:
		// wait for button release
		if (!buttons_get_onoff_state()) {
			ui32_onoff_button_state = 0;
			break;
		}
		break;

	case 3:
		// on next step, start counting for long click
		if (buttons_get_onoff_state()) {
			ui32_onoff_button_state_start_ms = get_time_base_counter_1ms();
			ui32_onoff_button_state = 4;
			break;
		}

		// event click
		if ((get_time_base_counter_1ms() - ui32_onoff_button_state_start_ms) > TIME_3) {
			buttons_set_events(ONOFF_CLICK);
			ui32_onoff_button_state = 0;
			break;
		}
		break;

	case 4:
		// event click, but this time it is: click + long click
		if ((get_time_base_counter_1ms() - ui32_onoff_button_state_start_ms) > TIME_4) {
			buttons_set_events(ONOFF_CLICK_LONG_CLICK);
			ui32_onoff_button_state = 2;
			break;
		}

		// button release
		if (!buttons_get_onoff_state()) {
			buttons_set_events(ONOFF_CLICK);
			ui32_onoff_button_state = 0;
			break;
		}
		break;

	default:
		ui32_onoff_button_state = 0;
		break;
	}




  switch (ui32_m_button_state) {
  case 0:
    if (buttons_get_m_state()) {
      ui32_m_button_state_start_ms = get_time_base_counter_1ms();
      ui32_m_button_state = 1;
    }
    break;

  case 1:
    // event long click
    if ((get_time_base_counter_1ms() - ui32_m_button_state_start_ms) > TIME_1) {
      buttons_set_events(M_LONG_CLICK);
      ui32_m_button_state = 2;
      break;
    }

    // if button release
    if (!buttons_get_m_state()) {
      buttons_set_events(M_CLICK);
      ui32_m_button_state = 0;
      break;
    }
    break;

    case 2:
      // wait for button release
      if (!buttons_get_m_state()) {
        ui32_m_button_state = 0;
      }
      break;

  default:
    ui32_m_button_state = 0;
    break;
  }




	switch (ui32_up_button_state) {
    case 0:
      if (buttons_get_up_state()) {
        ui32_up_button_state_start_ms = get_time_base_counter_1ms();
        ui32_up_button_state = 1;
      }
      break;

    case 1:
      // event long click
      if ((get_time_base_counter_1ms() - ui32_up_button_state_start_ms) > TIME_1) {
        if (buttons_get_onoff_state() &&
            buttons_get_down_state()) {
          // reset all events and machine state of others
          buttons_clear_all_events();
          ui32_down_button_state = 0;
          ui32_onoff_button_state = 0;
          ui32_m_button_state = 0;
          buttons_set_events(ONOFFUPDOWN_LONG_CLICK);
        } else if (buttons_get_onoff_state()) {
          buttons_set_events(ONOFFUP_LONG_CLICK);
        } else if (buttons_get_down_state()) {
          buttons_set_events(UPDOWN_LONG_CLICK);
        } else {
          buttons_set_events(UP_LONG_CLICK);
        }

        ui32_up_button_state = 2;
        break;
      }

      // if button release
      if (!buttons_get_up_state()) {
        buttons_set_events(UP_CLICK);
        ui32_up_button_state = 0;
        break;
      }
      break;

    case 2:
      // wait for button release
      if (!buttons_get_up_state()) {
        ui32_up_button_state = 0;
      }
      break;

    default:
      ui32_up_button_state = 0;
      break;
	}




  switch (ui32_down_button_state) {
    case 0:
      if (buttons_get_down_state()) {
        ui32_down_button_state_start_ms = get_time_base_counter_1ms();
        ui32_down_button_state = 1;
      }
      break;

    case 1:
      // event long click
      if ((get_time_base_counter_1ms() - ui32_down_button_state_start_ms) > TIME_1) {
        if (buttons_get_onoff_state() &&
            buttons_get_up_state()) {
          // reset all events and machine state of others
          buttons_clear_all_events();
          ui32_up_button_state = 0;
          ui32_onoff_button_state = 0;
          ui32_m_button_state = 0;
          buttons_set_events(ONOFFUPDOWN_LONG_CLICK);
        } else if (buttons_get_onoff_state()) {
          buttons_set_events(ONOFFDOWN_LONG_CLICK);
        } else if (buttons_get_up_state()) {
          buttons_set_events(UPDOWN_LONG_CLICK);
        } else {
          buttons_set_events(DOWN_LONG_CLICK);
        }

        ui32_down_button_state = 2;
        break;
      }

      // if button release
      if (!buttons_get_down_state()) {
        buttons_set_events(DOWN_CLICK);
        ui32_down_button_state = 0;
        break;
      }
      break;

    case 2:
      // wait for button release
      if (!buttons_get_down_state()) {
        ui32_down_button_state = 0;
      }
      break;

    default:
      ui32_down_button_state = 0;
      break;
  }
}

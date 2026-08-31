/*
 * Bafang LCD 860C/850C firmware
 *
 * Copyright (C) Casainho, 2018, 2019, 2020
 *
 * Released under the GPL License, Version 3
 */

#include "stm32f10x.h"
#include "stm32f10x_rcc.h"
#include "stm32f10x_gpio.h"
#include "system_stm32f10x.h"
#include "stdio.h"
#include "stdbool.h"

#include "main.h"
#include "pins.h"
#include "lcd.h"
#include "buttons.h"
#include "eeprom.h"
#include "timers.h"
#include "timer.h"
#include "usart1.h"
#include "eeprom.h"
#include "ugui.h"
#include "utils.h"
#include "rtc.h"
#include "stm32f10x_usart.h"
#include "mainscreen.h"
#include "configscreen.h"
#include "state.h"
#include "ugui_driver/ugui_display_8x0c.h"
#include "lv_port_indev.h"
#include "lvgl.h"
#include "dashboard_theme.h"

void SetSysClockTo128Mhz(void);
void adc_init();

int main(void)
{
  volatile uint32_t ui32_timer_base_counter_1ms;
  volatile uint32_t ui32_ms_loop_counter_1;

  SetSysClockTo128Mhz();
  RCC_APB1PeriphResetCmd(RCC_APB1Periph_WWDG, DISABLE);

  // if building for original bootloader (from manufacturer), relocate flash after 20K (0x5000) that is the space that bootloader uses
#ifdef USE_WITH_BOOTLOADER
  NVIC_SetVectorTable(NVIC_VectTab_FLASH, (uint32_t) 0x5000);
#endif

  pins_init();

  /* Boot-time ghost-click guard: the physical power button is very likely
   * still held down right now (it's what powered the display on), but
   * buttons_clock()'s onoff state machine has no way to tell "still
   * finishing the power-on hold" apart from "user just pressed it". If it
   * started timing from this stale press, a normal-length release shortly
   * after boot gets replayed as a genuine click ~TIME_2 (buttons.c) later -
   * landing on whatever appwide_onpress() maps a click to at that moment
   * (next screen, or the assist-mode-edit toggle when PAS is 0 - both seen
   * on real hardware, 2026-08-26). buttons_clear_all_events() makes
   * buttons_clock() itself no-op every tick until it observes *every*
   * button fully released (its own "exit if any button is pressed after
   * clear event" guard), so the state machine only ever starts counting
   * from a fresh, unambiguous press - not a leftover one-shot latch like
   * the old mainscreen.c handle_buttons() guard this replaces, which could
   * only clear an event that had already fired, not one still ~200ms out. */
  buttons_clear_all_events();

  adc_init();
  system_power(1);
  systick_init();
  usart1_init();
  eeprom_init();

  /* Trip memories -> "Auto reset trip on power-on" (configscreen.c's
   * tripMenus[], default off) - ui_vars/rt_vars are fully loaded from
   * EEPROM as of eeprom_init() above, so this is the earliest point trip
   * A/odometer values actually exist to reset. Arms TripMemoriesReset()'s
   * existing one-shot triggers (mainscreen.c, already called every main
   * loop iteration) rather than duplicating its reset logic here - the
   * odometer has no equivalent trigger, so it's zeroed directly. */
  if (ui_vars.ui8_auto_reset_trip_on_poweron) {
    ui8_g_configuration_trip_a_reset = 1;
#ifdef SW102
    ui8_g_configuration_trip_b_reset = 1;
#endif
    rt_vars.ui32_odometer_x10 = 0;
  }

  rtc_init();
  timer3_init(); // drives LCD backlight
  lcd_init();
  lv_port_indev_init();
  timer4_init();
  screen_init();

  screenShow(&bootScreen);

  // Build the main screen through the theme registry, keyed by the
  // EEPROM-persisted ui8_active_theme_index (eeprom_init() above already
  // loaded it into ui_vars). Mirrors wasm-display-sim/sim_glue.c's
  // sim_init() - without this, LVGL's driver/tick/input are all wired up
  // but nothing ever builds a screen, and --gc-sections drops every
  // theme's screen-builder code as unreachable.
  dashboard_theme_init();

  while(1)
  {
    // because of continue; at the end of each if code block that will stop the while (1) loop there,
    // the first if block code will have the higher priority over any others
    ui32_timer_base_counter_1ms = get_time_base_counter_1ms();
    if((ui32_timer_base_counter_1ms - ui32_ms_loop_counter_1) > 20) // every 20ms
    {
      ui32_ms_loop_counter_1 = ui32_timer_base_counter_1ms;

      // next 2 lines takes about 11ms to execute (main menu). Measured on 2019.03.04.
      main_idle();
      lv_timer_handler();
      dashboard_theme_tick();
      continue;
    }
  }
}

void SetSysClockTo128Mhz(void)
{
  ErrorStatus HSEStartUpStatus;

  /* SYSCLK, HCLK, PCLK2 and PCLK1 configuration -----------------------------*/
  /* RCC system reset(for debug purpose) */
  RCC_DeInit();

  /* Enable HSE */
  RCC_HSEConfig(RCC_HSE_ON);

  /* Wait till HSE is ready */
  HSEStartUpStatus = RCC_WaitForHSEStartUp();

  if (HSEStartUpStatus == SUCCESS)
  {
    /* Enable Prefetch Buffer */
    FLASH_PrefetchBufferCmd(FLASH_PrefetchBuffer_Enable);

    /* Flash 2 wait state */
    FLASH_SetLatency(FLASH_Latency_2);

    /* HCLK = SYSCLK */
    RCC_HCLKConfig(RCC_SYSCLK_Div1);

    /* PCLK2 = HCLK */
    RCC_PCLK2Config(RCC_HCLK_Div1);

    /* PCLK1 = HCLK/2 */
    RCC_PCLK1Config(RCC_HCLK_Div2);

    /* PLLCLK = 8MHz * 16 = 128 MHz */
    RCC_PLLConfig(RCC_PLLSource_HSE_Div1, RCC_PLLMul_16);

    /* Enable PLL */
    RCC_PLLCmd(ENABLE);

    /* Wait till PLL is ready */
    while (RCC_GetFlagStatus(RCC_FLAG_PLLRDY) == RESET)
    {
    }

    /* Select PLL as system clock source */
    RCC_SYSCLKConfig(RCC_SYSCLKSource_PLLCLK);

    /* Wait till PLL is used as system clock source */
    while(RCC_GetSYSCLKSource() != 0x08)
    {
    }
  }
  else
  { /* If HSE fails to start-up, the application will have wrong clock configuration.
       User can add here some code to deal with this error */

    /* Go to infinite loop */
    while (1)
    {
    }
  }
}

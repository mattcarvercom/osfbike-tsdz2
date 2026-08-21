/* Stand-in for the real STM32F10x SPL RTC header. Exactly one symbol from it
 * is actually used outside rtc.c (eeprom.c's RTC_GetCounter() call, to stamp
 * a shutdown time) - implemented for real in sim_glue.c. */
#pragma once
#include <stdint.h>

uint32_t RTC_GetCounter(void);

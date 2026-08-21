/* Stand-in for Color_LCD_860C/firmware/860C_850C/src/pins.h.
 *
 * The real pins.h maps each button to an actual STM32 GPIO port/pin. Since
 * this build never touches real hardware, each "port" is just a small
 * integer tag identifying which button it is - GPIO_ReadInputDataBit()
 * (sim_glue.c) switches on that tag against the sim's own button state
 * instead of reading a register.
 */
#pragma once

#define BUTTON_UP__PORT ((void *)1)
#define BUTTON_UP__PIN 0
#define BUTTON_DOWN__PORT ((void *)2)
#define BUTTON_DOWN__PIN 0
#define BUTTON_ONOFF__PORT ((void *)3)
#define BUTTON_ONOFF__PIN 0
#define BUTTON_M__PORT ((void *)4)
#define BUTTON_M__PIN 0

/* Stand-in for the real STM32F10x SPL GPIO header. buttons.c calls exactly
 * one function from it - implemented for real in sim_glue.c against the
 * sim's fake button state, keyed by the port tags in pins.h. */
#pragma once
#include <stdint.h>

uint32_t GPIO_ReadInputDataBit(void *GPIOx, uint16_t GPIO_Pin);

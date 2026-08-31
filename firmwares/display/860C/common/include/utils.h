/*
 * LCD3 firmware
 *
 * Copyright (C) Casainho, 2018.
 *
 * Released under the GPL License, Version 3
 */
#include <stdint.h>
#include <stdbool.h>
#ifndef _UTILS_H
#define _UTILS_H

uint16_t filter(uint16_t ui16_new_value, uint16_t ui16_old_value, uint8_t ui8_alpha);
int32_t map(int32_t x, int32_t in_min, int32_t in_max, int32_t out_min, int32_t out_max);
uint8_t ui8_max(uint8_t value_a, uint8_t value_b);
uint8_t ui8_min(uint8_t value_a, uint8_t value_b);
void crc16(uint8_t ui8_data, uint16_t *ui16_crc);
uint8_t* itoa(uint32_t ui32_i);
//void ftoa(float n, char *res, int afterpoint);

#ifdef STM32F10X_MD
// Re-checks the CRC16 (same algorithm as crc16() above) that
// crc16-append.py stamped onto this exact image right after linking,
// confirming what's actually sitting in flash right now still matches what
// was built - catches a bad/incomplete UART bootloader write (see
// tools/web_configurator/src/uart-flasher.ts) or in-field flash corruption,
// neither of which a build-vs-source diff could ever tell you about after
// the fact. Real firmware only (STM32 flash is memory-mapped into this
// build's own address space, so it can read its own image directly) - not
// meaningful for the WASM sim, which has no flashed image to check.
// Gated on STM32F10X_MD (not DISPLAY_860C_V13 etc - wasm-display-sim's
// build.sh also defines those to pick the same 860C layout, but has no
// linker-provided _flash_image_end symbol) rather than a display-target
// macro, since this needs to be real-hardware-only specifically.
bool firmware_integrity_check_ok(void);
#endif

#endif /* _UTILS_H */

#ifndef NRF51_NVMC_H
#define NRF51_NVMC_H

#include <stdint.h>

#include "stlink.h"

int nrf51_read_flash_geometry(stlink_t *sl, uint32_t *flash_size_out, uint32_t *page_size_out);
int nrf51_nvmc_write(stlink_t *sl, uint32_t addr, const uint8_t *data, uint32_t length, uint32_t page_size);

#endif

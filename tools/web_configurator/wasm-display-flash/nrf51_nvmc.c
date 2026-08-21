/* Nordic nRF51 (SW102's chip) flash write, over the same ST-Link SWD
 * connection stlink-org's stlink_open_usb() already established.
 *
 * Not vendored from anywhere - stlink-org/stlink has zero Nordic chip
 * support (confirmed: its config/chips/ directory only has STM32 parts,
 * which is also why Color_LCD_860C's own SW102 build uses OpenOCD, not
 * st-flash, to flash the SW102). This is a from-scratch implementation of
 * Nordic's own documented NVMC (Non-Volatile Memory Controller) register
 * sequence, built entirely on stlink_read_debug32()/stlink_write_debug32()
 * (src/stlink-lib/read_write.c) - the same chip-agnostic "read/write one
 * 32-bit word over the debug port" primitives the STM32 FPEC path uses
 * internally via stlink-org's own code. No loaded flash algorithm is
 * needed: nRF51's flash controller is directly memory-mapped, so writes are
 * ordinary AHB-AP memory writes once NVMC_CONFIG enables them.
 *
 * Register reference: Nordic nRF51 Series Reference Manual, "Non-Volatile
 * Memory Controller (NVMC)" and "Factory Information Configuration
 * Registers (FICR)" chapters - addresses are fixed across the whole nRF51
 * family (nRF51822 among them), not board- or SoftDevice-specific.
 */
#include <emscripten.h>
#include <stdio.h>

#include "nrf51_nvmc.h"
#include "read_write.h"
#include "stlink.h"

#define NVMC_BASE 0x4001E000u
#define NVMC_READY (NVMC_BASE + 0x400u)
#define NVMC_CONFIG (NVMC_BASE + 0x504u)
#define NVMC_ERASEPAGE (NVMC_BASE + 0x508u)

#define NVMC_CONFIG_REN 0x00u /* read-only (default) */
#define NVMC_CONFIG_WEN 0x01u /* write enable */
#define NVMC_CONFIG_EEN 0x02u /* erase enable */

#define FICR_BASE 0x10000000u
#define FICR_CODEPAGESIZE (FICR_BASE + 0x010u) /* bytes per flash page */
#define FICR_CODESIZE (FICR_BASE + 0x014u)     /* flash size, in pages */

/* NVMC operations (erase, then each word write) briefly make the flash
 * controller busy - real hardware clears this well under a millisecond, but
 * poll with a generous bound rather than assuming a fixed delay. */
#define NVMC_READY_POLL_MAX 100000

static int nvmc_wait_ready(stlink_t *sl) {
	for (int i = 0; i < NVMC_READY_POLL_MAX; i++) {
		uint32_t ready = 0;
		if (stlink_read_debug32(sl, NVMC_READY, &ready) != 0)
			return -1;
		if (ready)
			return 0;
	}
	fprintf(stderr, "NVMC_READY poll timed out\n");
	return -1;
}

/* Returns 0 on success, -1 on failure. On success, *flash_size_out and
 * *page_size_out are filled from FICR (not hardcoded - SW102 boards may ship
 * different nRF51822 flash variants). */
int nrf51_read_flash_geometry(stlink_t *sl, uint32_t *flash_size_out, uint32_t *page_size_out) {
	uint32_t page_size = 0, page_count = 0;
	if (stlink_read_debug32(sl, FICR_CODEPAGESIZE, &page_size) != 0 ||
	    stlink_read_debug32(sl, FICR_CODESIZE, &page_count) != 0) {
		fprintf(stderr, "Could not read flash geometry from FICR - is this really an nRF51?\n");
		return -1;
	}
	if (page_size == 0 || page_count == 0) {
		fprintf(stderr, "FICR reported implausible flash geometry (page_size=%u, page_count=%u)\n",
		        page_size, page_count);
		return -1;
	}
	*page_size_out = page_size;
	*flash_size_out = page_size * page_count;
	return 0;
}

/* Erases every page addr..addr+length touches, then writes data one 32-bit
 * word at a time. addr and length must both be word-aligned (checked by the
 * caller, wasm_api.c's nrf51_flash_write_hex(), against the parsed HEX's own
 * addresses - a misaligned HEX would mean a corrupt file or wrong chip, not
 * something to silently round). Returns bytes written, or -1 on failure. */
int nrf51_nvmc_write(stlink_t *sl, uint32_t addr, const uint8_t *data, uint32_t length, uint32_t page_size) {
	if (addr % 4 != 0 || length % 4 != 0) {
		fprintf(stderr, "nRF51 flash write requires 4-byte alignment (addr=0x%08x, length=%u)\n", addr,
		        length);
		return -1;
	}

	uint32_t first_page = (addr / page_size) * page_size;
	uint32_t last_page = ((addr + length - 1) / page_size) * page_size;

	for (uint32_t page = first_page; page <= last_page; page += page_size) {
		if (stlink_write_debug32(sl, NVMC_CONFIG, NVMC_CONFIG_EEN) != 0 ||
		    stlink_write_debug32(sl, NVMC_ERASEPAGE, page) != 0 || nvmc_wait_ready(sl) != 0) {
			fprintf(stderr, "Failed to erase flash page at 0x%08x\n", page);
			stlink_write_debug32(sl, NVMC_CONFIG, NVMC_CONFIG_REN);
			return -1;
		}
	}

	if (stlink_write_debug32(sl, NVMC_CONFIG, NVMC_CONFIG_WEN) != 0) {
		fprintf(stderr, "Failed to enable NVMC flash writes\n");
		return -1;
	}

	for (uint32_t off = 0; off < length; off += 4) {
		uint32_t word = ((uint32_t)data[off]) | ((uint32_t)data[off + 1] << 8) |
		                 ((uint32_t)data[off + 2] << 16) | ((uint32_t)data[off + 3] << 24);
		if (stlink_write_debug32(sl, addr + off, word) != 0 || nvmc_wait_ready(sl) != 0) {
			fprintf(stderr, "Flash write failed at 0x%08x\n", addr + off);
			stlink_write_debug32(sl, NVMC_CONFIG, NVMC_CONFIG_REN);
			return -1;
		}
	}

	stlink_write_debug32(sl, NVMC_CONFIG, NVMC_CONFIG_REN);
	return (int)length;
}

/* Browser entry points for the vendored stlink-org/stlink source.
 *
 * Mirrors the real st-flash CLI's write sequence (see
 * vendor/stlink/src/st-flash/flash.c's FLASH_CMD_WRITE branch) exactly,
 * rather than porting its full CLI (arg parsing, multi-device serial
 * matching, and the read/erase/gdb-server commands don't map to a browser
 * that already has one specific, already-picked device and one job to do -
 * same reasoning as wasm/wasm_api.c's header comment for stm8flash).
 *
 * Device discovery is faked (see shim-include/libusb.h) so
 * stlink_open_usb() below is stlink-org's real, unmodified function -
 * nothing about the ST-Link/SWD protocol itself is reimplemented here.
 */
#include <emscripten.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "chipid.h"
#include "common_flash.h"
#include "libusb.h"
#include "nrf51_nvmc.h"
#include "stlink.h"

/* STLinkV2/V21/V3 - matches src/usb-transport.ts's PROGRAMMER_TYPE_BY_PID
 * values (1/2/3) and PID map (0x3748/0x374b/0x374f). usb_type is passed
 * through unchanged from flasher.ts, same as stm8flash_write_hex()'s
 * usb_type parameter. */
static uint16_t pid_for_usb_type(int usb_type) {
	switch (usb_type) {
	case 1:
		return 0x3748; /* STLink/V2 */
	case 2:
		return 0x374b; /* STLink/V2-1 */
	case 3:
		return 0x374f; /* STLink/V3 */
	default:
		return 0x3748;
	}
}

/* config/chips (the .chip files) is preloaded into the WASM virtual FS at
 * this path by wasm-display-flash/build.sh's --preload-file - see
 * init_chipids() (chipid.c), which opendir()s/readdir()s it looking for
 * .chip files, exactly like the real st-flash CLI does against a real
 * directory. */
#define CHIPS_DIR "/chips"

EMSCRIPTEN_KEEPALIVE
int stm32_flash_write_hex(int usb_type, const char *hex_text) {
	usb_bridge_set_expected_pid(pid_for_usb_type(usb_type));

	static bool chipids_loaded = false;
	if (!chipids_loaded) {
		init_chipids(CHIPS_DIR);
		chipids_loaded = true;
	}

	const char *hex_path = "/firmware.hex";
	FILE *f = fopen(hex_path, "w");
	if (!f) {
		fprintf(stderr, "Could not stage firmware.hex in virtual FS\n");
		return -1;
	}
	size_t hex_len = strlen(hex_text);
	size_t written_len = fwrite(hex_text, 1, hex_len, f);
	fclose(f);
	if (written_len < hex_len) {
		fprintf(stderr, "Short write staging firmware.hex: %zu of %zu bytes\n", written_len, hex_len);
		return -1;
	}

	stlink_t *sl = stlink_open_usb(UERROR, CONNECT_NORMAL, NULL, 0);
	if (!sl) {
		fprintf(stderr, "Could not open ST-Link in SWD mode. Check the SWD/reset wiring.\n");
		return -1;
	}

	if (sl->flash_type == STM32_FLASH_TYPE_UNKNOWN) {
		fprintf(stderr, "Failed to identify the target's flash type - is the SWD wiring correct?\n");
		stlink_close(sl);
		return -1;
	}

	if (stlink_force_debug(sl)) {
		fprintf(stderr, "Failed to halt the target core\n");
		stlink_close(sl);
		return -1;
	}

	if (stlink_status(sl)) {
		fprintf(stderr, "Failed to read the target core's status\n");
		stlink_close(sl);
		return -1;
	}

	uint8_t *mem = NULL;
	uint32_t size = 0;
	uint32_t addr = 0;
	if (stlink_parse_ihex(hex_path, stlink_get_erased_pattern(sl), &mem, &size, &addr) == -1) {
		fprintf(stderr, "Could not parse Intel HEX data\n");
		stlink_close(sl);
		return -1;
	}

	if (!(addr >= sl->flash_base && addr < sl->flash_base + sl->flash_size)) {
		fprintf(stderr, "HEX start address 0x%08x is outside this chip's flash range (0x%08x - 0x%08x)\n",
		        addr, sl->flash_base, sl->flash_base + sl->flash_size);
		free(mem);
		stlink_close(sl);
		return -1;
	}

	int write_result = stlink_mwrite_flash(sl, mem, size, addr, SECTION_ERASE);
	free(mem);

	if (write_result == -1) {
		fprintf(stderr, "Flash write failed\n");
		stlink_close(sl);
		return -1;
	}

	stlink_reset(sl, RESET_AUTO);
	stlink_run(sl, RUN_NORMAL);
	stlink_close(sl);

	return (int)size;
}

/* Same shape as stm32_flash_write_hex() (open, halt, parse, write, reset,
 * close), but stlink-org has no STM32-vs-other chip-ID table entry for
 * Nordic parts, so sl->flash_type is legitimately STM32_FLASH_TYPE_UNKNOWN
 * here even on success - that check is skipped, and flash geometry comes
 * from nrf51_read_flash_geometry() (FICR) instead of sl->flash_base/
 * flash_size (which stlink_target_connect() never populates for a
 * non-STM32 chip). */
EMSCRIPTEN_KEEPALIVE
int nrf51_flash_write_hex(int usb_type, const char *hex_text) {
	usb_bridge_set_expected_pid(pid_for_usb_type(usb_type));

	const char *hex_path = "/firmware.hex";
	FILE *f = fopen(hex_path, "w");
	if (!f) {
		fprintf(stderr, "Could not stage firmware.hex in virtual FS\n");
		return -1;
	}
	size_t hex_len = strlen(hex_text);
	size_t written_len = fwrite(hex_text, 1, hex_len, f);
	fclose(f);
	if (written_len < hex_len) {
		fprintf(stderr, "Short write staging firmware.hex: %zu of %zu bytes\n", written_len, hex_len);
		return -1;
	}

	stlink_t *sl = stlink_open_usb(UERROR, CONNECT_NORMAL, NULL, 0);
	if (!sl) {
		fprintf(stderr, "Could not open ST-Link in SWD mode. Check the SWD/reset wiring.\n");
		return -1;
	}

	if (stlink_force_debug(sl)) {
		fprintf(stderr, "Failed to halt the target core\n");
		stlink_close(sl);
		return -1;
	}

	if (stlink_status(sl)) {
		fprintf(stderr, "Failed to read the target core's status\n");
		stlink_close(sl);
		return -1;
	}

	uint32_t flash_size = 0, page_size = 0;
	if (nrf51_read_flash_geometry(sl, &flash_size, &page_size) != 0) {
		stlink_close(sl);
		return -1;
	}

	uint8_t *mem = NULL;
	uint32_t size = 0;
	uint32_t addr = 0;
	/* 0xFF is the universal NOR-flash erased-byte value on both STM32 and
	 * nRF51 - not an STM32-specific convention despite stlink_get_erased_
	 * pattern()'s name, so reusing it here is correct, not a shortcut. */
	if (stlink_parse_ihex(hex_path, stlink_get_erased_pattern(sl), &mem, &size, &addr) == -1) {
		fprintf(stderr, "Could not parse Intel HEX data\n");
		stlink_close(sl);
		return -1;
	}

	if (!(addr < flash_size && size <= flash_size - addr)) {
		fprintf(stderr, "HEX start address 0x%08x is outside this chip's flash range (0x0 - 0x%08x)\n", addr,
		        flash_size);
		free(mem);
		stlink_close(sl);
		return -1;
	}

	int write_result = nrf51_nvmc_write(sl, addr, mem, size, page_size);
	free(mem);

	if (write_result == -1) {
		stlink_close(sl);
		return -1;
	}

	stlink_reset(sl, RESET_AUTO);
	stlink_run(sl, RUN_NORMAL);
	stlink_close(sl);

	return (int)size;
}

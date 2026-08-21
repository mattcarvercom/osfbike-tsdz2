/* Browser entry point for the vendored stm8flash source.
 *
 * Mirrors the single command this repo actually uses (src/Makefile's `flash`
 * target: `stm8flash -c stlinkv2 -p stm8s105?6 -w firmware.hex`) rather than
 * porting main.c's full CLI (arg parsing and multi-programmer USB
 * enumeration don't map to a browser: WebUSB hands the page one
 * already-user-picked device, not a list to scan).
 */
#include <ctype.h>
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "ihex.h"
#include "pgm.h"
#include "stlinkv2.h"
#include "stm8.h"

/* Same matching rule as stm8flash's own get_part() in main.c: case-insensitive,
 * '?' in the part table wildcards a single character (e.g. "stm8s105?6"
 * matches both the C6 and K6 packages, which share a memory map). */
static const stm8_device_t *find_part(const char *name) {
	for (unsigned int i = 0; stm8_devices[i].name; i++) {
		const char *e, *s;
		for (e = stm8_devices[i].name, s = name;
		     *s && (*e == *s || toupper((unsigned char)*e) == *s || *e == '?');
		     e++, s++)
			;
		if (!*e)
			return &stm8_devices[i];
	}
	return NULL;
}

/* usb_type must be one of the programmer_type_t values stlinkv2.c actually
 * branches on (STLinkV2 = 1, STLinkV21 = 2, STLinkV3 = 3) - see
 * src/usb-transport.ts for the VID/PID -> type mapping decided in JS after
 * navigator.usb.requestDevice(). Returns bytes written on success, -1 on
 * failure (details go to stderr, surfaced in JS via Module.printErr). */
EMSCRIPTEN_KEEPALIVE
int stm8flash_write_hex(int usb_type, const char *part_name, const char *hex_text) {
	const stm8_device_t *device = find_part(part_name);
	if (!device) {
		fprintf(stderr, "Unknown part: %s\n", part_name);
		return -1;
	}

	FILE *f = fmemopen((void *)hex_text, strlen(hex_text), "r");
	if (!f) {
		fprintf(stderr, "fmemopen failed\n");
		return -1;
	}

	unsigned int aligned =
	    ((device->flash_size - 1) / device->flash_block_size + 1) * device->flash_block_size;
	unsigned char *buf = calloc(1, aligned);
	if (!buf) {
		fclose(f);
		fprintf(stderr, "Out of memory\n");
		return -1;
	}

	/* ihex_read() frees buf itself on any parse error - see ihex.c - so buf
	 * must not be freed again on the error path here. */
	int bytes = ihex_read(f, buf, device->flash_start, device->flash_start + device->flash_size);
	fclose(f);
	if (bytes < 0) {
		fprintf(stderr, "Could not parse Intel HEX data\n");
		return -1;
	}

	programmer_t pgm;
	memset(&pgm, 0, sizeof(pgm));
	pgm.type = (programmer_type_t)usb_type;

	if (!stlink2_open(&pgm)) {
		free(buf);
		fprintf(stderr, "Could not enter SWIM mode. Check the SWIM/reset wiring.\n");
		return -1;
	}

	int sent = stlink2_swim_write_range(&pgm, device, buf, device->flash_start, bytes, FLASH);
	stlink2_srst(&pgm);
	stlink2_close(&pgm);
	free(buf);

	if (sent < bytes) {
		fprintf(stderr, "Short write: %d of %d bytes sent\n", sent, bytes);
		return -1;
	}
	return bytes;
}

/* Mirrors src/Makefile's `backup` target (three -r reads: whole flash,
 * eeprom, and option bytes) so the browser can back up the currently
 * flashed firmware before overwriting it, without needing stm8flash's CLI
 * or the shell scripts around it. `area` is "flash", "eeprom", or "opt" -
 * addresses/sizes computed exactly like stm8flash's own main.c does for
 * `-s <area>` (option bytes start at the fixed SWIM address 0x4800, sized
 * 0x40 for parts with <=8KB flash and 0x80 otherwise - main.c has no named
 * constant for either, so neither does this).
 *
 * Reads land in `out_path` (an Emscripten virtual FS path, e.g.
 * "/backup.bin") as raw bytes - the caller reads it back via FS.readFile
 * with { encoding: "binary" } for a Uint8Array. Returns bytes read on
 * success, -1 on failure (details on stderr, surfaced in JS via
 * Module.printErr). */
EMSCRIPTEN_KEEPALIVE
int stm8flash_read_area(int usb_type, const char *part_name, const char *area, const char *out_path) {
	const stm8_device_t *device = find_part(part_name);
	if (!device) {
		fprintf(stderr, "Unknown part: %s\n", part_name);
		return -1;
	}

	unsigned int start, size;
	if (strcasecmp(area, "flash") == 0) {
		start = device->flash_start;
		size = device->flash_size;
	} else if (strcasecmp(area, "eeprom") == 0) {
		start = device->eeprom_start;
		size = device->eeprom_size;
	} else if (strcasecmp(area, "opt") == 0) {
		start = 0x4800;
		size = (device->flash_size <= 8 * 1024) ? 0x40 : 0x80;
	} else {
		fprintf(stderr, "Unknown area: %s (expected flash, eeprom, or opt)\n", area);
		return -1;
	}

	/* Reads happen in 256-byte blocks, matching stm8flash's own -r handling. */
	unsigned int aligned = ((size - 1) / 256 + 1) * 256;
	unsigned char *buf = calloc(1, aligned);
	if (!buf) {
		fprintf(stderr, "Out of memory\n");
		return -1;
	}

	programmer_t pgm;
	memset(&pgm, 0, sizeof(pgm));
	pgm.type = (programmer_type_t)usb_type;

	if (!stlink2_open(&pgm)) {
		free(buf);
		fprintf(stderr, "Could not enter SWIM mode. Check the SWIM/reset wiring.\n");
		return -1;
	}

	int recv = stlink2_swim_read_range(&pgm, device, buf, start, aligned);
	stlink2_srst(&pgm);
	stlink2_close(&pgm);

	if (recv < (int)aligned) {
		free(buf);
		fprintf(stderr, "Short read: %d of %u bytes received\n", recv, aligned);
		return -1;
	}

	FILE *out = fopen(out_path, "wb");
	if (!out) {
		free(buf);
		fprintf(stderr, "Could not open %s for writing\n", out_path);
		return -1;
	}
	size_t written = fwrite(buf, 1, size, out);
	fclose(out);
	free(buf);

	if (written < size) {
		fprintf(stderr, "Short write to %s: %zu of %u bytes\n", out_path, written, size);
		return -1;
	}
	return (int)size;
}

/* Restores a raw-binary backup (as produced by stm8flash_read_area, or by
 * src/Makefile's `backup` target) back to the MCU - the write counterpart
 * of stm8flash_read_area, without which a .bin backup could be read but
 * never restored except by falling back to stm8flash's native CLI.
 *
 * `in_path` is an Emscripten virtual FS path the caller has already written
 * the backup file's bytes to (mirrors stm8flash_read_area's out_path, and
 * avoids passing raw binary through a JS string argument, which isn't
 * UTF-8-safe). Refuses to write more bytes than the target area's real
 * size, since that would mean the wrong area was picked or the file is
 * corrupt - either way is a real "don't touch the hardware" case rather
 * than something to silently truncate.
 *
 * Block-alignment matches stlink2_swim_write_range's actual internal
 * behavior exactly (verified by reading stlinkv2.c, not just guessing from
 * stm8flash_write_hex's FLASH-only precedent): FLASH and EEPROM are both
 * written in device->flash_block_size chunks and read `buffer[i..i+block)`
 * on every iteration including the last, so the buffer must be padded to a
 * block boundary or that last chunk reads past the allocation. OPT is
 * written one byte at a time in its own branch with no such padding
 * requirement. */
EMSCRIPTEN_KEEPALIVE
int stm8flash_write_area(int usb_type, const char *part_name, const char *area, const char *in_path) {
	const stm8_device_t *device = find_part(part_name);
	if (!device) {
		fprintf(stderr, "Unknown part: %s\n", part_name);
		return -1;
	}

	unsigned int start, size;
	memtype_t memtype;
	if (strcasecmp(area, "flash") == 0) {
		start = device->flash_start;
		size = device->flash_size;
		memtype = FLASH;
	} else if (strcasecmp(area, "eeprom") == 0) {
		start = device->eeprom_start;
		size = device->eeprom_size;
		memtype = EEPROM;
	} else if (strcasecmp(area, "opt") == 0) {
		start = 0x4800;
		size = (device->flash_size <= 8 * 1024) ? 0x40 : 0x80;
		memtype = OPT;
	} else {
		fprintf(stderr, "Unknown area: %s (expected flash, eeprom, or opt)\n", area);
		return -1;
	}

	FILE *in = fopen(in_path, "rb");
	if (!in) {
		fprintf(stderr, "Could not open %s for reading\n", in_path);
		return -1;
	}
	fseek(in, 0, SEEK_END);
	long file_len = ftell(in);
	fseek(in, 0, SEEK_SET);
	if (file_len < 0 || (unsigned int)file_len > size) {
		fclose(in);
		fprintf(stderr, "%s backup is %ld bytes, expected at most %u for this MCU - refusing (wrong area, wrong device, or corrupt file?)\n",
		        area, file_len, size);
		return -1;
	}

	unsigned int aligned = (memtype == OPT)
	    ? (unsigned int)file_len
	    : (((unsigned int)file_len - 1) / device->flash_block_size + 1) * device->flash_block_size;
	unsigned char *buf = calloc(1, aligned ? aligned : 1);
	if (!buf) {
		fclose(in);
		fprintf(stderr, "Out of memory\n");
		return -1;
	}
	size_t got = fread(buf, 1, (size_t)file_len, in);
	fclose(in);
	if (got < (size_t)file_len) {
		free(buf);
		fprintf(stderr, "Short read from %s: %zu of %ld bytes\n", in_path, got, file_len);
		return -1;
	}

	programmer_t pgm;
	memset(&pgm, 0, sizeof(pgm));
	pgm.type = (programmer_type_t)usb_type;

	if (!stlink2_open(&pgm)) {
		free(buf);
		fprintf(stderr, "Could not enter SWIM mode. Check the SWIM/reset wiring.\n");
		return -1;
	}

	int sent = stlink2_swim_write_range(&pgm, device, buf, start, (unsigned int)file_len, memtype);
	stlink2_srst(&pgm);
	stlink2_close(&pgm);
	free(buf);

	if (sent < file_len) {
		fprintf(stderr, "Short write: %d of %ld bytes sent\n", sent, file_len);
		return -1;
	}
	return sent;
}

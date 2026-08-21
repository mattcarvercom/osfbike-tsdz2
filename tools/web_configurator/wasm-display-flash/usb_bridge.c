/* Fakes exactly one enumerated USB device (see shim-include/libusb.h's
 * header comment for why), then backs the one real libusb call -
 * libusb_bulk_transfer() - with WebUSB via Emscripten's Asyncify, identical
 * in every respect to wasm/usb_bridge.c's version for stm8flash: by the time
 * any exported WASM function runs, Module.usbBridge.device is already an
 * open, claimed USBDevice, and transferIn/transferOut is all this needs.
 */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

#include "libusb.h"

/* A single opaque "device" the fake enumeration hands back; the pointer
 * value itself is never dereferenced by us, only compared/passed around by
 * usb.c, so any fixed non-NULL address is fine. */
static int fake_device_token;
#define FAKE_DEVICE ((libusb_device *)&fake_device_token)
#define FAKE_HANDLE ((libusb_device_handle *)&fake_device_token)

static uint16_t expected_pid = 0x3748; /* STLINK_V2 - overwritten before use */

void usb_bridge_set_expected_pid(uint16_t pid) {
	expected_pid = pid;
}

int libusb_init(libusb_context **ctx) {
	if (ctx)
		*ctx = NULL;
	return 0;
}

void libusb_exit(libusb_context *ctx) {
	(void)ctx;
}

int libusb_set_option(libusb_context *ctx, int option, ...) {
	(void)ctx;
	(void)option;
	return 0;
}

ssize_t libusb_get_device_list(libusb_context *ctx, libusb_device ***list) {
	(void)ctx;
	libusb_device **fake_list = malloc(sizeof(libusb_device *));
	fake_list[0] = FAKE_DEVICE;
	*list = fake_list;
	return 1;
}

void libusb_free_device_list(libusb_device **list, int unref_devices) {
	(void)unref_devices;
	free(list);
}

int libusb_get_device_descriptor(libusb_device *dev, struct libusb_device_descriptor *desc) {
	(void)dev;
	desc->idVendor = 0x0483; /* STLINK_USB_VID_ST */
	desc->idProduct = expected_pid;
	desc->iSerialNumber = 3; /* arbitrary nonzero index - our string-descriptor stub ignores it */
	return 0;
}

int libusb_open(libusb_device *dev, libusb_device_handle **dev_handle) {
	(void)dev;
	*dev_handle = FAKE_HANDLE;
	return 0;
}

void libusb_close(libusb_device_handle *dev_handle) {
	(void)dev_handle;
}

int libusb_kernel_driver_active(libusb_device_handle *dev_handle, int interface_number) {
	(void)dev_handle;
	(void)interface_number;
	return 0; /* not active - no such concept in a browser */
}

int libusb_detach_kernel_driver(libusb_device_handle *dev_handle, int interface_number) {
	(void)dev_handle;
	(void)interface_number;
	return 0;
}

int libusb_get_configuration(libusb_device_handle *dev_handle, int *config) {
	(void)dev_handle;
	*config = 1; /* usb-transport.ts's selectConfiguration(1) already ran */
	return 0;
}

int libusb_set_configuration(libusb_device_handle *dev_handle, int configuration) {
	(void)dev_handle;
	(void)configuration;
	return 0;
}

int libusb_claim_interface(libusb_device_handle *dev_handle, int interface_number) {
	(void)dev_handle;
	(void)interface_number;
	return 0; /* usb-transport.ts's claimInterface(0) already ran */
}

/* stlink_serial() (usb.c) makes two calls: desc_index=0/langid=0 to read the
 * supported-LANGIDs list, then desc_index=iSerialNumber/langid=<decoded> to
 * read the actual serial string descriptor. It only accepts a serial whose
 * raw descriptor length is exactly (STLINK_SERIAL_LENGTH+1)*2 = 50 bytes (a
 * well-formed USB STRING descriptor: length byte, 0x03 type byte, then
 * STLINK_SERIAL_LENGTH UTF-16LE code units) - anything else makes
 * stlink_open_usb() treat this as "couldn't read the serial" and fail the
 * whole open. We don't care what the fake serial's content is (there's only
 * ever one device, no multi-device serial matching happens), only that its
 * *shape* satisfies that check. */
int libusb_get_string_descriptor(libusb_device_handle *dev_handle, uint8_t desc_index, uint16_t langid,
                                  unsigned char *data, int length) {
	(void)dev_handle;
	(void)langid;

	if (desc_index == 0) {
		/* LANGID list: length=4, type=0x03, one LANGID (0x0409 = en-US). */
		if (length < 4)
			return length;
		data[0] = 4;
		data[1] = 0x03;
		data[2] = 0x09;
		data[3] = 0x04;
		return 4;
	}

	/* Serial string: 24 fixed ASCII digits, UTF-16LE-encoded. Array size is
	 * left to the compiler (25, including the string literal's trailing
	 * NUL) - the loop below only ever reads indices [0, 24). */
	static const char fake_serial[] = "000000000000000000000000";
	int want = 2 + 24 * 2;
	if (length < want)
		return length;
	data[0] = (unsigned char)want;
	data[1] = 0x03;
	for (int i = 0; i < 24; i++) {
		data[2 + i * 2] = (unsigned char)fake_serial[i];
		data[2 + i * 2 + 1] = 0x00;
	}
	return want;
}

int libusb_get_string_descriptor_ascii(libusb_device_handle *dev_handle, uint8_t desc_index,
                                        unsigned char *data, int length) {
	(void)dev_handle;
	(void)desc_index;
	static const char fake_serial[] = "000000000000000000000000";
	int n = length < 24 ? length : 24;
	memcpy(data, fake_serial, (size_t)n);
	return n;
}

EM_ASYNC_JS(int, usb_bridge_bulk_out, (int ep, const unsigned char *data, int length), {
	const bytes = HEAPU8.slice(data, data + length);
	try {
		const res = await Module.usbBridge.device.transferOut(ep, bytes);
		return res.status === "ok" ? res.bytesWritten : -1;
	} catch (e) {
		console.error("WebUSB transferOut failed:", e);
		return -1;
	}
});

EM_ASYNC_JS(int, usb_bridge_bulk_in, (int ep, unsigned char *data, int length), {
	try {
		const res = await Module.usbBridge.device.transferIn(ep, length);
		const view = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
		HEAPU8.set(view, data);
		return res.status === "ok" ? view.length : -1;
	} catch (e) {
		console.error("WebUSB transferIn failed:", e);
		return -1;
	}
});

int libusb_bulk_transfer(libusb_device_handle *dev_handle, unsigned char endpoint, unsigned char *data,
                          int length, int *transferred, unsigned int timeout) {
	(void)dev_handle;
	(void)timeout;

	int ep_num = endpoint & 0x7f;
	int n = (endpoint & LIBUSB_ENDPOINT_IN) ? usb_bridge_bulk_in(ep_num, data, length)
	                                        : usb_bridge_bulk_out(ep_num, data, length);

	if (n < 0) {
		if (transferred)
			*transferred = 0;
		return -1;
	}
	if (transferred)
		*transferred = n;
	return 0;
}

const char *libusb_error_name(int error_code) {
	(void)error_code;
	return "libusb error (see browser console)";
}

uint8_t libusb_get_bus_number(libusb_device *dev) {
	(void)dev;
	return 0;
}

uint8_t libusb_get_device_address(libusb_device *dev) {
	(void)dev;
	return 0;
}

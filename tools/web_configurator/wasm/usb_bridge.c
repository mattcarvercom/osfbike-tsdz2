/* Backs libusb_bulk_transfer() (the one libusb call stlinkv2.c actually
 * makes - see wasm/shim-include/libusb.h) with WebUSB, via Emscripten's
 * Asyncify so the blocking-looking C call can await a JS Promise.
 *
 * navigator.usb.requestDevice()/open()/claimInterface() all require a user
 * gesture and live entirely in src/usb-transport.ts; by the time any
 * exported WASM function runs, Module.usbBridge.device is already an open,
 * claimed USBDevice and this file only ever does transferIn/transferOut on
 * it.
 */
#include <emscripten.h>
#include <string.h>

#include "libusb.h"

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

int libusb_bulk_transfer(libusb_device_handle *dev_handle, unsigned char endpoint,
                          unsigned char *data, int length, int *transferred, unsigned int timeout) {
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

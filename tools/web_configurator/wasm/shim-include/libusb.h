/* Minimal libusb-1.0 surface for the browser build.
 *
 * We do not compile stm8flash's main.c, stlink.c (STLinkV1 mass-storage),
 * espstlink.c or libespstlink.c, so the only libusb symbol the rest of the
 * vendored source (stlinkv2.c) actually calls is libusb_bulk_transfer(). The
 * real implementation lives in usb_bridge.c and forwards to WebUSB via
 * Emscripten's EM_ASYNC_JS, keyed off the single device the page connected
 * with navigator.usb.requestDevice().
 */
#ifndef WASM_LIBUSB_SHIM_H
#define WASM_LIBUSB_SHIM_H

typedef struct libusb_context libusb_context;
typedef struct libusb_device_handle libusb_device_handle;

#define LIBUSB_ENDPOINT_OUT 0x00
#define LIBUSB_ENDPOINT_IN  0x80

int libusb_bulk_transfer(libusb_device_handle *dev_handle, unsigned char endpoint,
                          unsigned char *data, int length, int *transferred,
                          unsigned int timeout);

#endif

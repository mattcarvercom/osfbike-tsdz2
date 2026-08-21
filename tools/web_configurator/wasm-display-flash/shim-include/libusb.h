/* libusb-1.0 surface for the browser build of vendor/stlink's src/stlink-lib.
 *
 * Unlike wasm/shim-include/libusb.h (which backs stm8flash, and only ever
 * calls libusb_bulk_transfer()), vendor/stlink's usb.c does real multi-device
 * USB enumeration in stlink_open_usb() - libusb_get_device_list(),
 * per-device libusb_open()+serial read, kernel-driver detach, config/claim -
 * none of which makes sense here: navigator.usb.requestDevice() (in
 * src/usb-transport.ts) already picked exactly one specific, permissioned,
 * opened, claimed device before any WASM code runs.
 *
 * Strategy: don't patch or duplicate stlink_open_usb() (it reaches into
 * usb.c's file-static _stlink_usb_backend, so a duplicate can't assign it
 * without a vendor patch). Instead, fake the *enumeration* here - present
 * exactly one fake USB device with a real VID/PID (set via
 * usb_bridge_set_expected_pid() before calling into stlink_open_usb()) - and
 * let the real, unmodified stlink_open_usb() "discover" and "open" it, then
 * proceed into genuinely real protocol work (version query, mode detection,
 * SWD entry, target connect) over the one real function here that does
 * anything, libusb_bulk_transfer(), which is byte-for-byte the same bridge
 * wasm/usb_bridge.c already uses for stm8flash.
 *
 * Every other function below is a stateless stub reporting "already done" -
 * see usb_bridge.c for each one's behavior and why it's safe to stub.
 */
#ifndef WASM_LIBUSB_SHIM_H
#define WASM_LIBUSB_SHIM_H

#include <stdint.h>
#include <sys/types.h> /* ssize_t */

/* vendor/stlink/src/stlink-lib/libusb_settings.h #errors out below this
 * (MINIMAL_API_VERSION = 0x01000108 on non-FreeBSD) - this also selects
 * usb.c's libusb_set_option() branch over the older libusb_set_debug() one
 * (see the `#if LIBUSB_API_VERSION < 0x01000106` in stlink_open_usb()). */
#define LIBUSB_API_VERSION 0x01000108

typedef struct libusb_context libusb_context;
typedef struct libusb_device_handle libusb_device_handle;
typedef struct libusb_device libusb_device;

#define LIBUSB_ENDPOINT_OUT 0x00
#define LIBUSB_ENDPOINT_IN 0x80

/* Real libusb's struct has ~15 fields; usb.c only ever reads idVendor,
 * idProduct (device-discovery loop) and iSerialNumber (stlink_serial()) -
 * same minimalism as wasm/shim-include/libusb.h's precedent. */
struct libusb_device_descriptor {
	uint16_t idVendor;
	uint16_t idProduct;
	uint8_t iSerialNumber;
};

/* Real libusb's enum value (-3) - kept accurate even though our fake
 * libusb_open() always succeeds, so this branch is unreachable in practice. */
#define LIBUSB_ERROR_ACCESS (-3)

/* Real libusb's enum value - passed straight through to a stub, value is
 * unused. */
#define LIBUSB_OPTION_LOG_LEVEL 0

int libusb_init(libusb_context **ctx);
void libusb_exit(libusb_context *ctx);
int libusb_set_option(libusb_context *ctx, int option, ...);

ssize_t libusb_get_device_list(libusb_context *ctx, libusb_device ***list);
void libusb_free_device_list(libusb_device **list, int unref_devices);
int libusb_get_device_descriptor(libusb_device *dev, struct libusb_device_descriptor *desc);

int libusb_open(libusb_device *dev, libusb_device_handle **dev_handle);
void libusb_close(libusb_device_handle *dev_handle);

int libusb_kernel_driver_active(libusb_device_handle *dev_handle, int interface_number);
int libusb_detach_kernel_driver(libusb_device_handle *dev_handle, int interface_number);
int libusb_get_configuration(libusb_device_handle *dev_handle, int *config);
int libusb_set_configuration(libusb_device_handle *dev_handle, int configuration);
int libusb_claim_interface(libusb_device_handle *dev_handle, int interface_number);

/* desc_index 0 + langid 0 is the "get supported LANGIDs" query
 * stlink_serial() makes first - our stub special-cases it, see usb_bridge.c. */
int libusb_get_string_descriptor(libusb_device_handle *dev_handle, uint8_t desc_index, uint16_t langid,
                                  unsigned char *data, int length);
int libusb_get_string_descriptor_ascii(libusb_device_handle *dev_handle, uint8_t desc_index,
                                        unsigned char *data, int length);

int libusb_bulk_transfer(libusb_device_handle *dev_handle, unsigned char endpoint, unsigned char *data,
                          int length, int *transferred, unsigned int timeout);

const char *libusb_error_name(int error_code);
uint8_t libusb_get_bus_number(libusb_device *dev);
uint8_t libusb_get_device_address(libusb_device *dev);

/* Not part of real libusb - called once from wasm_api.c before
 * stlink_open_usb() so the fake device descriptor reports the PID
 * src/usb-transport.ts already determined (STLinkV2/V21/V3), letting
 * stlink_open_usb()'s own real PID-branching logic set sl->version.stlink_v
 * and pick endpoint numbers correctly with no separate mapping table here. */
void usb_bridge_set_expected_pid(uint16_t pid);

#endif

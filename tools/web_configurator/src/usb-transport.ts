// WebUSB connection to an ST-Link V2/V21/V3 clone. Device enumeration and the
// permission prompt are Chromium-only browser APIs and must run from a user
// gesture (a click handler), which is why this file has no C/WASM
// involvement at all - the WASM side (wasm/usb_bridge.c) only ever sees an
// already-open, already-claimed device via Module.usbBridge.

// programmer_type_t values from vendor/stm8flash/pgm.h - stlinkv2.c branches
// on these to pick the right USB endpoint numbers.
const STLINK_V2 = 1;
const STLINK_V21 = 2;
const STLINK_V3 = 3;

const USB_VENDOR_ID_STMICRO = 0x0483;

const PROGRAMMER_TYPE_BY_PID: Record<number, number> = {
  0x3748: STLINK_V2,
  0x374b: STLINK_V21,
  0x374f: STLINK_V3,
};

export interface ConnectedProgrammer {
  device: USBDevice;
  usbType: number;
}

export function webUsbAvailable(): boolean {
  return "usb" in navigator;
}

export async function connectStLink(): Promise<ConnectedProgrammer> {
  if (!webUsbAvailable()) {
    throw new Error(
      "WebUSB is not available in this browser. Use desktop or Android Chrome, Edge, Brave, or Opera, served over http://localhost or https://.",
    );
  }

  const device = await navigator.usb.requestDevice({
    filters: Object.keys(PROGRAMMER_TYPE_BY_PID).map((pid) => ({
      vendorId: USB_VENDOR_ID_STMICRO,
      productId: Number(pid),
    })),
  });

  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }
  await device.claimInterface(0);

  const usbType = PROGRAMMER_TYPE_BY_PID[device.productId];
  if (!usbType) {
    throw new Error(`Unrecognized ST-Link USB product ID 0x${device.productId.toString(16)}`);
  }

  return { device, usbType };
}

export async function disconnectStLink(device: USBDevice): Promise<void> {
  try {
    await device.close();
  } catch {
    // Already gone, e.g. unplugged mid-session - nothing left to release.
  }
}

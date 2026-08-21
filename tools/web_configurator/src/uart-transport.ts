// Web Serial connection to a generic USB-UART adapter wired into the 860C/
// 850C's own 5-pin motor-controller connector (the display's real-world
// flashing path - see uart-flasher.ts). Deliberately a separate transport
// from usb-transport.ts's WebUSB/ST-Link connection: different browser API
// (navigator.serial, not navigator.usb), different device (a generic
// CDC-ACM adapter - Silicon Labs CP210x, FTDI, CH340, etc - not a fixed
// ST-Link VID/PID this app can filter requestPort() on), and permission
// prompts for the two APIs are entirely independent even in the same tab.

export function webSerialAvailable(): boolean {
  return "serial" in navigator;
}

// Bootloader download baud - see docs/bootloader-uart-protocol.md's "Physical
// / link layer" table. Distinct from the display's normal 9600-baud runtime
// traffic to the motor controller; only used while the display is in its
// UART bootloader (entered by powering it on with the adapter already
// wired/armed).
const BOOTLOADER_BAUD = 57600;

export async function connectUartAdapter(): Promise<SerialPort> {
  if (!webSerialAvailable()) {
    throw new Error(
      "Web Serial is not available in this browser. Use desktop Chrome, Edge, Brave, or Opera, served over http://localhost or https://.",
    );
  }

  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: BOOTLOADER_BAUD, dataBits: 8, stopBits: 1, parity: "none" });
  return port;
}

export async function disconnectUartAdapter(port: SerialPort): Promise<void> {
  try {
    await port.close();
  } catch {
    // Already gone, e.g. unplugged mid-session - nothing left to release.
  }
}

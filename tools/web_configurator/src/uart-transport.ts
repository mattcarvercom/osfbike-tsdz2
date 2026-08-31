// Web Serial connection to a generic USB-UART adapter wired into the 860C/
// 850C's own 5-pin motor-controller connector (the display's real-world
// flashing path - see uart-flasher.ts). Deliberately a separate transport
// from usb-transport.ts's WebUSB/ST-Link connection: different browser API
// (navigator.serial, not navigator.usb), different device (a generic
// CDC-ACM adapter - Silicon Labs CP210x, FTDI, CH340, etc - not a fixed
// ST-Link VID/PID this app can filter requestPort() on), and permission
// prompts for the two APIs are entirely independent even in the same tab.
//
// Android Chrome exposes navigator.serial (Chrome 126+), but that alone
// doesn't mean a CP210x/CH340/FTDI adapter can be opened through it: Web
// Serial only attaches to a device the OS kernel has already turned into a
// tty via a bound driver, and Android ships no such driver for these
// vendor-specific chips (unlike desktop Linux/Windows/macOS, which do).
// webSerialAvailable() reports API presence, not "this adapter will open" -
// there's no capability check that distinguishes the two, so this is a real
// user-facing choice (see connectUartAdapterViaWebUsb() below), not
// something to auto-detect and silently switch on.

import { webUsbAvailable } from "./usb-transport.ts";

export function webSerialAvailable(): boolean {
  return "serial" in navigator;
}

// Bootloader download baud - see docs/bootloader-uart-protocol.md's "Physical
// / link layer" table. Distinct from the display's normal runtime traffic to
// the motor controller (see motor-handshake.ts's MOTOR_LINK_BAUD - 19200 on
// this fork's actual 860C_850C/src/usart1.c, not the 9600 some docs/upstream
// comments claim); only used while the display is in its UART bootloader
// (entered by powering it on with the adapter already wired/armed).
export const BOOTLOADER_BAUD = 57600;

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

// The real Android path (see the header comment above). Talks to the raw,
// driver-unclaimed USB device directly over WebUSB - the same model
// usb-transport.ts's ST-Link connection already uses, and the reason that
// path works identically on desktop and Android while this one needs an
// explicit fallback. Rather than reimplementing the CP210x/CH340/FTDI
// vendor wire protocols from scratch, this uses vendor/webserial-esptool's
// webusb-serial.js (Jason2866/WebSerial_ESPTool, MIT) unmodified - a
// known-good implementation another project already built and hardware-
// verified for exactly this problem (browser-based flashing over USB-OTG on
// Android). It exposes readable/writable/open()/close() shaped like
// SerialPort (see webusb-serial-vendor.d.ts), so uart-flasher.ts's
// flashUartBin() and motor-handshake.ts work against it unchanged.
export async function connectUartAdapterViaWebUsb(): Promise<SerialPort> {
  if (!webUsbAvailable()) {
    throw new Error(
      "WebUSB is not available in this browser. Use desktop or Android Chrome, Edge, Brave, or Opera, served over http://localhost or https://.",
    );
  }

  const { WebUSBSerial } = await import("../vendor/webserial-esptool/js/webusb-serial.js");
  const port = await WebUSBSerial.requestPort();
  await port.open({ baudRate: BOOTLOADER_BAUD });
  return port as unknown as SerialPort;
}

export async function disconnectUartAdapter(port: SerialPort): Promise<void> {
  try {
    await port.close();
  } catch {
    // Already gone, e.g. unplugged mid-session - nothing left to release.
  }
}

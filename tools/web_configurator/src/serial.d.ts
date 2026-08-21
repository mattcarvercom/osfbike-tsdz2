// Minimal Web Serial ambient types covering only what uart-transport.ts and
// uart-flasher.ts actually touch. TypeScript's bundled DOM lib doesn't ship
// Web Serial (Chromium-only, never standardized past a Working Draft) - same
// situation as WebUSB, see webusb.d.ts. Deliberately not the full spec
// surface (no SerialPortInfo, no getPorts(), no signal/break control).

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}

interface Navigator {
  readonly serial: Serial;
}

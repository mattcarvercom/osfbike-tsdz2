// vendor/webserial-esptool/js/webusb-serial.js (Jason2866/WebSerial_ESPTool,
// MIT - see vendor/webserial-esptool/license.md) is a real ES module but
// ships no .d.ts and isn't a TS project - declare only the members
// uart-transport.ts's connectUartAdapterViaWebUsb() actually calls, same
// "vendored/generated output, don't hand-maintain more than needed"
// precedent webusb.d.ts already sets for wasm/build.sh's *.mjs output.
declare module "*/webusb-serial.js" {
  export class WebUSBSerial {
    static requestPort(logger?: unknown, forceNew?: boolean): Promise<WebUSBSerial>;
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options?: { baudRate?: number }): Promise<void>;
    close(): Promise<void>;
  }
}

// Minimal WebUSB ambient types covering only what usb-transport.ts and
// wasm/usb_bridge.c's JS glue actually touch. TypeScript's bundled DOM lib
// doesn't ship WebUSB (Chromium-only, never standardized past a Working
// Draft), so this fills the gap without pulling in a dependency for five
// members.

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USBInTransferResult {
  data?: DataView;
  status: "ok" | "stall" | "babble";
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: "ok" | "stall";
}

interface USBConfiguration {
  configurationValue: number;
}

interface USBDevice {
  readonly productId: number;
  readonly vendorId: number;
  readonly configuration: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
}

interface USB {
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
}

interface Navigator {
  readonly usb: USB;
}

// wasm/build.sh emits an ES module with no bundled .d.ts; declare the
// extension generically rather than hand-maintaining a type for generated
// output.
declare module "*.mjs" {
  const value: unknown;
  export default value;
}

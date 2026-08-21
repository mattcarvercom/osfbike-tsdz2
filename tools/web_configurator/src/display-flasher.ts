import { requireWasmBytes } from "./flasher.ts";
import type { ConnectedProgrammer } from "./usb-transport.ts";

type LogFn = (line: string) => void;

interface StlinkDisplayFlashModule {
  usbBridge?: { device: USBDevice };
  ccall(ident: string, returnType: string, argTypes: string[], args: unknown[], opts: { async: true }): Promise<number>;
}

type StlinkDisplayFlashModuleFactory = (moduleArg: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}) => Promise<StlinkDisplayFlashModule>;

let modulePromise: Promise<StlinkDisplayFlashModule> | null = null;

async function loadModule(onLog: LogFn): Promise<StlinkDisplayFlashModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createModule } = (await import("./wasm/stlink-display-flash.mjs")) as {
        default: StlinkDisplayFlashModuleFactory;
      };
      return createModule({ print: onLog, printErr: onLog });
    })();
  }
  return modulePromise;
}

/**
 * Flashes an 860C/850C (STM32F103) over SWD - see
 * wasm-display-flash/wasm_api.c's stm32_flash_write_hex(). Not wired into
 * render/display-flash-page.ts's UI: the 860C's SWD pins aren't reachable
 * without opening a sealed case, and this path is untested against real
 * hardware. UART (see uart-flasher.ts) is the real flashing path for these
 * chips now. Kept here, unused, only as a building block for a possible
 * future advanced/recovery-flashing UI - see
 * ../../UNIVERSAL_FIRMWARE_PLAN.md's "Open / ongoing" section.
 */
export async function flashStm32Hex(programmer: ConnectedProgrammer, hexText: string, onLog: LogFn): Promise<number> {
  const mod = await loadModule(onLog);
  mod.usbBridge = { device: programmer.device };

  const bytesWritten = await mod.ccall(
    "stm32_flash_write_hex",
    "number",
    ["number", "string"],
    [programmer.usbType, hexText],
    { async: true },
  );

  return requireWasmBytes(bytesWritten, "Flashing");
}

/** Flashes an SW102 (nRF51822) over SWD - see wasm-display-flash/wasm_api.c's nrf51_flash_write_hex(). */
export async function flashNrf51Hex(programmer: ConnectedProgrammer, hexText: string, onLog: LogFn): Promise<number> {
  const mod = await loadModule(onLog);
  mod.usbBridge = { device: programmer.device };

  const bytesWritten = await mod.ccall(
    "nrf51_flash_write_hex",
    "number",
    ["number", "string"],
    [programmer.usbType, hexText],
    { async: true },
  );

  return requireWasmBytes(bytesWritten, "Flashing");
}

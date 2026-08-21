import type { ConnectedProgrammer } from "./usb-transport.ts";

// Matches src/Makefile's `flash` target: `stm8flash -c stlinkv2 -p stm8s105?6 -w ...`.
// The '?' wildcard (handled on the C side in wasm/wasm_api.c's find_part())
// covers both packages TSDZ2 boards use, which share a memory map.
const DEFAULT_PART = "stm8s105?6";

type LogFn = (line: string) => void;

interface Stm8flashModule {
  usbBridge?: { device: USBDevice };
  FS: {
    readFile(path: string, opts: { encoding: "binary" }): Uint8Array;
    writeFile(path: string, data: Uint8Array): void;
  };
  ccall(ident: string, returnType: string, argTypes: string[], args: unknown[], opts: { async: true }): Promise<number>;
}

type Stm8flashModuleFactory = (moduleArg: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}) => Promise<Stm8flashModule>;

/**
 * Validates a WASM ccall's numeric byte-count result, throwing a consistent,
 * actionable error on failure. Covers two distinct failure shapes as one:
 * a genuine negative return, AND the case documented in tools/CLAUDE.md's
 * "Build & flash page" section where a mid-call C exit() (stm8flash hitting
 * ERROR2()) resolves the ccall promise with `undefined` instead of
 * rejecting it - Number.isFinite(undefined) is false, so that's caught here
 * too, rather than reporting a bogus "Done. undefined bytes written."
 */
export function requireWasmBytes(result: number, failureLabel: string): number {
  if (!Number.isFinite(result) || result < 0) {
    throw new Error(
      `${failureLabel} failed - see log above for details. If you saw a USB IO error and the ST-Link's LED wasn't solid, the connection likely dropped: reseat the ST-Link's USB cable and its SWIM/reset wiring to the board, then Connect and try again.`,
    );
  }
  return result;
}

let modulePromise: Promise<Stm8flashModule> | null = null;

async function loadModule(onLog: LogFn): Promise<Stm8flashModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createModule } = (await import("./wasm/stm8flash.mjs")) as {
        default: Stm8flashModuleFactory;
      };
      return createModule({ print: onLog, printErr: onLog });
    })();
  }
  return modulePromise;
}

export async function flashHex(
  programmer: ConnectedProgrammer,
  hexText: string,
  onLog: LogFn,
  partName: string = DEFAULT_PART,
): Promise<number> {
  const mod = await loadModule(onLog);
  mod.usbBridge = { device: programmer.device };

  const bytesWritten = await mod.ccall(
    "stm8flash_write_hex",
    "number",
    ["number", "string", "string"],
    [programmer.usbType, partName, hexText],
    { async: true },
  );

  return requireWasmBytes(bytesWritten, "Flashing");
}

export type BackupArea = "flash" | "eeprom" | "opt";

/** Reads one memory area off the connected MCU - mirrors src/Makefile's `backup` target's three -r reads (flash, eeprom, opt), one call each. */
export async function readBackupArea(
  programmer: ConnectedProgrammer,
  area: BackupArea,
  onLog: LogFn,
  partName: string = DEFAULT_PART,
): Promise<Uint8Array> {
  const mod = await loadModule(onLog);
  mod.usbBridge = { device: programmer.device };

  const outPath = `/backup-${area}.bin`;
  const bytesRead = await mod.ccall(
    "stm8flash_read_area",
    "number",
    ["number", "string", "string", "string"],
    [programmer.usbType, partName, area, outPath],
    { async: true },
  );

  requireWasmBytes(bytesRead, `Reading ${area}`);
  return mod.FS.readFile(outPath, { encoding: "binary" });
}

/** Writes a raw-binary backup (from readBackupArea, or src/Makefile's `backup` target) back to one memory area - the restore counterpart of readBackupArea. */
export async function restoreBackupArea(
  programmer: ConnectedProgrammer,
  area: BackupArea,
  bytes: Uint8Array,
  onLog: LogFn,
  partName: string = DEFAULT_PART,
): Promise<number> {
  const mod = await loadModule(onLog);
  mod.usbBridge = { device: programmer.device };

  const inPath = `/restore-${area}.bin`;
  mod.FS.writeFile(inPath, bytes);
  const bytesWritten = await mod.ccall(
    "stm8flash_write_area",
    "number",
    ["number", "string", "string", "string"],
    [programmer.usbType, partName, area, inPath],
    { async: true },
  );

  return requireWasmBytes(bytesWritten, `Restoring ${area}`);
}

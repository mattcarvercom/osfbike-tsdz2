// Builds firmware.hex in the browser from the current config.h, using
// SDCC's STM8 toolchain compiled to WASM (see ../wasm-sdcc/build.sh).
//
// SDCC's driver normally spawns the preprocessor/assembler/linker as
// separate OS processes to build a program - that doesn't work under
// WASM, so (matching how the 8bitworkshop project - github.com/sehugg/
// 8bitworkshop - handles the same problem for Z80/6502) each stage runs as
// its own module instance, orchestrated here instead of by SDCC's own
// driver: mcpp (preprocess) -> sdcc --c1mode (compile to .asm) -> sdasstm8
// (assemble to .rel) -> sdldstm8 (link all .rel to .ihx). A fresh instance
// is created per file per stage (not reused across files), matching
// 8bitworkshop's own approach - SDCC's compiler has enough global state
// that reusing one instance across unrelated files isn't safe.

import { parseUndefinedGlobals, nextHelperFiles } from "./sdcc-link-discovery.ts";

type LogFn = (line: string) => void;

interface EmFS {
  writeFile(path: string, data: string): void;
  mkdirTree(path: string): void;
  readFile(path: string, opts: { encoding: "utf8" }): string;
}

interface EmModule {
  FS: EmFS;
  callMain(args: string[]): number;
}

type ModuleFactory = (opts: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  noInitialRun?: boolean;
  stdin?: () => number | null;
}) => Promise<EmModule>;

// ---- Bundled static assets ----------------------------------------------

/** Strips everything up through the first "/src/" (or "stm8-runtime/") segment so keys match the relative paths src/Makefile itself uses. */
function relativeKeys(files: Record<string, string>, anchor: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    const idx = k.indexOf(anchor);
    if (idx === -1) continue;
    out[k.slice(idx + anchor.length)] = v;
  }
  return out;
}

// Path is "../../../firmwares/motor/tsdz2/src" (repo root's firmware source),
// not a bare "../../../src" - that was this glob's original path before the
// "Move src/ and firmware/display/ under firmwares/" reorganization, and
// never got updated here. Since import.meta.glob's pattern is resolved at
// build time against literal files on disk, the stale path silently matched
// zero files instead of erroring - firmwareCH ended up `{}`, so every build
// failed immediately with "Can't open input file /main.c" (mcpp's own
// error, only surfaced after sdcc-build.ts's preprocess() started actually
// capturing mcpp's stdout/stderr - see that function's own comment).
// Confirmed broken the same way on the live public deploy, not just here.
const firmwareCH = relativeKeys(
  import.meta.glob("../../../firmwares/motor/tsdz2/src/**/*.{c,h}", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
  "/src/",
);
const firmwarePeep = relativeKeys(
  import.meta.glob("../../../firmwares/motor/tsdz2/src/peep.txt", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>,
  "/src/",
);
const runtimeFiles = relativeKeys(
  import.meta.glob("./wasm/stm8-runtime/**/*", { eager: true, query: "?raw", import: "default" }) as Record<
    string,
    string
  >,
  "stm8-runtime/",
);

const MAINSRC = "main.c";
const EXTRASRCS = [
  "ebike_app.c",
  "common.c",
  "torque_sensor.c",
  "uart.c",
  "pwm.c",
  "motor.c",
  "wheel_speed_sensor.c",
  "brake.c",
  "pas.c",
  "adc.c",
  "timers.c",
  "eeprom.c",
  "lights.c",
  "STM8S_StdPeriph_Lib/src/stm8s_iwdg.c",
  "STM8S_StdPeriph_Lib/src/stm8s_itc.c",
  "STM8S_StdPeriph_Lib/src/stm8s_clk.c",
  "STM8S_StdPeriph_Lib/src/stm8s_gpio.c",
  "STM8S_StdPeriph_Lib/src/stm8s_uart2.c",
  "STM8S_StdPeriph_Lib/src/stm8s_tim1.c",
  "STM8S_StdPeriph_Lib/src/stm8s_tim2.c",
  "STM8S_StdPeriph_Lib/src/stm8s_tim3.c",
  "STM8S_StdPeriph_Lib/src/stm8s_tim4.c",
  "STM8S_StdPeriph_Lib/src/stm8s_exti.c",
  "STM8S_StdPeriph_Lib/src/stm8s_adc1.c",
  "STM8S_StdPeriph_Lib/src/stm8s_flash.c",
] as const;

// Every symbol every stm8-runtime/{lib-asm,lib-c} file provides (from each
// file's own .globl/function declarations), used to link runtime helpers
// on demand instead of unconditionally. A native build gets this behavior
// for free: sdcc's default STM8 link implicitly appends a real stm8.lib
// archive, and archives only pull in members whose symbols are actually
// undefined at link time. Passing every runtime .rel directly on the
// linker command line (as an earlier version of this file did) doesn't get
// that - loose objects link unconditionally, whether referenced or not,
// which silently bloated every in-browser build with ~9 unused routines
// (setjmp/strcmp/strcpy/heap/memcpy/atomic_flag/mod*/etc, confirmed absent
// from a native link map of this exact firmware) and, worse, shifted every
// address after them - the real explanation for this build not matching a
// native one (see tools/CLAUDE.md's 2026-08-12 entries for the full story).
const HELPER_SYMBOLS: Record<string, string> = {
  _atomic_flag_test_and_set: "lib-asm/atomic_flag_test_and_set.s",
  __divsint: "lib-asm/_divsint.s",
  __divslong: "lib-asm/_divslong.s",
  __fast_long_neg: "lib-asm/_fast_long_neg.s",
  ___sdcc_heap_init: "lib-asm/heap.s",
  ___sdcc_heap: "lib-asm/heap.s",
  ___sdcc_heap_end: "lib-asm/heap.s",
  ___memcpy: "lib-asm/memcpy.s",
  _memcpy: "lib-asm/memcpy.s",
  __modsint: "lib-asm/_modsint.s",
  __modslong: "lib-asm/_modslong.s",
  __mulint: "lib-asm/_mulint.s",
  __mullong: "lib-asm/_mullong.s",
  ___mulsint2slong: "lib-asm/__mulsint2slong.s",
  ___muluint2ulong: "lib-asm/__mulsint2slong.s",
  ___mululonguchar2ulonglong: "lib-asm/__mululonguchar2ulonglong.s",
  ___setjmp: "lib-asm/setjmp.s",
  _longjmp: "lib-asm/setjmp.s",
  _strcmp: "lib-asm/strcmp.s",
  _strcpy: "lib-asm/strcpy.s",
  __divulong: "lib-c/_divulong.c",
  __modulong: "lib-c/_modulong.c",
  __muluchar: "lib-c/_muluchar.c",
  // _mulschar.c defines all 3 of these (signed*signed, unsigned*signed,
  // signed*unsigned char multiply) in one file - missing the latter two
  // here at first meant a real symbol (__muluschar, referenced by
  // ebike_app.c) never resolved even though the file providing it was
  // right there, caught by rerunning tools/CLAUDE.md's native link-map
  // comparison after the initial version of this map.
  __mulschar: "lib-c/_mulschar.c",
  __muluschar: "lib-c/_mulschar.c",
  __mulsuchar: "lib-c/_mulschar.c",
  ___sdcc_external_startup: "lib-c/_startup.c",
};

// Matches src/Makefile's CFLAGS for stm8 (PLATFORM=stm8, DEVICE=STM8S105).
const CFLAGS = ["-mstm8", "-DSTM8S105", "-Ddouble=float", "--std-c23", "--nolospre", "--opt-code-speed", "--peep-asm"];

// Exact -D set the real sdcc driver passes to its preprocessor for these
// CFLAGS (-mstm8 --opt-code-speed, default model/stack-auto for the stm8
// port) - captured via `sdcc -mstm8 -DSTM8S105 --opt-code-speed -c
// --verbose` and reading the "sdcc: sdcpp ..." line it prints even without
// sdcpp installed (SDCCmain.c logs the argv before spawning it). Version
// macros (4.5.0) match vendor/sdcc's pinned commit - re-verify these
// against a native build of the same pin whenever vendor/sdcc is upgraded,
// since nothing else in this file catches a stale value (no firmware
// source or SDCC header conditionally compiles on __SDCC_VERSION_*, so a
// mismatch here is silently wrong metadata, not a build failure).
const SDCC_PREDEFINES = [
  "STM8S105",
  "__SDCC_STACK_AUTO",
  "__SDCC_CHAR_UNSIGNED",
  "__SDCC_MODEL_MEDIUM",
  "__SDCC_OPTIMIZE_SPEED",
  "__SDCC_INT_LONG_REENT",
  "__SDCC_FLOAT_REENT",
  "__SDCCCALL=1",
  "__SDCC=4_5_0",
  "__SDCC_VERSION_MAJOR=4",
  "__SDCC_VERSION_MINOR=5",
  "__SDCC_VERSION_PATCH=0",
  "__SDCC_REVISION=0",
  "__SDCC_stm8",
  "__STDC_NO_COMPLEX__=1",
  "__STDC_NO_THREADS__=1",
  "__STDC_NO_ATOMICS__=1",
  "__STDC_NO_VLA__=1",
  "__STDC_ISO_10646__=201409L",
  "__SIZEOF_FLOAT__=4",
  "__SIZEOF_DOUBLE__=4",
  "__SDCC_BITINT_MAXWIDTH=64",
];

// ---- Module loading -------------------------------------------------------

async function loadFactory(name: string): Promise<ModuleFactory> {
  const mod = (await import(`./wasm/${name}.mjs`)) as { default: ModuleFactory };
  return mod.default;
}

class BuildError extends Error {}

async function runModule(
  factory: ModuleFactory,
  args: string[],
  stdinText: string | null,
  files: Record<string, string>,
  onLog: LogFn,
): Promise<{ mod: EmModule; rc: number }> {
  let idx = 0;
  const bytes = stdinText != null ? new TextEncoder().encode(stdinText) : null;
  const mod = await factory({
    print: onLog,
    printErr: onLog,
    noInitialRun: true,
    ...(bytes ? { stdin: () => (idx < bytes.length ? bytes[idx++] : null) } : {}),
  });
  for (const [name, content] of Object.entries(files)) {
    const dir = name.slice(0, name.lastIndexOf("/"));
    if (dir) mod.FS.mkdirTree(dir);
    mod.FS.writeFile(name, content);
  }
  let rc: number;
  try {
    rc = mod.callMain(args);
  } catch (e) {
    const status = (e as { status?: number }).status;
    rc = typeof status === "number" ? status : -1;
  }
  return { mod, rc };
}

async function preprocess(cFile: string, allFiles: Record<string, string>, onLog: LogFn): Promise<string> {
  const factory = await loadFactory("mcpp");
  // mcpp's own diagnostics (which macro/line actually failed - the one
  // thing worth showing on failure) go to its stdout/stderr callbacks, not
  // necessarily /mcpp.err (that file isn't always written - depends on
  // which internal error path mcpp took), so both are captured here rather
  // than relying on the file alone. Previously this passed `() => {}`
  // (discarded), which meant a preprocessing failure surfaced as a bare
  // "Preprocessing main.c failed" with no way to tell why - this fixes
  // that; see sdcc-build.ts's caller for how the two are combined below.
  const captured: string[] = [];
  const { mod, rc } = await runModule(
    factory,
    [
      ...SDCC_PREDEFINES.flatMap((d) => ["-D", d]),
      "-I",
      "/STM8S_StdPeriph_Lib/inc",
      "-I",
      "/",
      "-I",
      "/include",
      "-Q",
      "/" + cFile,
      "/out.i",
    ],
    null,
    Object.fromEntries(Object.entries(allFiles).map(([k, v]) => ["/" + k, v])),
    (line) => captured.push(line),
  );
  if (rc !== 0) {
    let fileDetail = "";
    try {
      fileDetail = mod.FS.readFile("/mcpp.err", { encoding: "utf8" });
    } catch {
      // no mcpp.err written - captured output (below) is the fallback
    }
    const detail = [captured.join("\n"), fileDetail].filter(Boolean).join("\n") || "(mcpp gave no diagnostic output)";
    onLog(detail);
    throw new BuildError(`Preprocessing ${cFile} failed`);
  }
  return mod.FS.readFile("/out.i", { encoding: "utf8" });
}

async function compile(cFile: string, iText: string, peepTxt: string, onLog: LogFn): Promise<string> {
  const modName = cFile.slice(cFile.lastIndexOf("/") + 1).replace(/\.c$/, "");
  const factory = await loadFactory("sdcc");
  const { mod, rc } = await runModule(
    factory,
    [...CFLAGS, "--peep-file", "/peep.txt", "--c1mode", "-o", `/${modName}.asm`],
    iText,
    { "/peep.txt": peepTxt },
    onLog,
  );
  if (rc !== 0) throw new BuildError(`Compiling ${cFile} failed`);
  return mod.FS.readFile(`/${modName}.asm`, { encoding: "utf8" });
}

async function assemble(name: string, asmText: string, onLog: LogFn): Promise<string> {
  const modName = name.slice(name.lastIndexOf("/") + 1).replace(/\.(c|s|asm)$/, "");
  const factory = await loadFactory("sdasstm8");
  const { mod, rc } = await runModule(
    factory,
    ["-plosgffwy", `/${modName}.asm`],
    null,
    { [`/${modName}.asm`]: asmText },
    onLog,
  );
  if (rc !== 0) throw new BuildError(`Assembling ${name} failed`);
  return mod.FS.readFile(`/${modName}.rel`, { encoding: "utf8" });
}

/**
 * Yields to the browser's render loop. The mcpp/sdcc/sdasstm8/sdldstm8 WASM
 * modules run `callMain()` synchronously (no pthreads/workers), which blocks
 * the main thread for the duration of each compile/assemble/link step - a
 * DOM mutation made via onLog() right before that call isn't guaranteed to
 * actually get painted first, since a resolved-but-not-yet-scheduled
 * microtask doesn't force a frame. Awaiting this after every onLog() forces
 * one, so "Building X..." is reliably visible before the next multi-second
 * block starts, instead of the whole ~30s build looking frozen until it
 * finishes and dumps the full log at once.
 */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Runs sdldstm8 once against the given object sets. Never throws on a nonzero/warning exit - callers decide what a missing main.ihx or leftover log warnings mean. */
async function linkOnce(
  rels: Record<string, string>,
  helperRels: Record<string, string>,
  onLog: LogFn,
): Promise<{ hex: string | null; log: string[] }> {
  const log: string[] = [];
  const allRels = { ...rels, ...helperRels };
  const linkFactory = await loadFactory("sdldstm8");
  // -b HOME=0x8000: stm8/main.c sets options.code_loc = 0x8000 as the port
  // default, normally written to the linker command file by SDCCmain.c -
  // invoking sdld directly bypasses that, so it must be passed explicitly
  // or the CODE/HOME area lands near address 0 instead of real STM8 flash.
  const { mod } = await runModule(
    linkFactory,
    ["-mjwx", "-b", "HOME=0x8000", "-i", "/main.ihx", ...Object.keys(allRels).map((n) => "/" + n)],
    null,
    Object.fromEntries(Object.entries(allRels).map(([k, v]) => ["/" + k, v])),
    (line) => {
      log.push(line);
      onLog(line);
    },
  );
  try {
    return { hex: mod.FS.readFile("/main.ihx", { encoding: "utf8" }), log };
  } catch {
    return { hex: null, log };
  }
}

/** Builds firmware.hex from the given config.h text. Throws BuildError with a message suitable for display on failure; progress/tool output goes to onLog. */
export async function buildFirmwareHex(configH: string, onLog: LogFn): Promise<string> {
  const allFiles: Record<string, string> = { ...firmwareCH, ...runtimeFiles, "config.h": configH };
  const peepTxt = firmwarePeep["peep.txt"];

  const rels: Record<string, string> = {};
  const buildFiles = [MAINSRC, ...EXTRASRCS];
  for (const [i, cFile] of buildFiles.entries()) {
    onLog(`Building ${cFile}... (${i + 1}/${buildFiles.length})`);
    await frame();
    const iText = await preprocess(cFile, allFiles, onLog);
    const asmText = await compile(cFile, iText, peepTxt, onLog);
    const relName = cFile.slice(cFile.lastIndexOf("/") + 1).replace(/\.c$/, ".rel");
    rels[relName] = await assemble(cFile, asmText, onLog);
  }

  // Pull in stm8-runtime helpers on demand: link with none, see which
  // symbols come back undefined, compile+assemble just those files, link
  // again, repeat until nothing new turns up. Mirrors what a real archive
  // link does automatically (see HELPER_SYMBOLS above for why this matters
  // - it's not just an optimization, an earlier unconditional-link version
  // of this file produced hexes that didn't match a native build).
  const helperRels: Record<string, string> = {};
  const includedHelperFiles = new Set<string>();
  let discovery = await linkOnce(rels, helperRels, () => {});
  for (let iteration = 0; iteration < 10; iteration++) {
    const missing = parseUndefinedGlobals(discovery.log);
    const newFiles = nextHelperFiles(missing, HELPER_SYMBOLS, includedHelperFiles);
    if (newFiles.length === 0) break;
    for (const file of newFiles) {
      includedHelperFiles.add(file);
      const name = file.slice(file.lastIndexOf("/") + 1);
      const source = runtimeFiles[file];
      onLog(`Resolving runtime helper ${name}...`);
      await frame();
      if (file.startsWith("lib-asm/")) {
        helperRels[name.replace(/\.s$/, ".rel")] = await assemble(name, source, () => {});
      } else {
        const iText = await preprocess(name, { ...allFiles, [name]: source }, () => {});
        const asmText = await compile(name, iText, peepTxt, () => {});
        helperRels[name.replace(/\.c$/, ".rel")] = await assemble(name, asmText, () => {});
      }
    }
    discovery = await linkOnce(rels, helperRels, () => {});
  }

  onLog("Linking...");
  await frame();
  const { hex } = await linkOnce(rels, helperRels, onLog);
  // A nonzero sdld exit here (still possible even on success - its exit
  // code reflects whether any diagnostics were printed) is fine as long as
  // main.ihx exists. Any remaining "Undefined Global" warning at this point
  // is either genuinely benign (nothing else calls it, same as a real
  // native build - e.g. no known-firmware config exercises every possible
  // symbol) or a real problem outside HELPER_SYMBOLS' coverage; either way
  // it's now visible in the log above for a human to judge, instead of
  // being silently paved over the way the old unconditional-link version
  // of this function was.
  if (hex == null) throw new BuildError("Linking failed - see log above.");
  return hex;
}

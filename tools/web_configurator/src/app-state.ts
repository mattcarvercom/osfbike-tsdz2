// Shared app state, dirty-tracking, and session (localStorage) persistence -
// the "model" layer every render/*.ts module reads/mutates. No DOM building
// here (see dom.ts) and no page-specific rendering (see render/*.ts).

import type { FieldValues } from "./ini-import.ts";
import { defaultValues } from "./defaults.ts";
import { SECTIONS, buildControls, type Control } from "./ui-model.ts";
import type { ConnectedProgrammer } from "./usb-transport.ts";
import { valuesAreDirty, validPage as sessionValidPage, loadedFileNameIsDirty, type Session } from "./session.ts";

// Real semver, bumped by hand on a change worth calling out to whoever's
// using the tool - unlike releases/motor/*.hex (which stay dated, matching
// this repo's own firmware-release convention), this is a UI/tool version,
// where "what changed" matters more than "when". Paired with an automatic
// build date (footer.ts renders both together) so a bug report/forum link
// always carries both "which version" and "when this exact build was made",
// without relying on the version number alone to have been bumped recently.
export const APP_VERSION = "v1.0.0";
// __APP_BUILD_DATE__ is injected by vite.config.ts's `define` at build time
// (see vite-env.d.ts for the ambient declaration) - always today's date for
// `npm run dev`/`npm run build`, never hand-maintained.
export const APP_BUILD_DATE: string = __APP_BUILD_DATE__;

// Split into two pages (2026-08-19): Build (in-browser SDCC compile, no
// hardware needed) is a genuinely different workflow from Backup & flash
// (everything that needs a connected ST-Link - backing up, restoring, and
// flashing either a just-built hex or a picked built-in release).
export const BUILD_PAGE = "build";
export const BACKUP_FLASH_PAGE = "backup-flash";
/** Its own top-level nav tab, deliberately separate from BUILD_PAGE/BACKUP_FLASH_PAGE (motor firmware) - see render/display-flash-page.ts. */
export const DISPLAY_FLASH_PAGE = "display-flash";
/** Runs the real 860C/850C display UI logic (Color_LCD_860C's own C source, compiled to WASM - see wasm-display-sim/) in a canvas, with fake telemetry - a way to iterate on look/feel without flashing real hardware. See render/display-sim-page.ts. */
export const DISPLAY_SIM_PAGE = "display-sim";

// Pro mode's own localStorage key (persisted separately from AUTOSAVE_KEY,
// see TOPBAR_COLLAPSED_KEY further down for the same reasoning - a tool
// preference, not part of the loaded config). Declared up here, ahead of
// `state` below, because `state`'s own initializer calls loadProMode() at
// module-eval time - a `const` declared after that point would still be in
// its temporal dead zone when read, throwing a ReferenceError that
// loadProMode()'s try/catch would swallow silently, always falling back to
// false. (Exactly what happened here until this got moved - caught only by
// actually reloading the page and watching Pro mode fail to persist.)
const PRO_MODE_KEY = "tsdz2-configurator-pro-mode";

function loadProMode(): boolean {
  try {
    return localStorage.getItem(PRO_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

// Same "own key, own load function, module-eval-time initializer" pattern as
// PRO_MODE_KEY just above, and for the same reason: which display board
// revision/firmware source you're bench-testing against is a tool
// preference tied to this browser/adapter setup, not part of a loaded
// .tsdz2.json config - it shouldn't reset to the default every time the tab
// reloads (reported 2026-08-23: wanted the target picker to remember its
// last selection across sessions).
const DISPLAY_TARGET_KEY = "tsdz2-configurator-display-target";
const VALID_DISPLAY_TARGETS: AppState["displayTarget"][] = [
  "860C_V13",
  "860C_V12",
  "860C",
  "850C",
  "850C_2021",
  "SW102",
];

function loadDisplayTarget(): AppState["displayTarget"] {
  try {
    const raw = localStorage.getItem(DISPLAY_TARGET_KEY);
    if (raw && (VALID_DISPLAY_TARGETS as string[]).includes(raw)) return raw as AppState["displayTarget"];
  } catch {
    // localStorage full/unavailable/disabled - fall through to the default below
  }
  return "860C_V13";
}

/** Sets state.displayTarget and persists it - the only way any code should change it, so the localStorage write and the live state field never drift apart (same shape as setProMode below). */
export function setDisplayTarget(target: AppState["displayTarget"]): void {
  state.displayTarget = target;
  try {
    localStorage.setItem(DISPLAY_TARGET_KEY, target);
  } catch {
    // localStorage full/unavailable/disabled - a convenience, not required
  }
}

// Same reasoning/pattern again: whether the display-flash release picker
// shows emmebrusa/Color_LCD_860C's stock releases (releases/display/legacy/)
// alongside this project's own osf.bike builds, or hides them by default -
// reported 2026-08-23: "should always default to osf.bike firmwares in the
// picker and not an emmebrusa one", with an explicit toggle to opt back in.
const SHOW_LEGACY_DISPLAY_FIRMWARES_KEY = "tsdz2-configurator-show-legacy-display-firmwares";

function loadShowLegacyDisplayFirmwares(): boolean {
  try {
    return localStorage.getItem(SHOW_LEGACY_DISPLAY_FIRMWARES_KEY) === "true";
  } catch {
    return false;
  }
}

export function setShowLegacyDisplayFirmwares(enabled: boolean): void {
  state.showLegacyDisplayFirmwares = enabled;
  try {
    localStorage.setItem(SHOW_LEGACY_DISPLAY_FIRMWARES_KEY, String(enabled));
  } catch {
    // localStorage full/unavailable/disabled - a convenience, not required
  }
}

export interface AppState {
  values: FieldValues;
  /** Snapshot taken at the last known-on-disk point (initial defaults, import, load, reset, or a completed Save As) - the reference "changed field" highlighting and the unsaved-changes prompt compare against. */
  baselineValues: FieldValues;
  /** Provenance embedded in a saved .tsdz2.json (the .ini it was ultimately derived from, if any) - carried through load/save round trips. Not the same as "what file is currently loaded"; see loadedFileName for that. */
  sourceImport: string | null;
  /** Free-text, user-authored - saved/loaded with the .tsdz2.json (see Tsdz2ConfigFile.notes), not a firmware setting. Participates in isDirty()/syncBaseline() alongside values so an edited-but-unsaved note gets the same "unsaved changes" warning as any other edit, via baselineNotes below. */
  notes: string;
  baselineNotes: string;
  currentFileBaseName: string;
  /** `${currentFileBaseName}.tsdz2.json`, or null if nothing's been loaded (still on firmware defaults) - always this tool's own canonical extension, even right after importing an .ini (see fileInputIni's change handler): an import converts into this tool's format immediately, it's never displayed as "still an .ini" first. Drives the "Loaded: X" header badge - unlike sourceImport, this always reflects the file just opened/saved, even when sourceImport carries over unchanged .ini provenance from a previous load. Editable in place via the badge's rename pencil (base name only - the extension isn't user-choosable) - that never touches the filesystem, but does drive Save As's filename, firmware.hex's filename, and everywhere else currentFileBaseName is read. */
  loadedFileName: string | null;
  /** loadedFileName's baseline - see baselineNotes above for the same reasoning, applied to a rename instead of a note edit. */
  baselineLoadedFileName: string | null;
  /** Sidebar selection - a SECTIONS[].id, BUILD_PAGE, BACKUP_FLASH_PAGE, or DISPLAY_FLASH_PAGE. Survives re-renders (not reset by editing/import/etc). */
  activePage: string;
  /** Status/warning line from the last file operation (import/load/save/reset). Lives in state, not a local DOM node, because it must survive the renderApp() call the handler that sets it always makes next. */
  statusMessage: string | null;
  /** Styling for statusMessage: "error" (red + alert-triangle icon) for a hard failure that changed nothing (Import/Load threw); "warning" (amber) for a load that succeeded but had to default some missing/predating fields; "info" (plain/muted) for a plain notice like "Saved...". Meaningless when statusMessage is null. */
  statusKind: "info" | "warning" | "error";
  programmer: ConnectedProgrammer | null;
  /** Set when the last WebUSB connect attempt threw, cleared on the next attempt or a success - drives the sidebar chip's error (red) state, same lifecycle reasoning as buildError below. */
  connectionError: string | null;
  firmwareHexName: string | null;
  firmwareHexText: string | null;
  /** Where firmwareHexText came from - "built" via the in-browser SDCC build, "chosen" via the Flash panel's "Choose firmware.hex…" picker. Both write the same firmwareHexText/firmwareHexName pair (whichever is active is what Flash actually writes to the MCU), but the Build panel's success line must only claim "Built ..." when it's actually the thing that built it - see renderBuildPanel(). null alongside a null firmwareHexText (nothing loaded either way). */
  firmwareHexSource: "built" | "chosen" | null;
  /** Set on a failed build, cleared on the next build attempt or a successful one - otherwise the error only ever existed in the log box's scroll history, since the status line is recomputed from scratch on every renderApp() and would silently drop it. */
  buildError: string | null;
  flashing: boolean;
  building: boolean;
  backingUp: boolean;
  restoring: boolean;
  /** Display firmware target selection - see render/display-flash-page.ts. Determines which WASM entry point (stm32_flash_write_hex vs nrf51_flash_write_hex) a flash uses, and (for the 3 860C pin-revision variants) which built-in releases the picker offers. Persisted separately (see DISPLAY_TARGET_KEY below) - a tool/bench preference, not part of the loaded firmware config, same reasoning as proMode. */
  displayTarget: "860C_V13" | "860C_V12" | "860C" | "850C" | "850C_2021" | "SW102";
  displayHexName: string | null;
  displayHexText: string | null;
  displayFlashing: boolean;
  /** UART bootloader connection (860C/850C) - see uart-transport.ts. A separate Web Serial connection from `programmer` above (WebUSB/ST-Link), since these are two independent browser APIs/devices that can both be connected at once. */
  uartPort: SerialPort | null;
  uartConnectionError: string | null;
  /** Raw firmware bytes (a prebuilt `.bin`, not Intel HEX - the UART bootloader protocol has its own fixed addressing scheme) for uart-flasher.ts's flashUartBin(). */
  displayBinName: string | null;
  displayBinBytes: Uint8Array | null;
  uartFlashing: boolean;
  /** Whether motor-handshake.ts's emulator is currently running on uartPort - see render/display-flash-page.ts. Mutually exclusive with flashing (the emulator needs the port reopened at a different baud rate than the bootloader protocol), so every flash control disables while this is true. */
  uartMotorHandshakeActive: boolean;
  /**
   * Live progress lines for the async WebUSB/WebSerial/build operations
   * below. Live in state, not local DOM nodes, for the same reason as
   * statusMessage above: onclick handlers call renderApp() (a full
   * app.innerHTML="" + rebuild) as soon as an operation starts so the
   * "…ing" button label and disabled states show immediately, which orphans
   * any DOM node a log closure captured before that call. A log appender
   * that instead pushes here and calls renderApp() itself always reads its
   * own latest output back out on the next rebuild, so nothing written
   * mid-operation is lost.
   */
  buildLog: string[];
  flashLog: string[];
  backupLog: string[];
  restoreLog: string[];
  displayFlashLog: string[];
  uartFlashLog: string[];
  /**
   * "I know what I'm doing" override - when true, every field's own
   * `dependsOn` (DZ40-dead fields, "needs X enabled first" gating, etc) is
   * bypassed app-wide (see controlEnabled() below, the single choke point
   * every render/*.ts dependsOn check now goes through instead of calling
   * `c.dependsOn(state.values)` directly). Purely a tool-UI preference, not
   * a firmware setting - never part of FieldValues/RAW_FIELDS, never
   * written to config.h, never round-tripped through a .ini/.tsdz2.json,
   * and deliberately excluded from isDirty()/baseline/session-restore (see
   * loadProMode/setProMode's own separate localStorage key above) for the
   * same reason loadTopbarCollapsed/saveTopbarCollapsed are: it's display
   * state, not loaded config.
   */
  proMode: boolean;
  /** Whether the display-flash release picker also offers emmebrusa/Color_LCD_860C's stock releases (releases/display/legacy/), not just this project's own osf.bike builds - see setShowLegacyDisplayFirmwares above for persistence. */
  showLegacyDisplayFirmwares: boolean;
}

export const state: AppState = {
  values: defaultValues(),
  baselineValues: defaultValues(),
  sourceImport: null,
  notes: "",
  baselineNotes: "",
  currentFileBaseName: "config",
  loadedFileName: null,
  baselineLoadedFileName: null,
  activePage: SECTIONS[0].id,
  statusMessage: null,
  statusKind: "info",
  programmer: null,
  connectionError: null,
  firmwareHexName: null,
  firmwareHexText: null,
  firmwareHexSource: null,
  buildError: null,
  flashing: false,
  building: false,
  backingUp: false,
  restoring: false,
  displayTarget: loadDisplayTarget(),
  displayHexName: null,
  displayHexText: null,
  displayFlashing: false,
  uartPort: null,
  uartConnectionError: null,
  displayBinName: null,
  displayBinBytes: null,
  uartFlashing: false,
  uartMotorHandshakeActive: false,
  buildLog: [],
  flashLog: [],
  backupLog: [],
  restoreLog: [],
  displayFlashLog: [],
  uartFlashLog: [],
  proMode: loadProMode(),
  showLegacyDisplayFirmwares: loadShowLegacyDisplayFirmwares(),
};

export const controls = buildControls();

/** Refresh callbacks for every currently-mounted assist curve chart, so assistLevel5Percent's own bespoke input handler (which skips a full renderApp() for keystroke responsiveness) can still keep charts elsewhere on the same page in sync live. Cleared (via .length = 0, not reassignment - this is a live-bound export, see render/app-shell.ts) and repopulated on every renderApp() - see there. */
export const assistChartUpdaters: Array<() => void> = [];

// ---- Dirty tracking, session persistence (localStorage), unsaved-changes --
//
// Two separate things share one localStorage entry:
//  1. Session continuity - whatever's currently loaded/active (values,
//     baseline, source filename) should survive a refresh, dirty or not.
//     Written on every state change, always - NOT conditional on isDirty().
//     (An earlier version only wrote when dirty, which meant importing an
//     .ini - which immediately syncs baseline back to clean - erased the
//     session instead of saving it: load .ini, refresh, back to blank
//     defaults, name gone. That's the bug this comment is here to prevent
//     reintroducing.)
//  2. Unsaved-edit recovery - on startup, if the persisted session was
//     dirty (values differ from its own baseline) when last written, that's
//     real at-risk work (tab closed/crashed before a Save As), so offer to
//     restore or discard it rather than silently dropping the user back
//     into the middle of an edit. A clean session just loads straight in.

const AUTOSAVE_KEY = "tsdz2-configurator-autosave";

// ---- Mobile topbar collapse state (persisted separately from AUTOSAVE_KEY -
// this is display/UI state, not part of the loaded config, so it has nothing
// to do with isDirty()/the restore banner and shouldn't bloat Session's own
// shape) ----------------------------------------------------------------

const TOPBAR_COLLAPSED_KEY = "tsdz2-configurator-topbar-collapsed";

/** Only ever visually relevant under the mobile breakpoint (.topbar-collapsible.collapsed is scoped inside that media query in render/topbar.css) - computing it unconditionally here anyway, rather than gating on matchMedia too, means this persisted value is the single source of truth regardless of viewport. Defaults to collapsed (true) the first time this ever runs on a given browser, matching this feature's pre-existing default before it was made to persist at all. */
export function loadTopbarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(TOPBAR_COLLAPSED_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function saveTopbarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(TOPBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // localStorage full/unavailable/disabled - same as persistSession(), a convenience, not required
  }
}

// ---- Pro mode's remaining pieces (PRO_MODE_KEY/loadProMode itself declared
// up near `state` above - see that comment for why) ------------------------

/** Flips state.proMode and persists it - the only way any code should change it, so the localStorage write and the live state field never drift apart. */
export function setProMode(enabled: boolean): void {
  state.proMode = enabled;
  try {
    localStorage.setItem(PRO_MODE_KEY, String(enabled));
  } catch {
    // localStorage full/unavailable/disabled - same as persistSession(), a convenience, not required
  }
}

/**
 * Single choke point for "should this control be interactive right now" -
 * every render/*.ts spot that used to call `c.dependsOn(state.values)`
 * directly now calls this instead, so Pro mode's override only has to be
 * taught to one place. Absent dependsOn still means always-enabled,
 * regardless of Pro mode.
 */
export function controlEnabled(c: Control): boolean {
  return state.proMode === true || !c.dependsOn || c.dependsOn(state.values);
}

export function controlKeys(c: Control): string[] {
  return c.kind === "radio" ? c.groupKeys : [c.key];
}

export function controlChanged(c: Control): boolean {
  return controlKeys(c).some((k) => state.values[k] !== state.baselineValues[k]);
}

/** Resets one control's value(s) back to the baseline (last import/load/reset/Save As) - a radio control's whole group of raw keys together, since they're one logical choice, not independently revertable. */
export function revertControl(c: Control): void {
  for (const k of controlKeys(c)) state.values[k] = state.baselineValues[k];
  persistSession();
}

/** Resets every control in one sidebar section back to baseline - the section-level counterpart to revertControl(), used by the sidebar's per-section revert icon. Single persistSession() at the end instead of reusing revertControl() per field, so a section with many changed fields doesn't write to localStorage once per field. */
export function revertSection(sectionId: string): void {
  for (const c of controls) {
    if (c.section !== sectionId) continue;
    for (const k of controlKeys(c)) state.values[k] = state.baselineValues[k];
  }
  persistSession();
}

export function isDirty(): boolean {
  return (
    valuesAreDirty(state.values, state.baselineValues) ||
    state.notes !== state.baselineNotes ||
    state.loadedFileName !== state.baselineLoadedFileName
  );
}

/** Persists the current session (whatever's loaded, edited or not). Call after every state change. */
export function persistSession() {
  try {
    const session: Session = {
      values: state.values,
      baselineValues: state.baselineValues,
      sourceImport: state.sourceImport,
      notes: state.notes,
      baselineNotes: state.baselineNotes,
      currentFileBaseName: state.currentFileBaseName,
      loadedFileName: state.loadedFileName,
      baselineLoadedFileName: state.baselineLoadedFileName,
      activePage: state.activePage,
      firmwareHexText: state.firmwareHexText,
      firmwareHexName: state.firmwareHexName,
      firmwareHexSource: state.firmwareHexSource,
      buildError: state.buildError,
      savedAt: Date.now(),
    };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(session));
  } catch {
    // localStorage full/unavailable/disabled - session persistence is a convenience, not required
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function sessionIsDirty(session: Session): boolean {
  return (
    valuesAreDirty(session.values, session.baselineValues) ||
    (session.notes ?? "") !== (session.baselineNotes ?? "") ||
    loadedFileNameIsDirty(session)
  );
}

/** Falls back to the first section when a persisted session's activePage is missing (older session shape) or stale (e.g. a section was renamed). */
export function validPage(id: string | undefined): string {
  return sessionValidPage(
    id,
    [BUILD_PAGE, BACKUP_FLASH_PAGE, DISPLAY_FLASH_PAGE, DISPLAY_SIM_PAGE, ...SECTIONS.map((s) => s.id)],
    SECTIONS[0].id,
  );
}

/** Call whenever the current values become the new known-on-disk state (import/load/reset/save-as). */
export function syncBaseline() {
  state.baselineValues = { ...state.values };
  state.baselineNotes = state.notes;
  state.baselineLoadedFileName = state.loadedFileName;
  persistSession();
}

/** Call whenever the whole config is replaced wholesale (import/load/reset, not a Save As or an in-place field edit) - a previously built firmware.hex was compiled from the old values and no longer matches what's loaded. Also clears buildLog/flashLog: their transcripts describe that now-invalidated hex too (which file built/flashed, whether it succeeded), so leaving them behind reads as current status for a firmware.hex that no longer exists. */
export function clearBuiltFirmware() {
  state.firmwareHexText = null;
  state.firmwareHexName = null;
  state.firmwareHexSource = null;
  state.buildError = null;
  state.buildLog = [];
  state.flashLog = [];
}

/**
 * Call at the top of any page render that reads/shows a built firmware.hex -
 * currently render/build-page.ts (build status/log) and
 * render/backup-flash-page.ts (the Flash panel flashes state.firmwareHexText).
 * A field edit, rename, notes edit, anything isDirty() tracks means a
 * firmware.hex already built (or manually chosen via "Choose firmware.hex…")
 * no longer reflects what's configured: wrong content after a settings
 * change, wrong filename after a rename. Clearing it here (rather than
 * merely disabling Download/Flash) forces an explicit Rebuild or re-Choose
 * instead of silently downloading/flashing something that doesn't match
 * anymore - also clears the build/flash transcripts, which describe that
 * now-invalidated hex. Guarded on there being something to clear, so this
 * is a one-time transition per edit, not a mutation on every render.
 */
export function clearStaleFirmwareHex() {
  if (isDirty() && (state.firmwareHexText || state.buildLog.length > 0 || state.flashLog.length > 0)) {
    clearBuiltFirmware();
    persistSession();
  }
}

/**
 * Deliberately NOT gated on isDirty() - ordinary field edits are already
 * safe to lose, since persistSession() autosaves every one of them to
 * localStorage as it happens (see markChanged() and friends in
 * render/control.ts), and Chrome/Edge/Brave/Opera all show their own native
 * "restore this page's inputs" prompt on top of this one regardless, so
 * warning here too was just a second, redundant dialog for a risk that's
 * already covered.
 *
 * What isn't covered anywhere else: reloading or closing the tab mid-flash,
 * mid-backup, or mid-restore would silently cut off a live WebUSB transfer
 * to/from the MCU - unlike a lost edit, an interrupted flash write can
 * leave the chip in a genuinely bad state, not just something to retype.
 * building has no WebUSB risk (it's pure WASM compute, nothing touches the
 * board) but still costs ~30s to redo, so it's included too. uartFlashing
 * carries the same live-transfer risk as flashing, just over Web Serial
 * instead of WebUSB.
 */
window.addEventListener("beforeunload", (e) => {
  if (!state.flashing && !state.building && !state.backingUp && !state.restoring && !state.uartFlashing) return;
  e.preventDefault();
  e.returnValue = "";
});

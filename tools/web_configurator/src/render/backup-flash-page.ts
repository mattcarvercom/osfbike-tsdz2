import "./build-flash-page.css"; // .card/.flash-status*/.flash-log/.subtitle - shared with build-page.ts and display-flash-page.ts
import "./app-shell.css"; // .page/.page-title
import "../dom.css"; // .toolbar/.btn-*
import { connectStLink, disconnectStLink, webUsbAvailable } from "../usb-transport.ts";
import { flashHex, readBackupArea, restoreBackupArea, type BackupArea } from "../flasher.ts";
import { state, persistSession, clearStaleFirmwareHex } from "../app-state.ts";
import { el, icon, iconButton, downloadBytes } from "../dom.ts";
import { renderApp } from "./app-shell.ts";
import { fetchMotorReleaseCatalog, loadMotorRelease } from "../firmware-catalog.ts";

// Module-level cache, not AppState - this is a read-only reflection of
// what's on disk under releases/motor/ right now, not user data (nothing here
// participates in isDirty()/session persistence). motorCatalogPromise guards
// against renderFlashPanel (called on every renderApp()) kicking off a new
// fetch on every re-render while the first one is still in flight.
let motorCatalog: string[] | null = null;
let motorCatalogPromise: Promise<void> | null = null;
/** Which catalog entry the release <select> is currently on - kept out here, not just read off the DOM at click time, because a full renderApp() rebuilds the <select> from scratch on every state change (e.g. a flash-progress log line), which would otherwise silently reset it back to the first option mid-flash. Defaults to the newest release (index 0 - see firmware-manifest-plugin.ts's mtime-descending sort) the first time the catalog loads. */
let selectedMotorRelease: string | null = null;
function ensureMotorCatalog(app: HTMLElement): void {
  if (motorCatalog !== null || motorCatalogPromise) return;
  motorCatalogPromise = fetchMotorReleaseCatalog().then((names) => {
    motorCatalog = names;
    selectedMotorRelease = names[0] ?? null;
    renderApp(app);
  });
}

/** Local-time compact timestamp for backup filenames, e.g. "20260812-014530" - matches the repo's own releases/motor/backup/ naming convention closely enough without depending on it. */
function backupTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Everything that needs a physical ST-Link connected: connect/disconnect,
 * backup/restore, and flashing (either a hex built on the Build page, a
 * manually chosen file, or a built-in motor release picked directly). Split
 * off from Build (2026-08-19) - that page is a pure config→hex compile with
 * no hardware involved, this one is nothing but hardware.
 */
export function renderBackupFlashPage(app: HTMLElement): HTMLElement {
  clearStaleFirmwareHex();

  return el("div", { className: "page" }, [
    el("h2", { className: "page-title" }, [icon("buildFlash"), document.createTextNode(" Backup & flash")]),
    renderConnectionPanel(app),
    renderBackupPanel(app),
    renderFlashPanel(app),
  ]);
}

/** Connect/disconnect control shared by the backup and flash panels below - both need the same ST-Link WebUSB connection, so this only appears once instead of duplicating a connect button per panel. */
export function renderConnectionPanel(app: HTMLElement): HTMLElement {
  if (!webUsbAvailable()) {
    return el("section", { className: "card" }, [
      el("h3", {}, [icon("plug"), document.createTextNode(" ST-Link connection (WebUSB)")]),
      el("p", { className: "flash-status", text: "WebUSB is not available in this browser." }),
    ]);
  }

  const statusLine = el(
    "p",
    {
      className: `flash-status${state.connectionError ? " flash-status-error" : state.programmer ? " flash-status-success" : ""}`,
    },
    [
      state.connectionError ? icon("exclamationCircle") : state.programmer ? icon("check") : null,
      document.createTextNode(
        state.connectionError
          ? `Connect failed: ${state.connectionError}`
          : state.programmer
            ? `Connected: ST-Link (type ${state.programmer.usbType})`
            : "Not connected.",
      ),
    ],
  );

  const connectBtn = iconButton("plug", state.programmer ? "Disconnect" : "Connect ST-Link…", {
    className: state.programmer ? "btn-success" : "btn-accent",
    disabled: state.flashing || state.backingUp || state.restoring || state.displayFlashing,
    onclick: async () => {
      if (state.programmer) {
        await disconnectStLink(state.programmer.device);
        state.programmer = null;
        renderApp(app);
        return;
      }
      state.connectionError = null;
      try {
        state.programmer = await connectStLink();
      } catch (err) {
        state.connectionError = (err as Error).message;
        renderApp(app);
        return;
      }
      renderApp(app);
    },
  });

  return el("section", { className: "card" }, [
    el("h3", {}, [icon("plug"), document.createTextNode(" ST-Link connection (WebUSB)")]),
    el("p", {
      className: "subtitle",
      text: "Requires an ST-Link V2/V21/V3 (clone or genuine) wired to the controller's SWIM header, and Chrome, Edge, Brave or Opera served over http://localhost or https://. Shared by backup and flash below - connect once. Unlike the rest of this page, the connection itself can't survive a refresh (a WebUSB/browser limitation, not saved state) - reconnect if you reload.",
    }),
    statusLine,
    el("div", { className: "toolbar" }, [connectBtn]),
  ]);
}

/** Reads flash + eeprom + option bytes off the connected MCU and downloads all 3 as .bin files - mirrors src/Makefile's `backup` target (and compile_and_flash_20.sh's "backup before flashing?" prompt) so backing up before overwriting doesn't require the shell scripts or a native stm8flash install. */
function renderBackupPanel(app: HTMLElement): HTMLElement {
  if (!webUsbAvailable()) return el("div", { className: "hidden" });

  const logBox = el("pre", { className: "flash-log", text: state.backupLog.join("\n") });
  const statusLine = el("p", {
    className: "flash-status",
    text: state.backupLog[state.backupLog.length - 1] ?? "Not backed up yet.",
  });
  const appendLog = (line: string) => {
    state.backupLog = [...state.backupLog, line];
    renderApp(app);
  };

  const backupBtn = iconButton("upload", state.backingUp ? "Backing up…" : "Backup current firmware", {
    className: "btn-teal",
    disabled: state.backingUp || state.flashing || state.restoring || state.displayFlashing || !state.programmer,
    onclick: async () => {
      if (!state.programmer) return;
      state.backingUp = true;
      state.backupLog = [];
      renderApp(app);
      try {
        const stamp = backupTimestamp();
        const areas: { area: BackupArea; suffix: string }[] = [
          { area: "flash", suffix: "" },
          { area: "eeprom", suffix: "_eeprom" },
          { area: "opt", suffix: "_opt" },
        ];
        for (const { area, suffix } of areas) {
          appendLog(`Reading ${area}...`);
          const bytes = await readBackupArea(state.programmer, area, appendLog);
          downloadBytes(`backup${suffix}-${stamp}.bin`, bytes);
        }
        appendLog("Backup complete - 3 files downloaded (firmware, eeprom, option bytes).");
      } catch (err) {
        appendLog(`ERROR: ${(err as Error).message}`);
      } finally {
        state.backingUp = false;
        renderApp(app);
      }
    },
  });

  // ---- Restore: the write counterpart, since a .bin backup that can only
  // ever be read back is not actually a backup. Area is guessed from the
  // filename (matching this panel's own "backup[_eeprom|_opt]-*.bin" naming)
  // but always shown and editable - guessing wrong and silently writing a
  // firmware image to option bytes would be a real way to brick the MCU.
  const restoreLog = el("pre", { className: "flash-log", text: state.restoreLog.join("\n") });
  const restoreStatus = el("p", {
    className: "flash-status",
    text: state.restoreLog[state.restoreLog.length - 1] ?? "No file chosen.",
  });
  const appendRestoreLog = (line: string) => {
    state.restoreLog = [...state.restoreLog, line];
    renderApp(app);
  };

  const areaSelect = el(
    "select",
    {},
    (["flash", "eeprom", "opt"] as BackupArea[]).map((a) => el("option", { value: a, text: a })),
  );

  // Boxed rather than a bare `let` - TS's control-flow narrowing otherwise
  // locks this to `null` at every later read site in this function, since it
  // can't see the reassignment happening inside the addEventListener
  // closure below, and `restoreFile ? restoreFile.name : ...` on a narrowed
  // `null` type collapses the truthy branch to `never`.
  const restoreFileBox: { file: File | null } = { file: null };
  const restoreInput = el("input", { type: "file", accept: ".bin", className: "hidden" });
  restoreInput.addEventListener("change", () => {
    restoreFileBox.file = restoreInput.files?.[0] ?? null;
    const file = restoreFileBox.file;
    if (!file) return;
    areaSelect.value = file.name.includes("_eeprom") ? "eeprom" : file.name.includes("_opt") ? "opt" : "flash";
    restoreStatus.textContent = `Chose "${file.name}" - target area guessed as "${areaSelect.value}", change it below if wrong.`;
  });

  const restoreBtn = iconButton("download", state.restoring ? "Restoring…" : "Restore to device", {
    className: "btn-danger",
    disabled: state.restoring || state.backingUp || state.flashing || state.displayFlashing || !state.programmer,
    onclick: async () => {
      const file = restoreFileBox.file;
      if (!state.programmer || !file) return;
      const area = areaSelect.value as BackupArea;
      if (
        !confirm(
          `This will overwrite the ${area} area on the connected device with "${file.name}". This cannot be undone. Continue?`,
        )
      )
        return;
      state.restoring = true;
      state.restoreLog = [];
      renderApp(app);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const written = await restoreBackupArea(state.programmer, area, bytes, appendRestoreLog);
        appendRestoreLog(`Done. ${written} bytes written to ${area}.`);
      } catch (err) {
        appendRestoreLog(`ERROR: ${(err as Error).message}`);
      } finally {
        state.restoring = false;
        renderApp(app);
      }
    },
  });

  return el("section", { className: state.programmer ? "card" : "card card-disabled" }, [
    el("h3", {}, [icon("upload"), document.createTextNode(" Backup current firmware (WebUSB)")]),
    el("p", {
      className: "subtitle",
      text: "Reads the currently flashed firmware, EEPROM, and option bytes off the connected MCU and downloads them as 3 .bin files, before you overwrite anything below. The same 3 reads as src/Makefile's `backup` target.",
    }),
    statusLine,
    el("div", { className: "toolbar" }, [backupBtn]),
    logBox,
    el("h3", {}, [icon("exclamationCircle", "icon-danger"), document.createTextNode(" Restore from backup")]),
    el("p", {
      className: "subtitle",
      text: "Writes one of the .bin files above (or from a shell-script backup) back to the connected MCU. Double-check the target area before continuing - writing the wrong file to the wrong area can brick the controller.",
    }),
    restoreStatus,
    el("div", { className: "toolbar" }, [
      iconButton("folder", restoreFileBox.file ? `Choose ${restoreFileBox.file.name}…` : "Choose backup .bin…", {
        disabled: !state.programmer || state.backingUp || state.flashing,
        onclick: () => restoreInput.click(),
      }),
      areaSelect,
      restoreBtn,
      restoreInput,
    ]),
    restoreLog,
  ]);
}

function renderFlashPanel(app: HTMLElement): HTMLElement {
  if (!webUsbAvailable()) return el("div", { className: "hidden" });
  ensureMotorCatalog(app);

  const logBox = el("pre", { className: "flash-log", text: state.flashLog.join("\n") });

  const flashFailed = !state.flashing && state.flashLog.some((l) => l.startsWith("ERROR:"));
  const flashDone = !state.flashing && !flashFailed && state.flashLog.some((l) => l.startsWith("Done."));
  const flashStatusText = state.flashing
    ? (state.flashLog[state.flashLog.length - 1] ?? "Starting flash…")
    : (state.flashLog[state.flashLog.length - 1] ?? "Not flashed yet.");
  const statusLine = el(
    "p",
    { className: `flash-status${flashFailed ? " flash-status-error" : flashDone ? " flash-status-success" : ""}` },
    [
      flashFailed ? icon("exclamationCircle") : flashDone ? icon("check") : null,
      document.createTextNode(flashStatusText),
    ],
  );

  const appendLog = (line: string) => {
    state.flashLog = [...state.flashLog, line];
    renderApp(app);
  };

  const hexInput = el("input", { type: "file", accept: ".hex,.ihx,.i86", className: "hidden" });
  hexInput.addEventListener("change", async () => {
    const file = hexInput.files?.[0];
    if (!file) return;
    state.firmwareHexName = file.name;
    state.firmwareHexText = await file.text();
    state.firmwareHexSource = "chosen";
    state.buildError = null; // a manually-chosen file supersedes any earlier in-browser build error
    persistSession();
    renderApp(app);
  });

  const releaseSelect = el(
    "select",
    {
      disabled: !motorCatalog || motorCatalog.length === 0,
      onchange: (e) => {
        selectedMotorRelease = (e.target as HTMLSelectElement).value || null;
        renderApp(app);
      },
    },
    motorCatalog === null
      ? [el("option", { value: "", text: "Loading releases…" })]
      : motorCatalog.length === 0
        ? [el("option", { value: "", text: "No built-in releases found" })]
        : motorCatalog.map((name) =>
            el("option", { value: name, text: name, selected: name === selectedMotorRelease }),
          ),
  );

  // Deliberately self-contained: fetches and flashes selectedMotorRelease
  // directly, without ever touching state.firmwareHexText/firmwareHexName -
  // this and the "Choose .hex.../Flash firmware.hex" pair below are two
  // fully independent ways to pick what gets written, sharing only the
  // flashing/flashLog concurrency guard and log box. Picking a built-in
  // release never overwrites (or is overwritten by) a manually-chosen file -
  // whichever button you click is unambiguously the one that flashes, named
  // right on the button. Also the reason this page doesn't need a hex built
  // on Build first - a release can be flashed on its own.
  const flashReleaseBtn = iconButton(
    "buildFlash",
    state.flashing ? "Flashing…" : selectedMotorRelease ? `Flash ${selectedMotorRelease}` : "Flash release",
    {
      className: "btn-accent",
      disabled:
        state.flashing ||
        state.backingUp ||
        state.restoring ||
        state.displayFlashing ||
        !state.programmer ||
        !selectedMotorRelease,
      onclick: async () => {
        const name = selectedMotorRelease;
        if (!state.programmer || !name) return;
        state.flashing = true;
        state.flashLog = [];
        renderApp(app);
        try {
          appendLog(`Loading built-in release "${name}"…`);
          const hexText = await loadMotorRelease(name);
          appendLog(`Flashing "${name}"…`);
          const bytes = await flashHex(state.programmer, hexText, appendLog);
          appendLog(`Done. ${bytes} bytes written.`);
        } catch (err) {
          appendLog(`ERROR: ${(err as Error).message}`);
        } finally {
          state.flashing = false;
          renderApp(app);
        }
      },
    },
  );

  const flashBtn = iconButton(
    "buildFlash",
    state.flashing ? "Flashing…" : `Flash ${state.firmwareHexName ?? "firmware.hex"}`,
    {
      className: "btn-accent",
      disabled:
        state.flashing ||
        state.backingUp ||
        state.restoring ||
        state.displayFlashing ||
        !state.programmer ||
        !state.firmwareHexText,
      onclick: async () => {
        if (!state.programmer || !state.firmwareHexText) return;
        state.flashing = true;
        state.flashLog = [];
        renderApp(app);
        try {
          appendLog(`Flashing "${state.firmwareHexName ?? "firmware.hex"}"…`);
          const bytes = await flashHex(state.programmer, state.firmwareHexText, appendLog);
          appendLog(`Done. ${bytes} bytes written.`);
        } catch (err) {
          appendLog(`ERROR: ${(err as Error).message}`);
        } finally {
          state.flashing = false;
          renderApp(app);
        }
      },
    },
  );

  return el("section", { className: state.programmer ? "card" : "card card-disabled" }, [
    el("h3", {}, [icon("buildFlash"), document.createTextNode(" Flash firmware (WebUSB)")]),
    el("p", {
      className: "subtitle",
      text: "Writes firmware.hex (built on the Build page, or chosen below) to the connected MCU's flash.",
    }),
    statusLine,
    el("div", { className: "toolbar" }, [
      iconButton("folder", `Choose ${state.firmwareHexName ?? "firmware.hex"}…`, {
        disabled: !state.programmer || state.backingUp || state.restoring,
        onclick: () => hexInput.click(),
      }),
      flashBtn,
      hexInput,
    ]),
    el("p", { className: "subtitle", text: "...or flash a built-in release directly, without choosing a file:" }),
    el("div", { className: "toolbar" }, [releaseSelect, flashReleaseBtn]),
    logBox,
  ]);
}

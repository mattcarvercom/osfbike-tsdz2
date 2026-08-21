import "./build-flash-page.css"; // .card/.flash-status*/.flash-log/.subtitle - reused as-is, same shared styles as build-page.ts/backup-flash-page.ts
import "./app-shell.css"; // .page/.page-title
import "../dom.css"; // .toolbar/.btn-*
import { webSerialAvailable, connectUartAdapter, disconnectUartAdapter } from "../uart-transport.ts";
import { flashUartBin } from "../uart-flasher.ts";
import { state, type AppState } from "../app-state.ts";
import { el, icon, iconButton } from "../dom.ts";
import { renderApp } from "./app-shell.ts";
import { fetchDisplayReleaseCatalog, loadDisplayReleaseBinary } from "../firmware-catalog.ts";

type DisplayTarget = AppState["displayTarget"];

const TARGET_LABELS: Record<DisplayTarget, string> = {
  "860C": "860C",
  "850C": "850C",
  "850C_2021": "850C (2021)",
  SW102: "SW102 (not supported yet)",
};

const UART_TARGETS: readonly DisplayTarget[] = ["860C", "850C", "850C_2021"];

// releases/display/ is one flat folder shared by every target (.hex for
// SW102's SWD bootstrap, .bin for 860C/850C's UART bootloader), plus a
// legacy/ subfolder (see releases/display/README.md) that
// firmware-manifest-plugin.ts reports as "legacy/<name>" entries - basename()
// strips that back off wherever a check needs to look at the plain filename.
// Prefix matching (not an exact TARGET_LABELS match) because the 860C has
// multiple same-target, different-hardware builds for its V12/V13 board
// pinout revisions (genuinely different firmware, not duplicates of the
// plain build - see firmware/860C_850C/dumper/README.md in the source repo).
// Two naming shapes coexist on purpose:
//   - stock emmebrusa/Color_LCD_860C releases, under legacy/, kept under
//     their own upstream names: "860C_V12-<ver>-...", "860C_V13-<ver>-...".
//   - this project's own OSF Modern builds, at the top level: "860C-<semver>
//     +V12...", "860C-<semver>+V13..." - V12/V13 moved into the SemVer
//     build-metadata position, so "860C-" alone already matches all three of
//     our own pin revisions plus emmebrusa's plain "860C-" release; the
//     V12-/V13- prefixes below exist only to also catch emmebrusa's own
//     V12/V13 files.
// "850C-" is deliberately checked before ruling out "850C_2021-" via prefix
// shape (trailing "-"), not a substring check, so "850C-..." doesn't also
// match "850C_2021-...".
const UART_RELEASE_PREFIXES: Partial<Record<DisplayTarget, readonly string[]>> = {
  "860C": ["860C-", "860C_V12-", "860C_V13-"],
  "850C": ["850C-"],
  "850C_2021": ["850C_2021-"],
};

/** Strips a leading "legacy/" (see firmware-manifest-plugin.ts) back off a manifest entry, for display and for target-prefix matching, which both only care about the plain filename. */
function basename(name: string): string {
  return name.startsWith("legacy/") ? name.slice("legacy/".length) : name;
}

// Distinguishes this project's own current builds from the stock
// emmebrusa/Color_LCD_860C releases living under releases/display/legacy/
// (see that folder's own README) - by path, now that the two are physically
// separated, not by guessing at filename shape.
function releaseSource(name: string): "osf.bike" | "emmebrusa" {
  return name.startsWith("legacy/") ? "emmebrusa" : "osf.bike";
}

// Same module-level cache/in-flight-guard pattern as backup-flash-page.ts's
// motorCatalog - see that file's comment for why this isn't in AppState.
// Only the UART panel (860C/850C/850C_2021) uses this catalog now - SW102
// has no working flash path in this UI, see renderSw102FlashPanel below.
let displayCatalog: string[] | null = null;
let displayCatalogPromise: Promise<void> | null = null;
let selectedUartRelease: string | null = null;
function ensureDisplayCatalog(app: HTMLElement): void {
  if (displayCatalog !== null || displayCatalogPromise) return;
  displayCatalogPromise = fetchDisplayReleaseCatalog().then((names) => {
    displayCatalog = names;
    renderApp(app);
  });
}

/**
 * Flashes display firmware, selected by state.displayTarget:
 *  - 860C/850C/850C_2021: over a UART bootloader reached through the
 *    display's own 5-pin motor-controller connector (a generic USB-UART
 *    adapter, Web Serial) - the real, hardware-verified path for these
 *    displays. Their SWD pins exist on the chip but aren't practically
 *    reachable without opening a sealed case, so display-flasher.ts's
 *    ST-Link/SWD flashStm32Hex() is intentionally not wired into this UI
 *    (kept in that file only as an unused, untested recovery-path building
 *    block - see ../../UNIVERSAL_FIRMWARE_PLAN.md's "Open / ongoing"
 *    section).
 *  - SW102: not supported by this UI - see renderSw102FlashPanel and
 *    SW102_FIRMWARE_NOTES.md at the repo root for why.
 */
export function renderDisplayFlashPage(app: HTMLElement): HTMLElement {
  const isUartTarget = UART_TARGETS.includes(state.displayTarget);

  return el("div", { className: "page" }, [
    el("h2", { className: "page-title" }, [icon("plug"), document.createTextNode(" Display firmware")]),
    el("p", {
      className: "subtitle",
      text: "Flashes pre-built display firmware - whatever's bundled below for this target (this project's own OSF Modern build and/or the stock emmebrusa/Color_LCD_860C release, see releases/display/README.md for which), or your own .bin file. This page only flashes, it doesn't build.",
    }),
    targetPicker(app),
    isUartTarget ? renderUartFlashPanel(app) : renderSw102FlashPanel(),
  ]);
}

function targetPicker(app: HTMLElement): HTMLElement {
  return el("div", { className: "toolbar" }, [
    el(
      "select",
      {
        onchange: (e) => {
          state.displayTarget = (e.target as HTMLSelectElement).value as DisplayTarget;
          renderApp(app);
        },
      },
      (Object.keys(TARGET_LABELS) as DisplayTarget[]).map((t) =>
        el("option", { value: t, text: TARGET_LABELS[t], selected: t === state.displayTarget }),
      ),
    ),
  ]);
}

// ---- 860C/850C/850C_2021: UART bootloader over Web Serial -----------------

function renderUartFlashPanel(app: HTMLElement): HTMLElement {
  if (!webSerialAvailable()) {
    return el("p", {
      className: "subtitle",
      text: "Web Serial is not available in this browser. Use desktop Chrome, Edge, Brave, or Opera, served over http://localhost or https://.",
    });
  }
  ensureDisplayCatalog(app);

  const uartReleases = (displayCatalog ?? []).filter((name) =>
    (UART_RELEASE_PREFIXES[state.displayTarget] ?? []).some((p) => basename(name).startsWith(p)),
  );
  if (selectedUartRelease === null || !uartReleases.includes(selectedUartRelease)) {
    selectedUartRelease = uartReleases[0] ?? null;
  }

  const logBox = el("pre", { className: "flash-log", text: state.uartFlashLog.join("\n") });
  const appendLog = (line: string) => {
    state.uartFlashLog = [...state.uartFlashLog, line];
    renderApp(app);
  };

  const flashFailed = !state.uartFlashing && state.uartFlashLog.some((l) => l.startsWith("ERROR:"));
  const flashDone = !state.uartFlashing && !flashFailed && state.uartFlashLog.some((l) => l.startsWith("Done."));
  const statusText = state.uartFlashing
    ? (state.uartFlashLog[state.uartFlashLog.length - 1] ?? "Starting flash…")
    : (state.uartFlashLog[state.uartFlashLog.length - 1] ?? "Not connected.");
  const statusLine = el(
    "p",
    { className: `flash-status${flashFailed ? " flash-status-error" : flashDone ? " flash-status-success" : ""}` },
    [flashFailed ? icon("exclamationCircle") : flashDone ? icon("check") : null, document.createTextNode(statusText)],
  );

  const connectBtn = iconButton("plug", state.uartPort ? "Disconnect UART adapter" : "Connect UART adapter…", {
    className: state.uartPort ? undefined : "btn-accent",
    disabled: state.uartFlashing,
    onclick: async () => {
      if (state.uartPort) {
        await disconnectUartAdapter(state.uartPort);
        state.uartPort = null;
        renderApp(app);
        return;
      }
      try {
        state.uartConnectionError = null;
        state.uartPort = await connectUartAdapter();
      } catch (err) {
        state.uartConnectionError = (err as Error).message;
      }
      renderApp(app);
    },
  });

  const binInput = el("input", { type: "file", accept: ".bin", className: "hidden" });
  binInput.addEventListener("change", async () => {
    const file = binInput.files?.[0];
    if (!file) return;
    state.displayBinName = file.name;
    state.displayBinBytes = new Uint8Array(await file.arrayBuffer());
    renderApp(app);
  });

  const flashBtn = iconButton("buildFlash", state.uartFlashing ? "Flashing…" : "Flash", {
    className: "btn-accent",
    disabled: state.uartFlashing || !state.uartPort || !state.displayBinBytes,
    onclick: async () => {
      if (!state.uartPort || !state.displayBinBytes) return;
      state.uartFlashing = true;
      state.uartFlashLog = [];
      renderApp(app);
      try {
        appendLog(`Flashing "${state.displayBinName}" (${state.displayBinBytes.length} bytes)…`);
        const bytes = await flashUartBin(state.uartPort, state.displayBinBytes, appendLog);
        appendLog(`Done. ${bytes} bytes written. Power-cycle the display to confirm it boots.`);
      } catch (err) {
        appendLog(`ERROR: ${(err as Error).message}`);
      } finally {
        state.uartFlashing = false;
        renderApp(app);
      }
    },
  });

  // Shown explicitly (name + byte count, not just a button label) so it's
  // never ambiguous what's about to be sent, and clearly distinguished from
  // a built-in release below (releaseSelect/flashReleaseBtn) - this line is
  // specifically about the manual file picker's current selection.
  const chosenFileLine = el(
    "p",
    { className: "subtitle" },
    state.displayBinName && state.displayBinBytes
      ? [
          document.createTextNode(
            `Loaded: ${state.displayBinName} (${state.displayBinBytes.length.toLocaleString()} bytes) - your own file, not a built-in release.`,
          ),
        ]
      : [document.createTextNode("No firmware file chosen yet.")],
  );

  const releaseSelect = el(
    "select",
    {
      disabled: uartReleases.length === 0,
      onchange: (e) => {
        selectedUartRelease = (e.target as HTMLSelectElement).value || null;
        renderApp(app);
      },
    },
    displayCatalog === null
      ? [el("option", { value: "", text: "Loading releases…" })]
      : uartReleases.length === 0
        ? [el("option", { value: "", text: "No built-in releases for this target" })]
        : uartReleases.map((name) =>
            el("option", {
              value: name,
              text: `${basename(name)}  —  ${releaseSource(name)}`,
              selected: name === selectedUartRelease,
            }),
          ),
  );

  // Self-contained, same reasoning as backup-flash-page.ts's flashReleaseBtn:
  // fetches and flashes selectedUartRelease directly, without ever touching
  // state.displayBinText/displayBinBytes - fully independent of the "Choose
  // .bin.../Flash" pair above.
  const flashReleaseBtn = iconButton(
    "buildFlash",
    state.uartFlashing ? "Flashing…" : selectedUartRelease ? `Flash ${basename(selectedUartRelease)}` : "Flash release",
    {
      className: "btn-accent",
      disabled: state.uartFlashing || !state.uartPort || !selectedUartRelease,
      onclick: async () => {
        const name = selectedUartRelease;
        if (!state.uartPort || !name) return;
        state.uartFlashing = true;
        state.uartFlashLog = [];
        renderApp(app);
        try {
          appendLog(`Loading built-in release "${name}"…`);
          const bin = await loadDisplayReleaseBinary(name);
          appendLog(`Flashing "${name}" (${bin.length} bytes)…`);
          const bytes = await flashUartBin(state.uartPort, bin, appendLog);
          appendLog(`Done. ${bytes} bytes written. Power-cycle the display to confirm it boots.`);
        } catch (err) {
          appendLog(`ERROR: ${(err as Error).message}`);
        } finally {
          state.uartFlashing = false;
          renderApp(app);
        }
      },
    },
  );

  return el("section", { className: "card" }, [
    el("h3", {}, [icon("buildFlash"), document.createTextNode(" Flash over UART (recommended)")]),
    el("p", {
      className: "subtitle",
      text: "Wired through the display's own 5-pin motor-controller connector via a USB-UART adapter, not the ST-Link/SWD pins - this is the real-world way these displays get flashed, since the SWD pins aren't reachable without opening a sealed case. Wire the adapter to the display's motor-side connector (TX/RX/GND), power the display separately (27-35V, e.g. off the ebike battery or a USB step-up board), then click Connect, power on the display.",
    }),
    // TODO: link to an adapter build guide (wiring photos) and parts-procurement
    // links here once written - see UNIVERSAL_FIRMWARE_PLAN.md's UART entry.
    state.uartConnectionError
      ? el("p", { className: "flash-status flash-status-error" }, [
          icon("exclamationCircle"),
          document.createTextNode(state.uartConnectionError),
        ])
      : null,
    statusLine,
    el("div", { className: "toolbar" }, [connectBtn]),
    state.displayTarget === "860C"
      ? el("p", {
          className: "subtitle",
          text: "860C ships 3 different builds for different board pinout revisions: the plain 860C, V12, and V13 (V1.3/V1.5, the more common one) releases below are genuinely different firmware, not duplicates - flashing the wrong one for your board's revision won't just fail to boot, it may drive pins your board wires differently. Check which yours is before picking one, if you're not already sure.",
        })
      : null,
    el("p", { className: "subtitle", text: "Flash a built-in release:" }),
    el("div", { className: "toolbar" }, [releaseSelect, flashReleaseBtn]),
    el("p", { className: "subtitle", text: "...or choose your own .bin file:" }),
    chosenFileLine,
    el("div", { className: "toolbar" }, [
      iconButton("folder", state.displayBinName ? "Choose a different .bin…" : "Choose .bin file…", {
        disabled: state.uartFlashing,
        onclick: () => binInput.click(),
      }),
      flashBtn,
      binInput,
    ]),
    logBox,
  ]);
}

// ---- SW102: not supported yet ----------------------------------------------
//
// Unlike 860C/850C's accessible 5-pin motor connector, this fork has no
// documented pinout for where SW102's SWD signals (SWDIO/SWCLK/VCC/GND) are
// physically exposed on the board - the one-time bootloader+SoftDevice
// bootstrap this would need likely means opening the case and finding/
// soldering to test points, not just wiring up a cable. And even once that
// bootstrap is done, all real firmware updates are Bluetooth DFU (OTA), a
// transport this tool doesn't implement. Given both ends of that path are
// out of reach right now, there's no working flash flow to offer here - see
// SW102_FIRMWARE_NOTES.md at the repo root for what's been learned so far,
// including that a build was produced and confirmed to generate a real OTA
// update package, just with no way (yet) to get past the bootstrap step.
function renderSw102FlashPanel(): HTMLElement {
  return el("section", { className: "card" }, [
    el("h3", {}, [icon("exclamationCircle"), document.createTextNode(" SW102 - not supported yet")]),
    el("p", {
      className: "subtitle",
      text: "SW102's only known flashing path is a one-time SWD bootloader+SoftDevice bootstrap on blank hardware, but there's no documented pinout for where those SWD signals are physically exposed on the board - unlike the 860C/850C's accessible 5-pin motor connector, this likely means opening the case and finding/soldering to test points. After that one-time bootstrap, all real firmware updates are Bluetooth DFU (OTA), which this tool doesn't implement. See SW102_FIRMWARE_NOTES.md at the repo root for details.",
    }),
  ]);
}

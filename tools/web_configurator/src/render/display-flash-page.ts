import "./build-flash-page.css"; // .card/.flash-status*/.flash-log/.subtitle - reused as-is, same shared styles as build-page.ts/backup-flash-page.ts
import "./app-shell.css"; // .page/.page-title
import "../dom.css"; // .toolbar/.btn-*
import {
  webSerialAvailable,
  connectUartAdapter,
  connectUartAdapterViaWebUsb,
  disconnectUartAdapter,
  BOOTLOADER_BAUD,
} from "../uart-transport.ts";
import { webUsbAvailable } from "../usb-transport.ts";
import { flashUartBin } from "../uart-flasher.ts";
import { startMotorHandshakeEmulator, MOTOR_LINK_BAUD, type MotorHandshakeHandle } from "../motor-handshake.ts";
import { state, setDisplayTarget, setShowLegacyDisplayFirmwares, type AppState } from "../app-state.ts";
import { el, icon, iconButton, switchToggle } from "../dom.ts";
import { renderApp } from "./app-shell.ts";
import { fetchDisplayReleaseCatalog, loadDisplayReleaseBinary } from "../firmware-catalog.ts";

type DisplayTarget = AppState["displayTarget"];

// Order is deliberate (860C V13 first/default, then V12, then plain 860C,
// then the 850Cs) - V13 is this fork's most common board revision in
// practice, reported 2026-08-23. Object key insertion order drives
// targetPicker()'s <option> order below (Object.keys() preserves it for
// string keys), so don't reorder these without meaning to reorder the UI.
const TARGET_LABELS: Record<DisplayTarget, string> = {
  "860C_V13": "860C V13",
  "860C_V12": "860C V12",
  "860C": "860C (other/unknown revision)",
  "850C": "850C",
  "850C_2021": "850C (2021)",
  SW102: "SW102 (not supported yet)",
};

const UART_TARGETS: readonly DisplayTarget[] = ["860C_V13", "860C_V12", "860C", "850C", "850C_2021"];

// releases/display/ is one flat folder shared by every target (.hex for
// SW102's SWD bootstrap, .bin for 860C/850C's UART bootloader), plus a
// legacy/ subfolder (see releases/display/README.md) that
// firmware-manifest-plugin.ts reports as "legacy/<name>" entries - basename()
// strips that back off wherever a check needs to look at the plain filename.
// Predicates (not simple prefix matching) because the 860C has multiple
// same-target, different-hardware builds for its V12/V13 board pinout
// revisions (genuinely different firmware, not duplicates of the plain
// build - see firmware/860C_850C/dumper/README.md in the source repo), and
// this project's own osf.bike builds can't be told apart by prefix alone.
// Two naming shapes coexist:
//   - stock emmebrusa/Color_LCD_860C releases, under legacy/, prefixed
//     directly: "860C_V12-<ver>-...", "860C_V13-<ver>-...", or plain
//     "860C-<ver>-..." with no V12/V13 marker at all.
//   - this project's own osf.bike builds, at the top level, ALL share the
//     "860C-" prefix ("860C-<semver>+V12...", "860C-<semver>+V13...",
//     "860C-<semver>+bootloader...") - the pin revision lives in the
//     SemVer build-metadata suffix instead, so a plain prefix check can't
//     distinguish them; substring-checking "+V12"/"+V13" can.
// "850C-" is deliberately checked before ruling out "850C_2021-" via prefix
// shape (trailing "-"), not a substring check, so "850C-..." doesn't also
// match "850C_2021-...".
const UART_RELEASE_MATCHERS: Partial<Record<DisplayTarget, (name: string) => boolean>> = {
  "860C_V13": (n) => (n.startsWith("860C-") && n.includes("+V13")) || n.startsWith("860C_V13-"),
  "860C_V12": (n) => (n.startsWith("860C-") && n.includes("+V12")) || n.startsWith("860C_V12-"),
  "860C": (n) => n.startsWith("860C-") && !n.includes("+V12") && !n.includes("+V13"),
  "850C": (n) => n.startsWith("850C-"),
  "850C_2021": (n) => n.startsWith("850C_2021-"),
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

// The running emulator's stop handle - same "module-level, not AppState"
// reasoning as displayCatalog/selectedUartRelease above: this is a live
// object (holds the port's reader/writer locks internally), not
// JSON-serializable session state.
let motorHandshakeHandle: MotorHandshakeHandle | null = null;
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
    el("p", {
      className: "subtitle",
      text: 'Not sure which 860C board revision you have? Look on the back of the display, below the "APT" logo: a label reading "860C 1.3GXXXXXXX" or "860C 1.5GXXXXXXX" means V13 - pick 860C V13. "1.2G..." means V12. If you don\'t see either, or the display predates this labeling, pick "860C (other/unknown revision)".',
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
          setDisplayTarget((e.target as HTMLSelectElement).value as DisplayTarget);
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
  if (!webSerialAvailable() && !webUsbAvailable()) {
    return el("p", {
      className: "subtitle",
      text: "Neither Web Serial nor WebUSB is available in this browser. Use desktop Chrome, Edge, Brave, or Opera, or Android Chrome with USB OTG, served over http://localhost or https://.",
    });
  }
  ensureDisplayCatalog(app);

  const targetMatcher = UART_RELEASE_MATCHERS[state.displayTarget] ?? (() => false);
  const uartReleases = (displayCatalog ?? [])
    .filter((name) => targetMatcher(basename(name)))
    .filter((name) => state.showLegacyDisplayFirmwares || releaseSource(name) === "osf.bike");
  if (selectedUartRelease === null || !uartReleases.includes(selectedUartRelease)) {
    // Prefer an osf.bike build even when legacy releases are also shown -
    // "should always default to osf.bike firmwares in the picker and not an
    // emmebrusa one" (reported 2026-08-23), so toggling legacy releases on
    // doesn't itself change what's pre-selected.
    selectedUartRelease = uartReleases.find((n) => releaseSource(n) === "osf.bike") ?? uartReleases[0] ?? null;
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
    : (state.uartFlashLog[state.uartFlashLog.length - 1] ??
      (state.uartPort ? "Adapter connected. Choose a release/file, then click Flash." : "Not connected."));
  const statusLine = el(
    "p",
    { className: `flash-status${flashFailed ? " flash-status-error" : flashDone ? " flash-status-success" : ""}` },
    [flashFailed ? icon("exclamationCircle") : flashDone ? icon("check") : null, document.createTextNode(statusText)],
  );

  // Two explicit connect paths rather than one auto-detecting button: Web
  // Serial's mere presence on Android doesn't mean the adapter will actually
  // open through it (see uart-transport.ts's header comment), so the user
  // picks which permission prompt/device model they want rather than this
  // code guessing from the platform. Each button only renders if its API is
  // actually available; disconnecting is transport-agnostic (just
  // port.close() either way), so it's a single shared button once connected.
  const connectControls = state.uartPort
    ? [
        iconButton("plug", "Disconnect UART adapter", {
          disabled: state.uartFlashing || state.uartMotorHandshakeActive,
          onclick: async () => {
            await disconnectUartAdapter(state.uartPort!);
            state.uartPort = null;
            renderApp(app);
          },
        }),
      ]
    : [
        webSerialAvailable()
          ? iconButton("plug", "Connect UART adapter…", {
              className: "btn-accent",
              disabled: state.uartFlashing || state.uartMotorHandshakeActive,
              onclick: async () => {
                try {
                  state.uartConnectionError = null;
                  state.uartPort = await connectUartAdapter();
                } catch (err) {
                  state.uartConnectionError = (err as Error).message;
                }
                renderApp(app);
              },
            })
          : null,
        webUsbAvailable()
          ? iconButton("plug", "Connect UART adapter via WebUSB (Android)…", {
              className: "btn-accent",
              disabled: state.uartFlashing || state.uartMotorHandshakeActive,
              onclick: async () => {
                try {
                  state.uartConnectionError = null;
                  state.uartPort = await connectUartAdapterViaWebUsb();
                } catch (err) {
                  state.uartConnectionError = (err as Error).message;
                }
                renderApp(app);
              },
            })
          : null,
      ];

  // Stands in for a real TSDZ2 motor controller on the same wired-up
  // adapter/cable, so the display can be driven past its boot screen
  // ("connecting to motor") for bench testing without one attached - see
  // motor-handshake.ts's header comment for the protocol this reimplements.
  // Mutually exclusive with flashing: the runtime link needs the port
  // reopened at a different baud rate than the bootloader protocol, so
  // every flash control below disables while this is active.
  const motorHandshakeBtn = iconButton(
    "motor",
    state.uartMotorHandshakeActive ? "Stop motor handshake" : "Motor handshake…",
    {
      disabled: state.uartFlashing || !state.uartPort,
      onclick: async () => {
        const port = state.uartPort;
        if (!port) return;
        if (state.uartMotorHandshakeActive) {
          appendLog("Motor emulator: stopping…");
          await motorHandshakeHandle?.stop();
          motorHandshakeHandle = null;
          try {
            await port.close();
            await port.open({ baudRate: BOOTLOADER_BAUD, dataBits: 8, stopBits: 1, parity: "none" });
          } catch (err) {
            state.uartConnectionError = (err as Error).message;
          }
          state.uartMotorHandshakeActive = false;
          renderApp(app);
          return;
        }
        try {
          await port.close();
          await port.open({ baudRate: MOTOR_LINK_BAUD, dataBits: 8, stopBits: 1, parity: "none" });
          state.uartFlashLog = [];
          motorHandshakeHandle = startMotorHandshakeEmulator(port, appendLog);
          state.uartMotorHandshakeActive = true;
        } catch (err) {
          state.uartConnectionError = (err as Error).message;
        }
        renderApp(app);
      },
    },
  );

  // Only meaningful while the motor emulator is running - that's the only
  // time this page holds an open writer to send it over (see
  // motor-handshake.ts's sendBenchEepromWipe()). A confirm() dialog since
  // this wipes every display setting, same pattern as the other destructive
  // actions in this app (topbar.ts's "reset to defaults", etc.).
  const wipeEepromBtn = iconButton("reset", "Wipe display EEPROM (bench)…", {
    disabled: !state.uartMotorHandshakeActive,
    onclick: async () => {
      if (
        !confirm(
          "This resets every display setting back to firmware defaults (odometer/trip/service distances are preserved). Continue?",
        )
      )
        return;
      try {
        await motorHandshakeHandle?.sendBenchEepromWipe();
      } catch (err) {
        appendLog(`ERROR: ${(err as Error).message}`);
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
    disabled: state.uartFlashing || state.uartMotorHandshakeActive || !state.uartPort || !state.displayBinBytes,
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
      disabled: uartReleases.length === 0 || state.uartMotorHandshakeActive,
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
      disabled: state.uartFlashing || state.uartMotorHandshakeActive || !state.uartPort || !selectedUartRelease,
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
      text: "Wired through the display's 5-pin motor-controller connector via a USB-UART adapter (its SWD pins aren't reachable without opening the case). Verify TX/RX/GND against your own display's pinout - colors vary by cable.",
    }),
    el("p", {
      className: "subtitle",
      text: "Connect the adapter, pick a release, power the display OFF, click Flash, then power it on - you have 60s to answer. Powering on before clicking Flash just boots normal firmware instead of the bootloader.",
    }),
    // TODO: link to an adapter build guide (wiring photos) and parts-procurement
    // links here once written - see UNIVERSAL_FIRMWARE_PLAN.md's UART entry.
    !state.uartPort && webUsbAvailable()
      ? el("p", {
          className: "subtitle",
          text: "On Android, use the WebUSB button below - Web Serial can't open a CP210x/CH340/FTDI adapter there (Android has no OS driver for those chips). WebUSB works with all three plus CDC-ACM adapters (e.g. CH9102/CH343-based ones) directly over USB OTG.",
        })
      : null,
    state.uartConnectionError
      ? el("p", { className: "flash-status flash-status-error" }, [
          icon("exclamationCircle"),
          document.createTextNode(state.uartConnectionError),
        ])
      : null,
    statusLine,
    el("p", {
      className: "subtitle",
      text: 'Motor handshake emulates a real TSDZ2 motor controller, so a bench-flashed display can get past "connecting to motor" without one attached. Disables flashing while running.',
    }),
    el("div", { className: "toolbar" }, [...connectControls, motorHandshakeBtn]),
    el("p", {
      className: "subtitle",
      text: 'Bench EEPROM wipe forces the display\'s config-menu "reset to defaults" over this same link - only needed if the config menu itself is unreachable (stuck boot, dead buttons). Requires the motor handshake running above.',
    }),
    el("div", { className: "toolbar" }, [wipeEepromBtn]),
    el("p", { className: "subtitle", text: "Flash a built-in release:" }),
    el("div", { className: "toolbar" }, [
      switchToggle(state.showLegacyDisplayFirmwares, "Show legacy emmebrusa/Color_LCD_860C releases too", (checked) => {
        setShowLegacyDisplayFirmwares(checked);
        renderApp(app);
      }),
    ]),
    el("div", { className: "toolbar" }, [releaseSelect, flashReleaseBtn]),
    el("p", { className: "subtitle", text: "...or choose your own .bin file:" }),
    chosenFileLine,
    el("div", { className: "toolbar" }, [
      iconButton("folder", state.displayBinName ? "Choose a different .bin…" : "Choose .bin file…", {
        disabled: state.uartFlashing || state.uartMotorHandshakeActive,
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

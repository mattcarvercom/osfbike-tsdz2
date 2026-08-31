import "./build-flash-page.css"; // .card/.flash-status*/.flash-log/.subtitle - shared with backup-flash-page.ts and display-flash-page.ts
import "./app-shell.css"; // .page/.page-title
import "../dom.css"; // .toolbar/.btn-*
import { generateConfigH } from "../config-h-generator.ts";
import { buildFirmwareHex } from "../sdcc-build.ts";
import { state, persistSession, clearStaleFirmwareHex } from "../app-state.ts";
import { el, icon, iconButton, downloadText } from "../dom.ts";
import { renderApp } from "./app-shell.ts";

/**
 * Compiles the current settings into a flashable firmware.hex, entirely in
 * this tab via SDCC compiled to WASM - no ST-Link, no hardware, nothing
 * connected required. Deliberately its own page, split off from what's now
 * Backup & flash (2026-08-19): building is a pure config→hex compile step,
 * while backup/restore/flash all require a physical ST-Link connection -
 * genuinely different workflows that used to be forced onto one page. A
 * hex built here is picked up by the Flash panel over on Backup & flash.
 */
export function renderBuildPage(app: HTMLElement): HTMLElement {
  clearStaleFirmwareHex();

  return el("div", { className: "page" }, [
    el("h2", { className: "page-title" }, [icon("hammer"), document.createTextNode(" Build")]),
    renderBuildPanel(app),
  ]);
}

function renderBuildPanel(app: HTMLElement): HTMLElement {
  const failed = !state.building && !!state.buildError;
  // renderBuildPage() above already clears firmwareHexText/buildLog the
  // moment isDirty() goes true, so a hex reaching here is never stale - no
  // separate "built but settings changed since" state to account for.
  // Gated on firmwareHexSource, not just firmwareHexText - Backup & flash's
  // "Choose firmware.hex…" picker writes the same firmwareHexText/Name pair
  // (so Flash can use whichever is active), but that's a manually loaded
  // file, not something this panel built. Without this check, picking a
  // file over there would incorrectly light up this card's success state.
  const built = !state.building && !state.buildError && !!state.firmwareHexText && state.firmwareHexSource === "built";
  const chosenOnly =
    !state.building && !state.buildError && !!state.firmwareHexText && state.firmwareHexSource === "chosen";

  const logBox = el("pre", { className: "flash-log", text: state.buildLog.join("\n") });
  const statusText = state.building
    ? (state.buildLog[state.buildLog.length - 1] ?? "Starting build…")
    : state.buildError
      ? `Build failed: ${state.buildError}`
      : built
        ? `Built "${state.firmwareHexName}" - ready to flash on Backup & flash, or download it.`
        : chosenOnly
          ? `Using manually chosen "${state.firmwareHexName}" for flashing (not built here) - see Backup & flash.`
          : "Not built yet.";
  const statusLine = el(
    "p",
    {
      className: `flash-status${failed ? " flash-status-error" : built ? " flash-status-success" : chosenOnly ? " flash-status-warn" : ""}`,
    },
    [
      failed ? icon("exclamationCircle") : built ? icon("check") : chosenOnly ? icon("infoCircle") : null,
      document.createTextNode(statusText),
    ],
  );

  const appendLog = (line: string) => {
    state.buildLog = [...state.buildLog, line];
    renderApp(app);
  };

  const buildBtn = iconButton(
    "hammer",
    state.building ? "Building…" : state.firmwareHexText ? "Rebuild firmware.hex" : "Build firmware.hex",
    {
      className: "btn-accent",
      disabled: state.building,
      onclick: async () => {
        state.building = true;
        state.buildError = null;
        state.buildLog = [];
        renderApp(app);
        try {
          const configH = generateConfigH(state.values);
          // Echo the display/UART protocol flags actually baked into this
          // build, so a wrong/stale selection can't silently produce a VLCD5
          // build - visible in the log right below this line, before the
          // per-file compile progress.
          appendLog("Display type in this build (from generated config.h):");
          for (const flag of [
            "ENABLE_860C_LVGL_UART",
            "ENABLE_850C",
            "ENABLE_VLCD6",
            "ENABLE_VLCD5",
            "ENABLE_XH18",
            "ENABLE_EKD01",
          ]) {
            const m = new RegExp(`^#define ${flag}\\s+(\\d+)`, "m").exec(configH);
            if (m) appendLog(`  ${flag} = ${m[1]}`);
          }
          const hex = await buildFirmwareHex(configH, appendLog);
          state.firmwareHexText = hex;
          state.firmwareHexName = `${state.currentFileBaseName}.hex`;
          state.firmwareHexSource = "built";
          appendLog("Build succeeded.");
        } catch (err) {
          state.buildError = (err as Error).message;
          appendLog(`ERROR: ${state.buildError}`);
        } finally {
          state.building = false;
          persistSession(); // built hex/error survive a refresh like everything else on this page
          renderApp(app);
        }
      },
    },
  );

  const downloadBtn = iconButton(
    "download",
    state.firmwareHexName ? `Download ${state.firmwareHexName}` : "Download firmware.hex",
    {
      disabled: !state.firmwareHexText,
      onclick: () => {
        if (state.firmwareHexText)
          downloadText(state.firmwareHexName ?? "firmware.hex", state.firmwareHexText, "text/plain");
      },
    },
  );

  return el("section", { className: "card" }, [
    el("h3", {}, [icon("hammer"), document.createTextNode(" Build firmware.hex (in-browser SDCC)")]),
    el("p", {
      className: "subtitle",
      text: "Compiles the current settings into a flashable firmware.hex entirely in this tab, using SDCC's STM8 toolchain compiled to WebAssembly - no local SDCC install needed, no hardware connected required. Takes a little while (compiles ~30 files).",
    }),
    statusLine,
    el("div", { className: "toolbar" }, [buildBtn, downloadBtn]),
    logBox,
  ]);
}

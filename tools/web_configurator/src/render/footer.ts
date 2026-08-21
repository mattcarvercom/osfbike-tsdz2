import "./footer.css";
import { state, persistSession, BACKUP_FLASH_PAGE, DISPLAY_FLASH_PAGE, APP_VERSION } from "../app-state.ts";
import { el } from "../dom.ts";
import { webUsbAvailable } from "../usb-transport.ts";
import { webSerialAvailable } from "../uart-transport.ts";
import { renderApp } from "./app-shell.ts";

/**
 * The ST-Link/UART connection chips and version tag used to live stacked
 * inside .sidebar, below the nav - fine on a tall desktop sidebar, but on a
 * phone that put a connection-chip row and a version row between the
 * horizontal nav strip and the actual page content, all consuming portrait
 * height before you reach anything you came for. Pulled out into a real
 * page-level footer instead - one slim row, always at the true bottom of
 * the viewport, same on desktop and mobile. (The field-color legend that
 * used to live here too moved to the top of the Motor page (2026-08-19,
 * section-page.ts) - it's not relevant to the Build/flash/Display pages
 * this footer is equally visible on.)
 */
export function renderFooter(app: HTMLElement): HTMLElement {
  const version = el("div", { className: "footer-version", text: APP_VERSION });
  return el("footer", { className: "app-footer" }, [renderStLinkChip(app), renderUartChip(app), version]);
}

/**
 * Compact connection status, always visible regardless of which page is
 * active - the full connect/disconnect control lives on a specific page
 * (see `title`/`onclick` below), so a chip is a passive reminder of whether
 * something's attached, not a second way to (dis)connect. Clicking one
 * jumps to that page.
 *
 * Dot pulses (green connected, red error) rather than sitting solid - a
 * static LED reads the same whether it's a live, held connection or a
 * one-time snapshot from render time, so the pulse is what actually says
 * "this is live/current state", not just decoration. Not-connected/
 * unavailable stays a static dot - there's nothing "live" to indicate.
 */
function renderConnectionChip(opts: {
  available: boolean;
  connected: boolean;
  errored: boolean;
  connectedText: string;
  errorText: string;
  disconnectedText: string;
  unavailableText: string;
  title: string;
  onClick: () => void;
}): HTMLElement {
  const text = !opts.available
    ? opts.unavailableText
    : opts.errored
      ? opts.errorText
      : opts.connected
        ? opts.connectedText
        : opts.disconnectedText;
  return el(
    "button",
    {
      type: "button",
      className: `sidebar-connection-chip${opts.connected ? " sidebar-connection-chip-connected" : opts.errored ? " sidebar-connection-chip-error" : ""}`,
      title: opts.title,
      onclick: opts.onClick,
    },
    [el("span", { className: "sidebar-connection-dot" }), el("span", { text })],
  );
}

// Reads state.programmer/connectionError directly rather than its own
// tracked state - connectStLink/disconnectStLink (and a failed connect
// attempt) all call a full renderApp() on completion (see
// renderConnectionPanel in backup-flash-page.ts), which rebuilds this
// footer too, so it stays in sync for free.
function renderStLinkChip(app: HTMLElement): HTMLElement {
  const available = webUsbAvailable();
  const connected = available && state.programmer !== null;
  const errored = available && !connected && state.connectionError !== null;
  return renderConnectionChip({
    available,
    connected,
    errored,
    connectedText: `ST-Link connected (${state.programmer?.usbType})`,
    errorText: `Connect failed: ${state.connectionError}`,
    disconnectedText: "ST-Link: not connected",
    unavailableText: "WebUSB unavailable",
    title: available ? "Go to Backup & flash to connect/disconnect" : "This browser doesn't support WebUSB",
    onClick: () => {
      state.activePage = BACKUP_FLASH_PAGE;
      persistSession();
      renderApp(app);
    },
  });
}

// Same reasoning/sync-for-free as renderStLinkChip above, but for the
// separate Web Serial connection to a UART adapter (see uart-transport.ts's
// own header comment on why this is a distinct transport from ST-Link's
// WebUSB) - reads state.uartPort/uartConnectionError, set by
// display-flash-page.ts's own connect control.
function renderUartChip(app: HTMLElement): HTMLElement {
  const available = webSerialAvailable();
  const connected = available && state.uartPort !== null;
  const errored = available && !connected && state.uartConnectionError !== null;
  return renderConnectionChip({
    available,
    connected,
    errored,
    connectedText: "UART adapter connected",
    errorText: `Connect failed: ${state.uartConnectionError}`,
    disconnectedText: "UART adapter: not connected",
    unavailableText: "Web Serial unavailable",
    title: available ? "Go to Display firmware to connect/disconnect" : "This browser doesn't support Web Serial",
    onClick: () => {
      state.activePage = DISPLAY_FLASH_PAGE;
      persistSession();
      renderApp(app);
    },
  });
}

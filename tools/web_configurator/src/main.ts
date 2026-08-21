import "./base.css";
import { RAW_FIELDS } from "./schema.ts";
import { loadedFileNameFromSession, baselineLoadedFileNameFromSession } from "./session.ts";
import { state, controls, loadSession, sessionIsDirty, validPage, persistSession } from "./app-state.ts";
import { renderApp } from "./render/app-shell.ts";
import { renderRestoreBanner } from "./render/restore-banner.ts";
import { readUrlLocation, writeUrlLocation } from "./url-state.ts";
import { highlightField } from "./render/field-highlight.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
// A shared/bookmarked #page/field link (see url-state.ts) takes priority
// over wherever a restored session would otherwise land - that's the whole
// point of sharing one, so it should win even over "go back to what I was
// last looking at" on this same browser.
const urlLoc = readUrlLocation();
const startupSession = loadSession();
if (startupSession && sessionIsDirty(startupSession)) {
  renderRestoreBanner(app, startupSession, urlLoc);
} else {
  if (startupSession) {
    state.values = startupSession.values;
    state.baselineValues = startupSession.baselineValues;
    state.sourceImport = startupSession.sourceImport;
    // Not dirty (checked above), so notes === baselineNotes here either way.
    state.notes = startupSession.notes ?? "";
    state.baselineNotes = startupSession.baselineNotes ?? "";
    state.currentFileBaseName = startupSession.currentFileBaseName;
    state.loadedFileName = loadedFileNameFromSession(startupSession);
    // Not dirty (checked above), so loadedFileName === baselineLoadedFileName here either way.
    state.baselineLoadedFileName = baselineLoadedFileNameFromSession(startupSession);
    state.activePage = validPage(urlLoc?.page ?? startupSession.activePage);
    state.firmwareHexText = startupSession.firmwareHexText ?? null;
    state.firmwareHexName = startupSession.firmwareHexName ?? null;
    state.firmwareHexSource = startupSession.firmwareHexSource ?? null;
    state.buildError = startupSession.buildError ?? null;
  } else if (urlLoc) {
    state.activePage = validPage(urlLoc.page);
  }
  renderApp(app);
  // replace: true - a fresh page load shouldn't itself become a back-button
  // stop, and this also normalizes a garbled/stale hash (validPage() above
  // already fell back to a real page) back to something valid.
  writeUrlLocation(state.activePage, urlLoc?.field ?? null, true);
  if (urlLoc?.field) highlightField(app, urlLoc.field);
}

/**
 * Back/forward navigation, plus a hash manually edited/pasted into the
 * address bar while the app is already open - both change `location.hash`
 * without this app's own navigateToPage() (render/app-shell.ts) running, so
 * they need their own listener to stay in sync. Both `popstate` (back/
 * forward) and `hashchange` (any other hash change) are listened for since
 * neither alone covers every case; the handler just re-derives everything
 * from the current hash either way, so a duplicate firing is harmless.
 */
window.addEventListener("popstate", syncFromUrlLocation);
window.addEventListener("hashchange", syncFromUrlLocation);

function syncFromUrlLocation() {
  // The restore banner replaces #app wholesale and hasn't loaded real
  // session state yet - nothing to sync against until the user picks
  // Restore/Discard (see restore-banner.ts, which applies urlLoc itself).
  if (app.querySelector(".restore-overlay")) return;
  const loc = readUrlLocation();
  if (!loc) return;
  const page = validPage(loc.page);
  if (page !== state.activePage) {
    state.activePage = page;
    persistSession();
    renderApp(app);
  }
  if (loc.field) highlightField(app, loc.field);
}

// Fail loudly in dev if a schema field somehow has no control - this should
// never happen (see src/__tests__/ui-model.test.ts) but a silent gap here
// would mean a value quietly not editable.
const coveredCount = new Set(controls.flatMap((c) => (c.kind === "radio" ? c.groupKeys : [c.key]))).size;
const deadCount = 4; // streetThrottleEnabled_UNUSED, throttleLegal_UNUSED, motorTypeTSDZ8, streetPowerLimEnabled (see DEAD_KEYS in ui-model.ts)
if (coveredCount + deadCount !== RAW_FIELDS.length) {
  console.warn(
    `Schema/UI coverage mismatch: ${coveredCount} covered + ${deadCount} known-dead != ${RAW_FIELDS.length} total fields`,
  );
}

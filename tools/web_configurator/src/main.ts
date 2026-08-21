import "./base.css";
import { RAW_FIELDS } from "./schema.ts";
import { loadedFileNameFromSession, baselineLoadedFileNameFromSession } from "./session.ts";
import { state, controls, loadSession, sessionIsDirty, validPage } from "./app-state.ts";
import { renderApp } from "./render/app-shell.ts";
import { renderRestoreBanner } from "./render/restore-banner.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const startupSession = loadSession();
if (startupSession && sessionIsDirty(startupSession)) {
  renderRestoreBanner(app, startupSession);
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
    state.activePage = validPage(startupSession.activePage);
    state.firmwareHexText = startupSession.firmwareHexText ?? null;
    state.firmwareHexName = startupSession.firmwareHexName ?? null;
    state.firmwareHexSource = startupSession.firmwareHexSource ?? null;
    state.buildError = startupSession.buildError ?? null;
  }
  renderApp(app);
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

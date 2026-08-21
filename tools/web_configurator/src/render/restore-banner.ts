import "./restore-banner.css";
import "../dom.css"; // .toolbar/.btn-* (Restore edits/Discard edits)
import { type Session, loadedFileNameFromSession, baselineLoadedFileNameFromSession } from "../session.ts";
import { state, persistSession, validPage } from "../app-state.ts";
import { el, icon, iconButton } from "../dom.ts";
import { renderApp } from "./app-shell.ts";

/**
 * Shown instead of the shell on first load only when the persisted session
 * was mid-edit (dirty) when last written - a clean session (nothing edited
 * since the last import/load/reset/save) loads straight in with no prompt,
 * since there's nothing at risk of being lost either way.
 *
 * "Discard" reverts to the session's own baseline (the last loaded/saved
 * state), not hardcoded firmware defaults - discarding an in-progress edit
 * to a loaded .ini should land back on that .ini, not erase the fact it was
 * loaded at all.
 */
export function renderRestoreBanner(app: HTMLElement, session: Session) {
  const when = new Date(session.savedAt).toLocaleString();
  const source = loadedFileNameFromSession(session) ?? "firmware defaults";
  app.innerHTML = "";
  app.append(
    el("div", { className: "restore-overlay" }, [
      el("div", { className: "restore-banner" }, [
        el("p", { className: "restore-banner-title" }, [
          icon("exclamationCircle"),
          document.createTextNode(`Unsaved edits from ${when} were found (based on "${source}").`),
        ]),
        el("div", { className: "toolbar" }, [
          iconButton("check", "Restore edits", {
            className: "btn-accent",
            onclick: () => {
              state.values = session.values;
              state.baselineValues = session.baselineValues;
              state.sourceImport = session.sourceImport;
              state.notes = session.notes ?? "";
              state.baselineNotes = session.baselineNotes ?? "";
              state.currentFileBaseName = session.currentFileBaseName;
              state.loadedFileName = loadedFileNameFromSession(session);
              state.baselineLoadedFileName = baselineLoadedFileNameFromSession(session);
              state.activePage = validPage(session.activePage);
              state.firmwareHexText = session.firmwareHexText ?? null;
              state.firmwareHexName = session.firmwareHexName ?? null;
              state.firmwareHexSource = session.firmwareHexSource ?? null;
              state.buildError = session.buildError ?? null;
              persistSession();
              renderApp(app);
            },
          }),
          iconButton("reset", `Discard edits (keep "${source}")`, {
            className: "btn-danger",
            onclick: () => {
              state.values = { ...session.baselineValues };
              state.baselineValues = session.baselineValues;
              state.sourceImport = session.sourceImport;
              state.notes = session.baselineNotes ?? "";
              state.baselineNotes = session.baselineNotes ?? "";
              state.currentFileBaseName = session.currentFileBaseName;
              // Discarding an edit discards an unsaved rename too - revert to
              // the session's own baseline name, not loadedFileNameFromSession
              // (which would keep the dirty renamed value the "Restore edits"
              // branch above intentionally keeps).
              state.loadedFileName = baselineLoadedFileNameFromSession(session);
              state.baselineLoadedFileName = baselineLoadedFileNameFromSession(session);
              state.activePage = validPage(session.activePage);
              state.firmwareHexText = session.firmwareHexText ?? null;
              state.firmwareHexName = session.firmwareHexName ?? null;
              state.firmwareHexSource = session.firmwareHexSource ?? null;
              state.buildError = session.buildError ?? null;
              persistSession();
              renderApp(app);
            },
          }),
        ]),
      ]),
    ]),
  );
}

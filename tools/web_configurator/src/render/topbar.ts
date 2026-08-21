import "./topbar.css";
import "./control.css"; // .revert-btn (shared by the notes/rename revert buttons)
import "../dom.css"; // .toolbar/.btn-* (Import/Load/Save/Reset)
import { importIni } from "../ini-import.ts";
import { parseConfigFile, serializeConfigFile, toConfigFile } from "../config-json.ts";
import { defaultValues } from "../defaults.ts";
import { loadedFileLabel } from "../session.ts";
import {
  state,
  isDirty,
  persistSession,
  syncBaseline,
  clearBuiltFirmware,
  loadTopbarCollapsed,
  saveTopbarCollapsed,
} from "../app-state.ts";
import { el, icon, iconButton, downloadText } from "../dom.ts";
import { renderApp } from "./app-shell.ts";

/** Strips a known config-file extension (.tsdz2.json, .json, .ini) if present - shared by every place a filename becomes state.currentFileBaseName (import, load, and the rename pencil below), so a manually-typed "foo" and an imported "foo.tsdz2.json" land on the same base name instead of drifting apart. */
function baseNameFromFileName(name: string): string {
  return name
    .replace(/\.tsdz2\.json$/i, "")
    .replace(/\.json$/i, "")
    .replace(/\.ini$/i, "");
}

/**
 * Free-text notes about this specific tuned profile - saved/loaded with the
 * .tsdz2.json (Tsdz2ConfigFile.notes), not a firmware setting, so it never
 * touches config.h. The "Edit Note" toggle lives in the topbar toolbar (see
 * its call site); this only builds the row below it, which takes up no
 * space at all when there are no notes and the textarea isn't open -
 * showing an empty "No notes." line permanently was the exact clutter this
 * was redesigned to avoid. When there are notes, the collapsed view is a
 * single truncated line (CSS text-overflow: ellipsis) with the full text in
 * its title attribute - a pasted wall of text stays one line and readable
 * via hover instead of blowing out the topbar's height. Edit mode is a
 * plain <textarea>.
 *
 * sync(editing) is the single source of truth for every element's
 * hidden/visible state, always recomputed fresh from the current
 * state.notes - called both when opening/closing and right after a commit,
 * so there's no separate "now show the new text" bookkeeping to keep in
 * sync with it by hand.
 *
 * Commits on both the textarea's own change (native blur, e.g. clicking a
 * sidebar nav item while still open) and explicitly when the pencil button
 * itself is what causes that blur (closing the row) - belt and suspenders
 * against browser event-ordering differences, since renderApp() can tear
 * down and rebuild this row from state.notes at any time (any other click
 * elsewhere in the app), and an edit not yet committed to state would
 * silently be lost the moment that happens.
 *
 * revertBtn mirrors render/control.ts's renderRevertButton() - same icon/
 * class, and like it, a full renderApp() on click rather than the
 * lightweight sync() the toggle/textarea use elsewhere here - reverting is
 * a discrete action (not a keystroke needing to stay snappy), and only a
 * full render recomputes the topbar's own "Unsaved changes" badge
 * (isDirty(), baked into the DOM once at render time), so that badge can
 * actually clear when this was the only outstanding edit. Lives next to
 * toggle in the topbar's title row rather than inside `row`, so it stays
 * reachable even when `row` itself is collapsed (e.g. notes were cleared
 * back to "" but that's still a change from a non-empty baseline worth
 * being able to undo).
 */
function renderNotesRow(app: HTMLElement): { toggle: HTMLButtonElement; revertBtn: HTMLElement; row: HTMLElement } {
  const textarea = el("textarea", { className: "topbar-notes-textarea", placeholder: "Notes about this profile…" });
  const displayText = el("span", { className: "topbar-notes-text" });
  const row = el("div", { className: "topbar-notes" }, [displayText, textarea]);
  const toggle = iconButton("editNote", "Edit Note", { title: "Edit notes", className: "btn-note" });
  const revertBtn = el(
    "button",
    { type: "button", className: "revert-btn", title: "Revert notes to last saved/loaded value" },
    [icon("revert")],
  );

  const sync = (editing: boolean) => {
    const hasNotes = state.notes.length > 0;
    textarea.value = state.notes;
    displayText.textContent = state.notes;
    displayText.title = state.notes;
    displayText.classList.toggle("hidden", editing || !hasNotes);
    textarea.classList.toggle("hidden", !editing);
    row.classList.toggle("hidden", !editing && !hasNotes);
    toggle.setAttribute("aria-expanded", String(editing));
    revertBtn.classList.toggle("hidden", state.notes === state.baselineNotes);
  };
  sync(false);

  const commit = () => {
    state.notes = textarea.value;
    persistSession();
  };
  textarea.addEventListener("change", commit);
  toggle.addEventListener("click", () => {
    const editing = textarea.classList.contains("hidden"); // currently hidden => this click opens it
    if (!editing) commit(); // closing: commit whatever's typed before re-syncing off it
    sync(editing);
    if (editing) textarea.focus();
  });
  revertBtn.addEventListener("click", () => {
    state.notes = state.baselineNotes;
    persistSession();
    renderApp(app);
  });

  return { toggle, revertBtn, row };
}

/**
 * "Loaded: X" badge with an inline rename control (the pencil). Renaming
 * here never touches the filesystem - nothing writes back to an imported
 * .ini/.tsdz2.json - it only edits state.loadedFileName/currentFileBaseName,
 * which is what every other filename in the app actually reads: Save As's
 * download name, firmware.hex's name, and the Build/Backup & flash pages. Works even
 * with nothing loaded (state.loadedFileName === null, "firmware defaults"),
 * letting a from-scratch config get a name before its first Save As.
 * Tracked by isDirty() via baselineLoadedFileName, the same way an
 * edited-but-unsaved note is - see AppState's own doc comment. Editing is
 * base-name-only - the extension is a fixed ".tsdz2.json" suffix, not
 * user-choosable, since that's the only format Save As/Load actually
 * round-trip (loadedFileName already carries that extension from the moment
 * anything is imported/loaded, per its own doc comment - renaming only ever
 * changes the base name, never the extension).
 *
 * Same toggle/sync/commit shape as renderNotesRow above - see its own doc
 * comment for why editing is local (no full renderApp()) and why the commit
 * happens on the input's native "change" (blur/Enter) rather than every
 * keystroke.
 */
function renderLoadedFileBadge(app: HTMLElement): { badge: HTMLElement; revertBtn: HTMLElement } {
  const input = el("input", { type: "text", className: "loaded-file-input hidden" });
  // Static, not editable - renaming always lands on .tsdz2.json, the one
  // format Save As/Load actually round-trip (see the input's own comment
  // below). Showing it fixed next to the input makes that visible instead of
  // implicit, and rules out someone typing a different extension expecting
  // it to stick.
  const extensionSuffix = el("span", { className: "loaded-file-input-extension hidden", text: ".tsdz2.json" });
  const displayText = el("span", { className: "loaded-file-status-text" });
  const toggle = el(
    "button",
    {
      type: "button",
      className: "loaded-file-rename-btn",
      title: "Rename (display name only - doesn't touch the filesystem)",
    },
    [icon("pencil")],
  );
  const badge = el("span", { className: "loaded-file-status" }, [
    icon("file"),
    displayText,
    input,
    extensionSuffix,
    toggle,
  ]);
  const revertBtn = el(
    "button",
    { type: "button", className: "revert-btn", title: "Revert name to last saved/loaded value" },
    [icon("revert")],
  );

  /** Refreshes everything that reflects the current name/dirty state, without touching the editing open/closed visibility - called after every commit, including a mid-edit blur that isn't closing the row (see commit() below), and also from sync() so the two never drift apart. Reaches past this badge to the topbar's "Unsaved changes" badge for the same reason markChanged() does in render/control.ts - a rename never triggers a full renderApp(), so nothing else recomputes it. */
  const refreshLive = () => {
    badge.classList.toggle("loaded-file-status-active", state.loadedFileName !== null);
    displayText.textContent = loadedFileLabel(state.loadedFileName);
    revertBtn.classList.toggle("hidden", state.loadedFileName === state.baselineLoadedFileName);
    app.querySelector(".unsaved-status")?.classList.toggle("hidden", !isDirty());
  };

  const sync = (editing: boolean) => {
    refreshLive();
    // Base name only - the .tsdz2.json suffix is the fixed span above, not
    // part of what's typed (loadedFileName already carries it, so this is
    // usually a no-op strip, but currentFileBaseName's own fallback here -
    // used only before anything's ever been loaded - has no extension to
    // strip in the first place).
    input.value = baseNameFromFileName(state.loadedFileName ?? state.currentFileBaseName);
    displayText.classList.toggle("hidden", editing);
    input.classList.toggle("hidden", !editing);
    extensionSuffix.classList.toggle("hidden", !editing);
    toggle.setAttribute("aria-expanded", String(editing));
  };
  sync(false);

  const commit = () => {
    // Strips filesystem-invalid characters, then any extension the user
    // typed anyway (.ini, .json, .tsdz2.json, out of habit) - the real
    // extension is always the fixed ".tsdz2.json" suffix above, never
    // user-chosen, since that's the only format Save As/Load actually work
    // with (Save As's filename is built from currentFileBaseName the same
    // way).
    const typed = baseNameFromFileName(input.value.trim().replace(/[<>:"/\\|?*]/g, "_"));
    if (typed) {
      state.currentFileBaseName = typed;
      state.loadedFileName = `${typed}.tsdz2.json`;
    }
    persistSession();
    refreshLive();
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      input.blur(); // commits via the "change" listener above
    } else if (e.key === "Escape") {
      input.value = baseNameFromFileName(state.loadedFileName ?? state.currentFileBaseName); // discard the in-progress edit
      input.blur();
    }
  });
  toggle.addEventListener("click", () => {
    const editing = input.classList.contains("hidden"); // currently hidden => this click opens it
    if (!editing) commit(); // closing: commit whatever's typed before re-syncing off it
    sync(editing);
    if (editing) {
      input.focus();
      input.select();
    }
  });
  revertBtn.addEventListener("click", () => {
    state.loadedFileName = state.baselineLoadedFileName;
    state.currentFileBaseName = state.loadedFileName ? baseNameFromFileName(state.loadedFileName) : "config";
    persistSession();
    renderApp(app);
  });

  return { badge, revertBtn };
}

export function renderTopbar(app: HTMLElement): HTMLElement {
  const fileInputIni = el("input", { type: "file", accept: ".ini", className: "hidden" });
  const fileInputJson = el("input", { type: "file", accept: ".tsdz2.json,.json", className: "hidden" });

  fileInputIni.addEventListener("change", async () => {
    const file = fileInputIni.files?.[0];
    if (!file) return;
    if (isDirty() && !confirm("You have unsaved changes that will be lost if you import a new .ini. Continue?")) {
      fileInputIni.value = "";
      return;
    }
    try {
      const text = await file.text();
      const { values, warnings } = importIni(text);
      state.values = values;
      state.sourceImport = file.name;
      state.notes = ""; // a fresh .ini import starts with no notes, same as sourceImport resetting
      // Importing converts into this tool's own format immediately, not a
      // "still an .ini until you touch it" limbo state - the "Loaded: X"
      // badge reflects that from the moment it's imported, same name
      // .tsdz2.json would land on if saved right now unchanged. sourceImport
      // above still remembers the real .ini it came from (round-trips into a
      // saved .tsdz2.json's own provenance field), just not shown here.
      state.currentFileBaseName = baseNameFromFileName(file.name);
      state.loadedFileName = `${state.currentFileBaseName}.tsdz2.json`;
      // clearBuiltFirmware() must run before syncBaseline() - the latter is
      // what actually persists the session, so this order is what keeps a
      // stale hex from a previous file out of the persisted snapshot too.
      clearBuiltFirmware();
      syncBaseline();
      // A plain success message here would just restate the "Loaded: X"
      // badge next to the title - only worth a status line when there's
      // something the badge doesn't already say (import notes).
      state.statusMessage = warnings.length ? `Imported "${file.name}" with notes:\n${warnings.join("\n")}` : null;
      state.statusKind = "warning";
      renderApp(app);
    } catch (err) {
      state.statusMessage = `Import failed: ${(err as Error).message}`;
      state.statusKind = "error";
      renderApp(app);
    }
  });

  fileInputJson.addEventListener("change", async () => {
    const file = fileInputJson.files?.[0];
    if (!file) return;
    if (isDirty() && !confirm("You have unsaved changes that will be lost if you load a new .tsdz2.json. Continue?")) {
      fileInputJson.value = "";
      return;
    }
    try {
      const text = await file.text();
      const { file: parsed, warnings } = parseConfigFile(text);
      state.values = parsed.fields;
      state.sourceImport = parsed.sourceImport;
      state.notes = parsed.notes;
      // Normalized the same way import does above, rather than trusting the
      // picked file's literal name/extension/casing verbatim (e.g. a
      // .tsdz2.json the user's OS re-saved as "foo (1).JSON") - the badge
      // always reads as this tool's own canonical filename.
      state.currentFileBaseName = baseNameFromFileName(file.name);
      state.loadedFileName = `${state.currentFileBaseName}.tsdz2.json`;
      clearBuiltFirmware();
      syncBaseline();
      // Same reasoning as the .ini path above - only worth a status line
      // when there's something the "Loaded: X" badge doesn't already say
      // (fields this file predated, defaulted rather than rejected - see
      // parseConfigFile's own doc comment).
      state.statusMessage = warnings.length ? `Loaded "${file.name}" with notes:\n${warnings.join("\n")}` : null;
      state.statusKind = "warning";
      renderApp(app);
    } catch (err) {
      state.statusMessage = `Load failed: ${(err as Error).message}`;
      state.statusKind = "error";
      renderApp(app);
    }
  });

  const notes = renderNotesRow(app);
  const loadedFile = renderLoadedFileBadge(app);

  const toolbar = el("div", { className: "toolbar topbar-actions" }, [
    notes.toggle,
    notes.revertBtn,
    iconButton("import", "Import .ini", {
      title:
        "Import a legacy .ini file saved by the original Java TSDZ2 Configurator. One-way and read-only - this never writes back to or overwrites the source .ini.",
      onclick: () => fileInputIni.click(),
    }),
    iconButton("load", "Load .json", {
      title:
        "Load a file previously saved from this web configurator (this tool's own keyed .tsdz2.json format, not a legacy .ini).",
      onclick: () => fileInputJson.click(),
    }),
    iconButton("save", "Save As .json", {
      className: "btn-accent",
      title:
        "Save every current setting to a new .tsdz2.json file. Always a new file - never overwrites an imported .ini or a previously loaded .tsdz2.json.",
      onclick: () => {
        const file = toConfigFile(state.values, state.sourceImport, state.notes);
        downloadText(`${state.currentFileBaseName}.tsdz2.json`, serializeConfigFile(file), "application/json");
        // Whatever the badge said before this (e.g. still ".ini" in an older
        // build, or just a stale rename) now matches what was actually just
        // saved - the "Loaded: X" badge should never claim something other
        // than the .tsdz2.json that's genuinely this session's latest saved
        // state.
        state.loadedFileName = `${state.currentFileBaseName}.tsdz2.json`;
        syncBaseline();
        state.statusMessage = `Saved "${state.currentFileBaseName}.tsdz2.json".`;
        state.statusKind = "info";
        renderApp(app);
      },
    }),
    iconButton("reset", "Reset to defaults", {
      className: "btn-danger",
      title:
        "Discard all edits and return every field to the firmware's built-in defaults. Does not affect any file already saved to disk.",
      onclick: () => {
        // Always confirm, dirty or not - this wipes the loaded file/notes
        // too, not just unsaved edits, so "nothing's dirty" doesn't mean
        // "nothing to lose".
        if (!confirm("This will discard everything and return every field to the firmware's defaults. Continue?"))
          return;
        state.values = defaultValues();
        state.sourceImport = null;
        state.notes = "";
        state.loadedFileName = null;
        state.currentFileBaseName = "config";
        // Deliberately NOT clearBuiltFirmware() here - only Import/Load count
        // as "moving to new work" for that purpose; a reset (or a refresh)
        // shouldn't throw away a build that took ~30s to produce.
        syncBaseline();
        state.statusMessage = null; // "Loaded: firmware defaults" badge already says this
        state.statusKind = "info";
        renderApp(app);
      },
    }),
    fileInputIni,
    fileInputJson,
  ]);

  const dirty = isDirty();

  // Status badges + the import/load/save/reset toolbar, grouped so they can
  // collapse under the title on a narrow phone (see .topbar-collapsible in
  // topbar.css) - on desktop this group is always shown and the toggle below
  // is hidden entirely, so nothing changes there. Collapsed/expanded is
  // persisted (loadTopbarCollapsed/saveTopbarCollapsed above) rather than
  // recomputed from scratch on every render, so a mobile user who expands it
  // doesn't have it silently re-collapse on the next refresh.
  const collapsible = el("div", { className: `topbar-collapsible${loadTopbarCollapsed() ? " collapsed" : ""}` }, [
    loadedFile.badge,
    loadedFile.revertBtn,
    // Always in the DOM (visibility toggled via "hidden"), same reasoning
    // as the sidebar dot above - markChanged()'s fast path needs a node it
    // can find and toggle without a full renderApp().
    el("span", { className: `unsaved-status${dirty ? "" : " hidden"}` }, [
      icon("exclamationCircle"),
      document.createTextNode(" Unsaved changes - autosaved locally"),
    ]),
    toolbar,
  ]);

  const collapseToggle = el(
    "button",
    { type: "button", className: "topbar-toggle", title: "Show/hide status & actions" },
    [icon("chevron")],
  );
  collapseToggle.setAttribute("aria-label", "Show/hide status & actions");
  collapseToggle.setAttribute("aria-expanded", String(!collapsible.classList.contains("collapsed")));
  collapseToggle.addEventListener("click", () => {
    const nowCollapsed = collapsible.classList.toggle("collapsed");
    collapseToggle.setAttribute("aria-expanded", String(!nowCollapsed));
    saveTopbarCollapsed(nowCollapsed);
  });

  return el("div", { className: "topbar" }, [
    el("div", { className: "topbar-row" }, [
      el("h1", {}, [icon("bicycle", "topbar-logo"), document.createTextNode(" TSDZ2 Configurator")]),
      collapseToggle,
      collapsible,
    ]),
    notes.row,
    state.statusMessage
      ? el("div", { className: `warnings warnings-${state.statusKind}` }, [
          state.statusKind === "error" ? icon("exclamationCircle", "warnings-icon") : null,
          document.createTextNode(state.statusMessage),
        ])
      : null,
  ]);
}

import "./app-shell.css";
import {
  state,
  assistChartUpdaters,
  persistSession,
  BUILD_PAGE,
  BACKUP_FLASH_PAGE,
  DISPLAY_FLASH_PAGE,
  DISPLAY_SIM_PAGE,
} from "../app-state.ts";
import { el } from "../dom.ts";
import { writeUrlLocation } from "../url-state.ts";
import { renderTopbar } from "./topbar.ts";
import { renderSidebar } from "./sidebar.ts";
import { renderFooter } from "./footer.ts";
import { renderSectionPage } from "./section-page.ts";
import { renderBuildPage } from "./build-page.ts";
import { renderBackupFlashPage } from "./backup-flash-page.ts";
import { renderDisplayFlashPage } from "./display-flash-page.ts";
import { renderDisplaySimPage } from "./display-sim-page.ts";

/**
 * Single choke point for "switch pages" - every ordinary in-app navigation
 * (sidebar clicks, the footer's connection-chip shortcuts) calls this
 * instead of assigning state.activePage directly, so the URL hash always
 * stays in sync with what's on screen (see url-state.ts's own doc comment
 * for why a hash, not a real path). Deliberately clears any field from the
 * URL - a plain page navigation isn't pointing at one specific field, unlike
 * a shared deep link (see render/control.ts's field-share button, and
 * main.ts's startup/popstate handling for the other side of this).
 */
export function navigateToPage(app: HTMLElement, pageId: string): void {
  state.activePage = pageId;
  persistSession();
  writeUrlLocation(pageId, null);
  renderApp(app);
}

export function renderApp(app: HTMLElement) {
  const prevScroll = app.querySelector(".content-scroll")?.scrollTop ?? 0;
  // Mobile only (.sidebar-nav is a horizontally-scrolling tab strip there,
  // see the 760px breakpoint in render/sidebar.css) - same problem and same fix as
  // .content-scroll above: a full teardown/rebuild on every nav click would
  // otherwise reset the strip to scrollLeft 0 (showing "Motor", the first tab)
  // right as it activates whichever tab the user had scrolled to reach.
  const prevSidebarScroll = app.querySelector(".sidebar-nav")?.scrollLeft ?? 0;
  app.innerHTML = "";
  // Cleared via .length = 0, not reassignment - assistChartUpdaters is a
  // live-bound import from app-state.ts, and ES module bindings can't be
  // reassigned from an importing module, only mutated in place.
  assistChartUpdaters.length = 0;

  const page =
    state.activePage === BUILD_PAGE
      ? renderBuildPage(app)
      : state.activePage === BACKUP_FLASH_PAGE
        ? renderBackupFlashPage(app)
        : state.activePage === DISPLAY_FLASH_PAGE
          ? renderDisplayFlashPage(app)
          : state.activePage === DISPLAY_SIM_PAGE
            ? renderDisplaySimPage(app)
            : renderSectionPage(state.activePage, app);

  app.append(
    el("div", { className: "app-shell" }, [
      renderTopbar(app),
      el("div", { className: "app-body" }, [renderSidebar(app), el("div", { className: "content-scroll" }, [page])]),
      renderFooter(app),
    ]),
  );

  const newScrollEl = app.querySelector(".content-scroll");
  if (newScrollEl) newScrollEl.scrollTop = prevScroll;

  const newSidebarNav = app.querySelector(".sidebar-nav");
  if (newSidebarNav) newSidebarNav.scrollLeft = prevSidebarScroll;

  // Log boxes below always render their full content fresh from state (see
  // AppState.buildLog etc.), so just pin them to the bottom on every rebuild
  // instead of trying to preserve a mid-log scroll position.
  for (const log of app.querySelectorAll<HTMLElement>(".flash-log")) {
    log.scrollTop = log.scrollHeight;
  }
}

// Committed headless-browser regression suite for behavior that only exists
// once main.ts's DOM wiring is exercised for real - clicks, file uploads,
// localStorage-across-refresh - none of which src/__tests__/*.test.ts can
// reach (main.ts can't even be imported outside a real browser; see its
// module-scope document/localStorage use). Complements, doesn't replace,
// the pure-logic unit tests in src/__tests__/.
//
// Deliberately does NOT attempt to cover the actual build/flash/backup/
// restore WASM+WebUSB flow end to end - that needs a real ST-Link and a
// real board (no such thing in headless CI), and the in-browser SDCC build
// alone takes ~30s and loads a 17MB wasm module, too slow for a routine
// regression check. That flow's pure, historically-buggy logic (WASM result
// validation, runtime-helper symbol resolution) is covered instead by
// src/__tests__/flasher.test.ts and sdcc-link-discovery.test.ts. This file
// covers the DOM/session layer only. See tools/CLAUDE.md's "Build & flash
// page" section for how that flow has actually been validated (on real
// hardware, by riding).
//
// Uses Playwright (not Puppeteer) driving Playwright's own bundled Chromium
// (`npx playwright install chromium`), not the system's desktop Google
// Chrome. Two separate slowness/hang issues were found and fixed in this
// project's sandboxed/Wayland desktop environment, in this order:
// 1. Switching Puppeteer from legacy `headless: true` to `headless: "new"`
//    did NOT help a multi-minute suite runtime (still ~12m for these 3 tiny
//    scenarios, ~0s of actual CPU against 12+ minutes of wall clock per
//    `time` - wait-bound, not a headless-mode/rendering-cost issue).
// 2. Switching to Playwright's bundled Chromium fixed the *scenarios*
//    running slowly, but exposed a second, worse issue: `browser.close()`
//    (and occasionally `page.close()`) can hang forever - the browser
//    process itself is already gone, but the CDP "close" handshake never
//    resolves, so the script sits at 0% CPU indefinitely and never returns
//    control to the shell. Root cause not understood. Fixed defensively
//    (not by understanding *why* it hangs) via `withTimeout()`/`killVite()`
//    below, plus an explicit `process.exit()` at the very end of `main()` -
//    every close() call is bounded, and the whole script force-exits rather
//    than trusting the event loop to drain naturally. See project memory /
//    UNIVERSAL_FIRMWARE_PLAN.md's web configurator section for the measured
//    before/after of both issues.

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { buildTsdz2JsonFixture } from "./fixtures.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PORT = 5199; // dedicated to e2e, distinct from the default 5173 dev port so this never fights a dev server you already have open
const BASE_URL = `http://localhost:${PORT}/`;
const FIXTURE_INI = `${REPO_ROOT}settings/proven/Default_Settings_TSDZ2_48V.ini`;

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Dev server didn't come up at ${url} within ${timeoutMs}ms`);
}

// Reads .loaded-file-status-text specifically, not the whole .loaded-file-status
// badge - that container also holds a *hidden* (display:none while not renaming)
// ".tsdz2.json" extension-suffix span for the rename UI, and Element.textContent
// doesn't respect CSS visibility - it silently includes hidden descendants' text
// too. Reading the whole badge concatenated that hidden ".tsdz2.json" onto every
// real "Loaded: X" string (e.g. "...48V.tsdz2.json" read back as
// "...48V.tsdz2.json.tsdz2.json"), which looked exactly like a real double-
// extension bug in the app - it wasn't; only this test's selector was wrong.
async function badgeText(page: Page): Promise<string> {
  return page.$eval(".loaded-file-status-text", (el) => el.textContent!.trim());
}

async function clickSidebarItem(page: Page, labelSubstring: string): Promise<void> {
  await page.$$eval(
    ".sidebar-item",
    (items, label) => {
      const item = items.find((i) => i.textContent?.includes(label));
      if (!item) throw new Error(`No sidebar item containing "${label}"`);
      (item as HTMLElement).click();
    },
    labelSubstring,
  );
  await new Promise((r) => setTimeout(r, 150));
}

// browser.close()/page.close() have been observed to hang indefinitely in
// this project's sandboxed/Wayland dev environment (confirmed 2026-08-14:
// a run sat at 0% CPU for 12+ minutes after every scenario had already
// printed "ok", never returning control to the shell - the browser process
// itself was already gone, so the CDP "close" handshake was waiting on a
// connection that would never respond). Root cause isn't understood, so
// this bounds every close() call instead of trusting it to resolve, and
// the whole script force-exits at the end rather than relying on the event
// loop draining naturally - a hung close() (or a stray open handle from
// vite/Playwright) must never be able to make `npm run test:e2e` hang
// forever again.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.error(`test:e2e: ${label} didn't finish within ${ms}ms - giving up and moving on.`);
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// process.exit() called synchronously right after a console.log/error can
// truncate output that hasn't finished flushing to a piped (non-TTY)
// stdout/stderr yet - a real Node gotcha, not hypothetical: an earlier
// version of this function called process.exit() directly and every run
// in this project's environment came back with completely empty captured
// output despite scenarios genuinely running and passing/failing. Setting
// process.exitCode instead lets Node exit naturally once its own streams
// drain and the event loop empties - which also happens to be exactly what
// we want in the common case. The unref()'d timer is only a backstop for
// the browser.close()-hangs-forever case above: if something is still
// keeping the event loop alive 300ms after this is called, force it.
function exitSoon(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300).unref();
}

async function killVite(vite: ChildProcess | undefined): Promise<void> {
  if (!vite || vite.exitCode !== null) return;
  vite.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (vite.exitCode === null) vite.kill("SIGKILL");
      resolve();
    }, 2000);
    vite.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

type Scenario = (page: Page) => Promise<void>;

const scenarios: Record<string, Scenario> = {
  // Regression test for the bug that prompted this suite: the header's
  // "Loaded: X" badge was driven by sourceImport (.ini provenance, carried
  // forward unchanged through a .tsdz2.json save/load round trip) instead
  // of by what was actually just opened - so loading a .tsdz2.json that
  // happened to share its originating .ini's provenance left the badge
  // frozen on the old .ini's filename. session.test.ts unit-tests the fixed
  // logic in isolation; this proves main.ts's file-input handlers actually
  // call it.
  //
  // Importing an .ini normalizes the badge to this tool's own .tsdz2.json
  // name immediately (see topbar.ts's fileInputIni handler comment) - not a
  // "still shows .ini until you touch it" limbo state - so step 1's badge
  // already reads as a .tsdz2.json name, same as step 2's. What makes step 2
  // a real regression check despite that is giving the loaded .tsdz2.json
  // fixture a *different* base name than the .ini it was saved from
  // (simulating a renamed/re-saved file) while keeping its `sourceImport`
  // pointed at that same .ini - the old bug would show that stale .ini-
  // derived name instead of the file just opened.
  "loaded-file badge updates on a .tsdz2.json load, even one whose sourceImport matches the .ini currently shown":
    async (page) => {
      const iniInput = await page.$('input[type=file][accept=".ini"]');
      if (!iniInput) throw new Error("no .ini file input found");
      await iniInput.setInputFiles(FIXTURE_INI);
      await new Promise((r) => setTimeout(r, 300));
      const afterIni = await badgeText(page);
      if (!afterIni.includes("Default_Settings_TSDZ2_48V.tsdz2.json")) {
        throw new Error(`expected badge to show the imported .ini's normalized .tsdz2.json name, got "${afterIni}"`);
      }

      const jsonFixture = buildTsdz2JsonFixture(FIXTURE_INI, "renamed-profile");
      const jsonInput = await page.$('input[type=file][accept=".tsdz2.json,.json"]');
      if (!jsonInput) throw new Error("no .tsdz2.json file input found");
      await jsonInput.setInputFiles(jsonFixture);
      await new Promise((r) => setTimeout(r, 300));
      const afterJson = await badgeText(page);
      if (!afterJson.includes("renamed-profile.tsdz2.json")) {
        throw new Error(`expected badge to switch to the loaded .tsdz2.json's own name, got "${afterJson}"`);
      }
    },

  // Regression test for tab selection not surviving a refresh (fixed
  // earlier this project by calling persistSession() from the sidebar's
  // onclick, which had been missing it).
  "active sidebar section survives a page refresh": async (page) => {
    await clickSidebarItem(page, "Advanced torque calibration");
    const beforeReload = await page.$eval("h2", (el) => el.textContent);
    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await page.$eval("h2", (el) => el.textContent);
    if (afterReload !== beforeReload) {
      throw new Error(`expected active section to survive a refresh: was "${beforeReload}", now "${afterReload}"`);
    }
  },

  // Regression test: number/text/signedOffset fields update via markChanged()
  // (a fast path that skips the full renderApp() other control kinds trigger,
  // to keep typing responsive - see its own comment in main.ts), which used
  // to leave the sidebar's per-section dirty dot and the topbar's "Unsaved
  // changes" badge stale until some unrelated full render happened (e.g.
  // navigating to a different section). Both are supposed to update the
  // instant a field changes, without navigating away first.
  "sidebar dirty dot and topbar 'Unsaved changes' badge update live while typing, not just after navigating away":
    async (page) => {
      const iniInput = await page.$('input[type=file][accept=".ini"]');
      if (!iniInput) throw new Error("no .ini file input found");
      await iniInput.setInputFiles(FIXTURE_INI);
      await new Promise((r) => setTimeout(r, 300));

      await clickSidebarItem(page, "Motor");

      const dotHiddenBefore = await page.$eval(".sidebar-dot[data-section-id='motor']", (el) =>
        el.classList.contains("hidden"),
      );
      if (!dotHiddenBefore) throw new Error("expected Motor's sidebar dot to start hidden - nothing changed yet");

      await page.$$eval(".field", (fields) => {
        const field = fields.find((f) => f.textContent?.includes("Motor acceleration"));
        if (!field) throw new Error('no "Motor acceleration" field found');
        // Motor acceleration has a sliderRange (paired range + number inputs,
        // range first in DOM order - see render/control.ts) - the range
        // input only reacts to "input" events (dragging), while the actual
        // typed-value box is the number input right after it. Excluding
        // type=range here, rather than just grabbing the first <input>,
        // keeps this generic "does editing a number field mark it dirty"
        // check working the same way regardless of whether the target field
        // happens to have a slider.
        const input = field.querySelector('input:not([type="range"])');
        if (!input) throw new Error("no non-range input in the Motor acceleration field");
        (input as HTMLInputElement).value = "99";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 150));

      const dotHiddenAfter = await page.$eval(".sidebar-dot[data-section-id='motor']", (el) =>
        el.classList.contains("hidden"),
      );
      if (dotHiddenAfter) {
        throw new Error("Motor's sidebar dot should show unsaved changes immediately, without navigating away first");
      }

      const badgeHidden = await page.$eval(".unsaved-status", (el) => el.classList.contains("hidden"));
      if (badgeHidden) {
        throw new Error("topbar 'Unsaved changes' badge should show immediately, without navigating away first");
      }
    },
};

async function main() {
  let vite: ChildProcess | undefined;
  let browser: Browser | undefined;
  let failures = 0;
  let stoppingVite = false;
  try {
    // Spawn the local vite binary directly, not `npx vite` - npx runs vite as
    // its own grandchild, and killVite() below can only SIGTERM/SIGKILL the
    // direct child it has a handle to (npx itself). Killing npx doesn't
    // propagate to a process it spawned, so the real vite dev server was
    // orphaned and kept squatting on PORT after every run (confirmed
    // 2026-08-14: it silently served the next run's traffic too, masking the
    // leak - the next run only surfaced it as a harmless-looking "Port 5199
    // is already in use" from the *new* vite instance failing to bind, while
    // the leftover one kept working). Spawning the real binary directly
    // means the ChildProcess we hold *is* the vite server, so killing it
    // actually kills it.
    vite = spawn(`${ROOT}node_modules/.bin/vite`, ["--port", String(PORT), "--strictPort"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    let viteOutput = "";
    vite.stdout?.on("data", (d) => (viteOutput += d.toString()));
    vite.stderr?.on("data", (d) => (viteOutput += d.toString()));
    vite.on("exit", (code) => {
      if (!stoppingVite && code !== null && code !== 0)
        console.error(`vite exited early (code ${code}):\n${viteOutput}`);
    });

    await waitForServer(BASE_URL);

    try {
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Executable doesn't exist")) {
        console.warn(
          "test:e2e: Playwright's Chromium isn't installed - skipping. Run `npx playwright install chromium` to enable this suite.",
        );
        exitSoon(0);
        return;
      }
      throw err;
    }

    for (const [name, run] of Object.entries(scenarios)) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      try {
        await page.goto(BASE_URL, { waitUntil: "networkidle" });
        await run(page);
        console.log(`ok - ${name}`);
      } catch (err) {
        failures++;
        console.error(`FAIL - ${name}`);
        console.error(err instanceof Error ? err.message : err);
      } finally {
        await withTimeout(page.close(), 5000, "page.close()");
      }
    }
  } finally {
    if (browser) await withTimeout(browser.close(), 8000, "browser.close()");
    stoppingVite = true;
    await killVite(vite);
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${Object.keys(scenarios).length} e2e scenario(s) failed.`);
  } else {
    console.log(`\nAll ${Object.keys(scenarios).length} e2e scenarios passed.`);
  }
  exitSoon(failures > 0 ? 1 : 0);
}

main();

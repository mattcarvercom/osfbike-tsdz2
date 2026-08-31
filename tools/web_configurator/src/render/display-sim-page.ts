import "./build-flash-page.css"; // .card/.subtitle - reused as-is
import "./app-shell.css"; // .page/.page-title
import "../dom.css"; // .toolbar/.btn-*
import "./display-sim-page.css";
import { el, icon, iconButton, renderToggleGroup, ICONS } from "../dom.ts";
import { createDisplaySim, DISPLAY_SIM_WIDTH, DISPLAY_SIM_HEIGHT, type DisplaySim } from "../display-sim.ts";
import { renderApp } from "./app-shell.ts";

// Module-level, not AppState: this is a live simulator's ephemeral runtime
// state (loaded module, tick timer, current slider values), not something
// that belongs in the saved config/session - same reasoning as build-flash-
// page.ts's motorCatalog. Only one canvas/sim instance exists at a time
// (this page has one canvas), so a single set of module-level variables is
// enough - no need to key these by anything.
let sim: DisplaySim | null = null;
let simLoadError: string | null = null;
let simLoadPromise: Promise<void> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let running = true;
// Starts on - lets a fresh visit to this page immediately show something
// moving instead of a static boot state, without needing to find/click the
// toggle first.
let randomizing = true;

// Real ui_vars.ui8_error_states bit layout (mainscreen.c's renderWarning(),
// mainscreen.h's ERROR_* defines) - one bit per distinct fault, not a plain
// 1-N index. "No fault" (0) clears it.
const FAULT_CODES: { bits: number; label: string }[] = [
  { bits: 0, label: "No fault" },
  { bits: 1, label: "Motor not init" },
  { bits: 2, label: "Torque Fault" },
  { bits: 4, label: "Cadence Fault" },
  { bits: 8, label: "Motor Blocked" },
  { bits: 16, label: "Throttle Fault" },
  { bits: 32, label: "Fatal / Undervoltage" },
  { bits: 64, label: "Overcurrent" },
  { bits: 128, label: "Speed Fault" },
];

// Persisted separately from the rest of `telemetry` (which is deliberately
// NOT saved anywhere - see its own comment) because this one field is meant
// to feel like a real device setting, not simulator scratch state: it's the
// same ui_vars.ui8_units_type the on-device config menu's own "Units" field
// controls (see unitsToggle()'s doc comment below), so it should survive a
// reload the same way a real display's EEPROM-backed setting would.
const UNITS_IMPERIAL_KEY = "tsdz2-display-sim-units-imperial";

function loadUnitsImperial(): boolean {
  try {
    const raw = localStorage.getItem(UNITS_IMPERIAL_KEY);
    // Matches the real firmware's default (eeprom.h's DEFAULT_VALUE_UNITS_TYPE) when nothing's stored yet.
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function saveUnitsImperial(imperial: boolean): void {
  try {
    localStorage.setItem(UNITS_IMPERIAL_KEY, String(imperial));
  } catch {
    // localStorage full/unavailable/disabled - same as app-state.ts's own session persistence, a convenience, not required
  }
}

const telemetry = {
  batterySoc: 72,
  speedX10: 180, // 18.0 km/h
  cadence: 70,
  assistLevel: 2,
  motorPower: 120,
  motorTemperature: 25,
  humanPower: 90,
  batteryVoltageX10: 420, // 42.0V
  lights: false,
  // Currently-applied fault (see FAULT_CODES above) - 0 (none) until the
  // "Trigger fault" button pushes a selected dropdown value through.
  faultCode: 0,
  unitsImperial: loadUnitsImperial(),
  // Sim-only override for the status-bar wrench icon (theme_osf_modern.c) -
  // see sim.setServiceDue()'s own doc comment. Off by default, matching the
  // real firmware default (both A/B service disabled -> icon never shows).
  serviceDue: false,
};

// Every numeric (range-slider) telemetry field, keyed for the Randomize
// toggle below - deliberately excludes the boolean/enum-ish fields (units/
// lights/fault): the user asked for sliders to move on their own, not for
// those to flip randomly too.
type NumericTelemetryKey = Exclude<keyof typeof telemetry, "lights" | "faultCode" | "unitsImperial" | "serviceDue">;

interface RandomizableSlider {
  key: NumericTelemetryKey;
  input: HTMLInputElement;
  valueLabel: HTMLElement;
  min: number;
  max: number;
  unit: string;
  // Where this slider is animating toward - set whenever its own
  // ticksUntilRetarget countdown reaches 0, approached gradually by
  // randomizeTick() every tick rather than jumped to instantly. Starts
  // equal to the slider's initial value so nothing drifts before
  // Randomize is ever turned on.
  target: number;
  // Constant per-tick increment toward `target`, recomputed on every
  // retarget as (target - value-at-that-moment) / retargetTicks - a
  // straight, constant-rate ramp that covers the whole retarget window,
  // not an exponential ease that sprints early and then sits idle waiting
  // for the next retarget (which read as "jumpy" - most of the motion
  // compressed into the first fraction of the window, then a visible
  // pause).
  stepPerTick: number;
  // Ticks remaining until this slider picks a new random target. Each
  // slider counts down independently (seeded to a random initial phase,
  // see slider() below) so retargets land at different moments instead of
  // every randomized slider visibly lurching in lockstep.
  ticksUntilRetarget: number;
  // This slider's own average tick count between retargets - real riding
  // telemetry doesn't all change at the same cadence (see randomKey's own
  // per-field values below), so this is per-slider, not a shared constant.
  retargetTicks: number;
  // Multiplier on the base ±15%-of-range swing per retarget. Pedal torque
  // (human power, and the motor power that tracks assisting it) genuinely
  // surges/fades within a single pedal stroke, not just between rider
  // effort changes - a bigger multiplier plus a shorter retargetTicks (set
  // per-field below) is what makes those two look like real mid-stroke
  // torque ripple instead of a slow, steady ramp like speed or battery %.
  volatility: number;
}

// Default: pick a new random target every ~1.5s (75 ticks at the tick
// loop's 20ms rate) - slow enough that a rider's cadence/speed/effort
// genuinely looks like it's settling toward a new level, not flickering.
// Individual fields (see slider() call sites) override this to be faster
// where the real quantity is naturally choppier.
const RANDOMIZE_DEFAULT_RETARGET_TICKS = 75;

// Advances every randomized slider by one tick: counts down its retarget
// timer (picking a fresh target + per-tick ramp step when it elapses,
// jittered ±25% so sliders don't stay in sync with each other) and moves
// its telemetry value one constant step closer to its current target.
// Telemetry writes and DOM updates happen directly here (no renderApp() -
// this runs inside the tick loop, same reasoning as every other per-tick
// canvas update: a full page rebuild every 20ms would be wasteful and
// would fight the tick loop's own canvas-identity tracking, see
// startTickLoop()'s doc comment). Returns whether anything actually
// moved, so the caller only pays for applyTelemetry() on ticks where a
// value genuinely changed.
function randomizeTick(sliders: RandomizableSlider[]): boolean {
  let changed = false;
  for (const s of sliders) {
    s.ticksUntilRetarget--;
    if (s.ticksUntilRetarget <= 0) {
      const range = s.max - s.min;
      const delta = (Math.random() * 2 - 1) * range * 0.15 * s.volatility;
      s.target = Math.max(s.min, Math.min(s.max, s.target + delta));
      s.stepPerTick = (s.target - telemetry[s.key]) / s.retargetTicks;
      s.ticksUntilRetarget = Math.round(s.retargetTicks * (0.75 + Math.random() * 0.5));
    }
    const current = telemetry[s.key];
    if (current === s.target || s.stepPerTick === 0) continue;
    let next = current + s.stepPerTick;
    // Clamp to the target instead of overshooting past it on the last step.
    if ((s.stepPerTick > 0 && next >= s.target) || (s.stepPerTick < 0 && next <= s.target)) {
      next = s.target;
    }
    const rounded = Math.round(next);
    if (rounded !== current) {
      telemetry[s.key] = rounded;
      s.input.value = String(rounded);
      s.valueLabel.textContent = `${rounded}${s.unit}`;
      changed = true;
    }
  }
  return changed;
}

function applyTelemetry() {
  if (!sim) return;
  sim.setBatterySoc(telemetry.batterySoc);
  sim.setWheelSpeedX10(telemetry.speedX10);
  sim.setCadence(telemetry.cadence);
  sim.setAssistLevel(telemetry.assistLevel);
  sim.setMotorPower(telemetry.motorPower);
  sim.setMotorTemperature(telemetry.motorTemperature);
  sim.setHumanPower(telemetry.humanPower);
  sim.setBatteryVoltageX10(telemetry.batteryVoltageX10);
  sim.setLights(telemetry.lights);
  sim.setError(telemetry.faultCode);
  sim.setUnitsImperial(telemetry.unitsImperial);
  sim.setServiceDue(telemetry.serviceDue);
}

// The top-right clock is a separate field from the firmware's own "up
// time" (elapsed-since-boot) counter - see display-sim.ts's setWallClock()
// doc comment - so this only ever needs to track the browser's real clock,
// not simulated elapsed time. Called once on load and then once a minute;
// no need for tick-rate precision on a clock that only displays HH:MM.
function syncWallClock(): void {
  if (!sim) return;
  const now = new Date();
  sim.setWallClock(now.getHours(), now.getMinutes());
}

function ensureSimLoaded(app: HTMLElement): void {
  if (sim || simLoadPromise) return;
  simLoadPromise = createDisplaySim()
    .then((created) => {
      sim = created;
      applyTelemetry();
      syncWallClock();
      renderApp(app);
    })
    .catch((err: unknown) => {
      simLoadError = (err as Error).message;
      renderApp(app);
    });
}

// Always tears down any previous interval before arming a new one, rather
// than a "skip if one's already running" guard - app-shell.ts's renderApp()
// does a full app.innerHTML = "" + rebuild on EVERY call, including in-page
// state changes like the Pause/Randomize buttons' own onclick handlers (not
// just page navigation), so this runs far more often than "once per page
// visit". A skip-if-already-running guard raced with that: at the moment a
// button's onclick calls renderApp() synchronously, the previous interval
// (bound to the now-detached old canvas) is still technically "running" -
// its own isConnected self-cancel check hasn't had a chance to fire yet,
// since that only happens on the interval's next async tick - so the guard
// would block arming a new one for the fresh canvas, leaving the loop dead
// until some LATER, unrelated click happened to land after the stale timer
// finally self-cleared. Invisible for Pause (a second click - Resume -
// usually came late enough to dodge the race) but fully broke Randomize
// (meant to keep running untouched after one click). Unconditionally
// clearing first removes the race entirely.
function startTickLoop(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  randomizableSliders: RandomizableSlider[],
  lightsCheckbox: HTMLInputElement,
  syncUnitsToggle: (imperial: boolean) => void,
): void {
  if (tickTimer !== null) clearInterval(tickTimer);
  let lastClockSyncMinute = -1;
  tickTimer = setInterval(() => {
    if (!canvas.isConnected) {
      if (tickTimer !== null) clearInterval(tickTimer);
      tickTimer = null;
      return;
    }
    if (!running || !sim) return;
    const nowMinute = new Date().getMinutes();
    if (nowMinute !== lastClockSyncMinute) {
      lastClockSyncMinute = nowMinute;
      syncWallClock();
    }
    if (randomizing && randomizeTick(randomizableSliders)) applyTelemetry();
    sim.tick();
    // The firmware can flip ui_vars.ui8_lights on its own (a long UP press
    // toggles it directly, mainscreen.c's anyscreen_onpress()) without ever
    // going through setLights() above - applyTelemetry() only ever pushes
    // JS->WASM, so without this readback the "Lights" checkbox would drift
    // out of sync with what the simulated display is actually showing.
    const firmwareLights = sim.getLights();
    if (firmwareLights !== telemetry.lights) {
      telemetry.lights = firmwareLights;
      lightsCheckbox.checked = firmwareLights;
    }
    // Same readback reasoning as lights above, for Units - the on-device
    // config menu (Display -> Units) writes ui_vars.ui8_units_type directly
    // too, reachable via the M button, not just this page's own toggle.
    const firmwareUnitsImperial = sim.getUnitsImperial();
    if (firmwareUnitsImperial !== telemetry.unitsImperial) {
      telemetry.unitsImperial = firmwareUnitsImperial;
      saveUnitsImperial(firmwareUnitsImperial);
      syncUnitsToggle(firmwareUnitsImperial);
    }
    sim.renderInto(imageData);
    ctx.putImageData(imageData, 0, 0);
  }, 20); // matches the real firmware's own main_idle() cadence (main.c)
}

/**
 * Runs the real 860C display UI (this repo's own firmwares/display/860C
 * source, compiled to WASM against a fake framebuffer/button/telemetry
 * driver - see wasm-display-sim/sim_glue.c) in a canvas. Nothing about how
 * the display talks to the motor controller is touched or exercised here -
 * this is purely for iterating on look/feel before it'd ever be baked into
 * real firmware source.
 */
// DISPLAY_SIM_FIRMWARE_VERSION must match wasm-display-sim/build.sh's
// -DDISPLAY_FIRMWARE_MAJOR/MINOR/PATCH (which itself tracks
// common/Makefile.common's real build-version constants) - this is the
// same manually-edited version the sim's own Technical info screen shows.
const DISPLAY_SIM_FIRMWARE_VERSION = "1.0.0";
export function renderDisplaySimPage(app: HTMLElement): HTMLElement {
  ensureSimLoaded(app);

  if (simLoadError) {
    return el("div", { className: "page" }, [
      el("h2", { className: "page-title" }, [icon("eye"), document.createTextNode(" Display UI sim")]),
      el("p", { className: "subtitle flash-status flash-status-error" }, [
        icon("exclamationCircle"),
        document.createTextNode(`Failed to load the sim: ${simLoadError}`),
      ]),
    ]);
  }

  if (!sim) {
    return el("div", { className: "page" }, [
      el("h2", { className: "page-title" }, [icon("eye"), document.createTextNode(" Display UI sim")]),
      el("p", { className: "subtitle", text: "Loading…" }),
    ]);
  }

  const canvas = el("canvas", {
    className: "display-sim-canvas",
    width: DISPLAY_SIM_WIDTH,
    height: DISPLAY_SIM_HEIGHT,
  }) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const imageData = ctx.createImageData(DISPLAY_SIM_WIDTH, DISPLAY_SIM_HEIGHT);
  sim.renderInto(imageData);
  ctx.putImageData(imageData, 0, 0);
  // startTickLoop() itself is called further down, once the sliders below
  // have populated this - the tick loop needs their actual DOM elements to
  // drive Randomize, not just their initial values.
  const randomizableSliders: RandomizableSlider[] = [];

  const pauseBtn = iconButton(running ? "pause" : "play", running ? "Pause" : "Resume", {
    className: running ? undefined : "btn-accent",
    title:
      "Freezes the whole simulated firmware - clock, graph history, screen redraws - exactly where it is; button presses and slider changes stop taking visible effect until resumed.",
    onclick: () => {
      running = !running;
      renderApp(app);
    },
  });

  const randomizeBtn = iconButton("dice", randomizing ? "Randomize: on" : "Randomize: off", {
    className: randomizing ? "btn-accent" : undefined,
    title:
      "When on, nudges a few random telemetry sliders every ~500ms to simulate some action happening - a quick way to see the UI move without manually dragging sliders.",
    onclick: () => {
      randomizing = !randomizing;
      renderApp(app);
    },
  });

  // Arranged to trace a capital "T" rotated 90° counter-clockwise onto its
  // side - the real 850C/860C's own physical button layout: a vertical
  // +/- rocker on the left (the T's crossbar, rotated upright), with M and
  // power sitting to its right at the vertical midpoint (the T's stem,
  // rotated to horizontal) - see display-sim-page.css's grid-template-areas
  // for the actual placement.
  function pressButton(id: number, gridArea: string, iconName: keyof typeof ICONS | null, label: string): HTMLElement {
    const btn = el(
      "button",
      { type: "button", className: `display-sim-btn display-sim-btn-${gridArea}`, title: label },
      iconName ? [icon(iconName)] : [document.createTextNode(label)],
    );
    btn.setAttribute("aria-label", label);
    const press = (down: boolean) => {
      sim?.setButton(id, down);
    };
    btn.addEventListener("pointerdown", () => press(true));
    btn.addEventListener("pointerup", () => press(false));
    btn.addEventListener("pointerleave", () => press(false));
    return btn;
  }

  const buttonPad = el("div", { className: "display-sim-buttons" }, [
    pressButton(0, "plus", "plus", "UP"),
    pressButton(1, "minus", "minus", "DOWN"),
    pressButton(3, "m", null, "M"),
    pressButton(2, "pwr", "power", "PWR"),
  ]);

  function slider(
    label: string,
    min: number,
    max: number,
    value: number,
    onInput: (v: number) => void,
    unit = "",
    // Only needed so the Randomize toggle can drive this slider directly
    // from the tick loop later (see RandomizableSlider) - the value itself
    // is still written through onInput above, same as every slider.
    randomKey?: NumericTelemetryKey,
    // How choppy this field's own randomization looks - see
    // RandomizableSlider's volatility/retargetTicks doc comments. Defaults
    // suit slow-changing rider-effort fields (speed, cadence, battery %);
    // human/motor power override both to look like real pedal-stroke
    // torque ripple instead.
    randomVolatility = 1,
    randomRetargetTicks = RANDOMIZE_DEFAULT_RETARGET_TICKS,
  ): HTMLElement {
    const valueLabel = el("span", { className: "display-sim-slider-value", text: `${value}${unit}` });
    const input = el("input", {
      type: "range",
      min: String(min),
      max: String(max),
      value: String(value),
    }) as HTMLInputElement;
    // Declared before the listener below so a manual drag can re-target it
    // (see the listener body) - otherwise dragging a slider while Randomize
    // is on would get smoothly pulled back toward its last random target a
    // moment later, fighting the user's own input.
    let randomEntry: RandomizableSlider | undefined;
    input.addEventListener("input", () => {
      const v = Number(input.value);
      onInput(v);
      valueLabel.textContent = `${v}${unit}`;
      if (randomEntry) {
        randomEntry.target = v;
        randomEntry.stepPerTick = 0; // a manual drag lands exactly on target - nothing left to ramp until the next retarget
      }
      applyTelemetry();
    });
    if (randomKey) {
      randomEntry = {
        key: randomKey,
        input,
        valueLabel,
        min,
        max,
        unit,
        target: value,
        stepPerTick: 0,
        retargetTicks: randomRetargetTicks,
        volatility: randomVolatility,
        // Randomized initial phase so sliders don't all retarget on the
        // same tick when Randomize first turns on.
        ticksUntilRetarget: Math.round(randomRetargetTicks * Math.random()),
      };
      randomizableSliders.push(randomEntry);
    }
    return el("label", { className: "display-sim-slider" }, [
      el("span", { className: "display-sim-slider-label", text: label }),
      input,
      valueLabel,
    ]);
  }

  function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = checked;
    input.addEventListener("change", () => {
      onChange(input.checked);
      applyTelemetry();
    });
    return el("label", { className: "display-sim-slider display-sim-toggle" }, [
      el("span", { className: "display-sim-slider-label", text: label }),
      input,
    ]);
  }

  // Captured separately (rather than inlined below like the other toggles)
  // so startTickLoop() can poll sim.getLights() every tick and keep this
  // checkbox in sync when the firmware flips ui_vars.ui8_lights on its own
  // (a long UP press) - see startTickLoop()'s own comment on why that
  // readback is needed at all.
  const lightsToggle = toggle("Lights", telemetry.lights, (v) => (telemetry.lights = v));
  const lightsCheckbox = lightsToggle.querySelector("input") as HTMLInputElement;

  // One-way override only (JS -> WASM, no readback) - unlike Lights/Units
  // above, nothing in the sim can flip this back on its own within a normal
  // session (see sim_set_service_due()'s own doc comment on why "off" sets
  // a large distance rather than just disabling), so there's nothing to
  // poll for.
  const serviceToggle = toggle("Service due", telemetry.serviceDue, (v) => (telemetry.serviceDue = v));

  // Two-button Imperial/Metric segmented control (dom.ts's own
  // renderToggleGroup(), the same component radio/intSelect fields with <=3
  // options use elsewhere in this app), not a checkbox like the other
  // toggles here - "Imperial units: on/off" reads fine for a boolean, but
  // "Units" doesn't (off implies neither, when it's really always one or
  // the other). Drives the exact same ui_vars.ui8_units_type the on-device
  // config menu's own "Units" field controls (sim_set_units_imperial(),
  // sim_glue.c) - not a separate sim-only preference - and is persisted to
  // localStorage (loadUnitsImperial()/saveUnitsImperial() above) so it
  // survives a reload the way a real EEPROM-backed setting would, unlike
  // every other telemetry field here (deliberately NOT persisted - see
  // `telemetry`'s own comment).
  // renderToggleGroup() returns a fresh element each call (no "just update
  // the active index" method on the one it already built) - syncUnitsButtons()
  // below is the one place that rebuilds-and-swaps it in place via
  // replaceWith(), so both the click handler and startTickLoop's firmware
  // readback (which don't otherwise share a code path) go through the same
  // DOM update. Deliberately NOT a full renderApp() here, same reasoning as
  // lightsCheckbox above - this runs inside the live tick loop too.
  let unitsToggleGroup: HTMLElement = renderToggleGroup(
    ["Imperial", "Metric"],
    telemetry.unitsImperial ? 0 : 1,
    false,
    (index) => onUnitsSelect(index === 0),
  );
  function syncUnitsButtons(imperial: boolean): void {
    const replacement = renderToggleGroup(["Imperial", "Metric"], imperial ? 0 : 1, false, (index) =>
      onUnitsSelect(index === 0),
    );
    unitsToggleGroup.replaceWith(replacement);
    unitsToggleGroup = replacement;
  }
  // Only the real click path - startTickLoop's own readback updates
  // telemetry/localStorage itself (see its own comment) and calls
  // syncUnitsButtons() directly, without going through this.
  function onUnitsSelect(imperial: boolean): void {
    telemetry.unitsImperial = imperial;
    saveUnitsImperial(imperial);
    applyTelemetry();
    syncUnitsButtons(imperial);
  }
  const unitsToggle = el("label", { className: "display-sim-slider display-sim-toggle" }, [
    el("span", { className: "display-sim-slider-label", text: "Units" }),
    unitsToggleGroup,
  ]);

  // Dropdown + trigger button, not a live-on-select toggle - lets you pick
  // a fault type first without immediately flipping ui_vars.ui8_error_states,
  // then apply it (or clear it, via "No fault") on demand. See FAULT_CODES
  // above for the real bit layout this drives.
  const faultSelect = el(
    "select",
    {},
    FAULT_CODES.map(({ bits, label }) => el("option", { value: String(bits), text: label })),
  ) as HTMLSelectElement;
  const triggerFaultBtn = iconButton("exclamationCircle", "Trigger fault", {
    className: "btn-danger display-sim-icon-only",
    title: 'Applies the selected fault (or clears it, for "No fault") to the simulated telemetry.',
    onclick: () => {
      telemetry.faultCode = Number(faultSelect.value);
      applyTelemetry();
    },
  });
  const faultControl = el("label", { className: "display-sim-slider display-sim-toggle" }, [
    el("span", { className: "display-sim-slider-label", text: "Fault" }),
    faultSelect,
    el("div", { className: "toolbar" }, [triggerFaultBtn]),
  ]);

  const sliders = el("div", { className: "display-sim-sliders" }, [
    unitsToggle,
    lightsToggle,
    serviceToggle,
    slider("Battery SOC", 0, 100, telemetry.batterySoc, (v) => (telemetry.batterySoc = v), "%", "batterySoc"),
    slider("Assist level", 0, 9, telemetry.assistLevel, (v) => (telemetry.assistLevel = v), "", "assistLevel"),
    slider("Speed", 0, 600, telemetry.speedX10, (v) => (telemetry.speedX10 = v), " (x0.1 km/h)", "speedX10"),
    slider("Cadence", 0, 150, telemetry.cadence, (v) => (telemetry.cadence = v), " rpm", "cadence"),
    slider(
      "Motor temp",
      0,
      255,
      telemetry.motorTemperature,
      (v) => (telemetry.motorTemperature = v),
      " C",
      "motorTemperature",
    ),
    // volatility 2.5 + a ~450ms retarget (22 ticks, vs. the 1.5s default)
    // makes this ripple like real mid-stroke pedal torque instead of
    // drifting like a slowly-changing rider-effort field - see
    // RandomizableSlider's volatility/retargetTicks doc comments.
    slider("Human power", 0, 500, telemetry.humanPower, (v) => (telemetry.humanPower = v), " W", "humanPower", 2.5, 22),
    // Labeled to match what the real UI shows this field as ("motor
    // power", see mainscreen.c's batteryPowerField) rather than the
    // firmware's own internal field name for it - see display-sim.ts's
    // setMotorPower() doc comment. Same torque-ripple tuning as Human
    // power above - motor assist tracks pedal torque, not a separate
    // slow-changing quantity.
    slider("Motor power", 0, 500, telemetry.motorPower, (v) => (telemetry.motorPower = v), " W", "motorPower", 2.5, 22),
    // Real motor telemetry (rt_vars.ui16_battery_voltage_filtered_x10) that
    // feeds state.c's voltage-based SOC-percent estimate - but only when
    // ui_vars.ui8_battery_soc_percent_calculation is set to "volts", and
    // even then it writes a different field than the one this theme
    // reads. The OSF Modern theme's battery display is driven by
    // ui8_g_battery_soc (see sim_set_battery_soc()/the "Battery SOC"
    // slider above), which bypasses voltage-based SOC entirely - so this
    // slider is currently inert for anything on screen. Left in (kept
    // last, per its original position) since it's real telemetry a future
    // battery-voltage readout could use; not wired to this theme yet.
    slider(
      "Battery voltage",
      300,
      500,
      telemetry.batteryVoltageX10,
      (v) => (telemetry.batteryVoltageX10 = v),
      " (x0.1V)",
      "batteryVoltageX10",
    ),
    faultControl,
  ]);

  startTickLoop(canvas, ctx, imageData, randomizableSliders, lightsCheckbox, syncUnitsButtons);

  return el("div", { className: "page" }, [
    el("h2", { className: "page-title" }, [icon("eye"), document.createTextNode(" Display UI sim")]),
    el("p", {
      className: "subtitle",
      text: `This is what display firmware v${DISPLAY_SIM_FIRMWARE_VERSION} looks like, compiled to WASM and running against fake telemetry instead of a real motor - nothing about how the display talks to the controller is touched. A way to test-drive look and feel changes before they'd ever be built into real firmware.`,
    }),
    el("section", { className: "card display-sim-layout" }, [
      el("div", { className: "display-sim-screen-wrap" }, [canvas, buttonPad]),
      el("div", { className: "display-sim-controls" }, [
        el("div", { className: "toolbar" }, [pauseBtn, randomizeBtn]),
        sliders,
      ]),
    ]),
  ]);
}

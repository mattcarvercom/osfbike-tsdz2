// Loads wasm-display-sim/'s WASM module (the real 860C/850C UI logic from
// firmwares/display/860C/, vendored from Color_LCD_860C, compiled with a
// fake framebuffer/button/telemetry driver instead of real hardware - see wasm-display-sim/
// sim_glue.c for what's real vs. faked) and exposes a small typed wrapper
// around its exported entry points. Mirrors flasher.ts's loadModule()
// shape (module-level cached promise, ccall-based calls).

const SIM_WIDTH = 320;
const SIM_HEIGHT = 480;

interface DisplaySimModule {
  HEAPU8: Uint8Array;
  ccall(ident: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
}

type DisplaySimModuleFactory = () => Promise<DisplaySimModule>;

let modulePromise: Promise<DisplaySimModule> | null = null;

async function loadModule(): Promise<DisplaySimModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createModule } = (await import("./wasm/display-sim.mjs")) as {
        default: DisplaySimModuleFactory;
      };
      return createModule();
    })();
  }
  return modulePromise;
}

export interface DisplaySim {
  /** Advances the simulated firmware by one 20ms tick (matching the real main.c loop's own cadence) and re-renders. */
  tick(): void;
  /** Copies the current framebuffer into an ImageData ready to blit onto a canvas. */
  renderInto(imageData: ImageData): void;
  /** id: 0=up, 1=down, 2=onoff, 3=m. */
  setButton(id: number, pressed: boolean): void;
  setBatterySoc(percent: number): void;
  setWheelSpeedX10(speedX10: number): void;
  setCadence(rpm: number): void;
  setAssistLevel(level: number): void;
  /** Named for what the real UI actually displays this field as ("motor power") rather than the firmware's own internal name for it (batteryPowerField/ui16_m_battery_power_filtered) - see mainscreen.c. */
  setMotorPower(watts: number): void;
  setMotorTemperature(celsius: number): void;
  setHumanPower(watts: number): void;
  setBatteryVoltageX10(voltsX10: number): void;
  /** Sets the top-right wall clock (real 24h hour/minute) - separate from the firmware's own "up time" counter, which tracks elapsed sim time instead. */
  setWallClock(hour: number, minute: number): void;
  setLights(on: boolean): void;
  /** Reads back ui_vars.ui8_lights - needed because the firmware can also flip it on its own (a long UP press), not just via setLights() above. See sim_glue.c's sim_get_lights() doc comment. */
  getLights(): boolean;
  /** Raw ui8_error_states bitmask - 0 clears any active fault, one of the FAULT_CODES bit values (render/display-sim-page.ts) triggers that specific one. See sim_glue.c's sim_set_error() doc comment for the bit layout. */
  setError(bits: number): void;
  /** Drives the real ui_vars.ui8_units_type config field + set_conversions(), same as an in-menu units change. */
  setUnitsImperial(imperial: boolean): void;
  /** Reads back ui_vars.ui8_units_type - needed because the on-device config menu (Display -> Units) can also change it directly, not just this wrapper's own setUnitsImperial(). See sim_glue.c's sim_get_units_imperial() doc comment. */
  getUnitsImperial(): boolean;
}

export async function createDisplaySim(): Promise<DisplaySim> {
  const Module = await loadModule();
  Module.ccall("sim_init", null, [], []);

  return {
    tick() {
      Module.ccall("sim_tick", null, [], []);
    },
    renderInto(imageData: ImageData) {
      const ptr = Module.ccall("sim_render_rgba", "number", [], []) as number;
      imageData.data.set(Module.HEAPU8.subarray(ptr, ptr + SIM_WIDTH * SIM_HEIGHT * 4));
    },
    setButton(id: number, pressed: boolean) {
      Module.ccall("sim_set_button", null, ["number", "number"], [id, pressed ? 1 : 0]);
    },
    setBatterySoc(percent: number) {
      Module.ccall("sim_set_battery_soc", null, ["number"], [percent]);
    },
    setWheelSpeedX10(speedX10: number) {
      Module.ccall("sim_set_wheel_speed_x10", null, ["number"], [speedX10]);
    },
    setCadence(rpm: number) {
      Module.ccall("sim_set_cadence", null, ["number"], [rpm]);
    },
    setAssistLevel(level: number) {
      Module.ccall("sim_set_assist_level", null, ["number"], [level]);
    },
    setMotorPower(watts: number) {
      Module.ccall("sim_set_battery_power", null, ["number"], [watts]);
    },
    setMotorTemperature(celsius: number) {
      Module.ccall("sim_set_motor_temperature", null, ["number"], [celsius]);
    },
    setHumanPower(watts: number) {
      Module.ccall("sim_set_human_power", null, ["number"], [watts]);
    },
    setBatteryVoltageX10(voltsX10: number) {
      Module.ccall("sim_set_battery_voltage_x10", null, ["number"], [voltsX10]);
    },
    setWallClock(hour: number, minute: number) {
      Module.ccall("sim_set_wall_clock", null, ["number", "number"], [hour, minute]);
    },
    setLights(on: boolean) {
      Module.ccall("sim_set_lights", null, ["number"], [on ? 1 : 0]);
    },
    getLights() {
      return (Module.ccall("sim_get_lights", "number", [], []) as number) !== 0;
    },
    setError(bits: number) {
      Module.ccall("sim_set_error", null, ["number"], [bits]);
    },
    setUnitsImperial(imperial: boolean) {
      Module.ccall("sim_set_units_imperial", null, ["number"], [imperial ? 1 : 0]);
    },
    getUnitsImperial() {
      return (Module.ccall("sim_get_units_imperial", "number", [], []) as number) !== 0;
    },
  };
}

export const DISPLAY_SIM_WIDTH = SIM_WIDTH;
export const DISPLAY_SIM_HEIGHT = SIM_HEIGHT;

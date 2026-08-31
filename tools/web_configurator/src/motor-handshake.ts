// Emulates the TSDZ2 motor controller's side of the display's real-time
// runtime UART link (distinct from uart-flasher.ts's bootloader protocol -
// different baud, different framing, runs continuously while riding rather
// than once at flash time). Lets the "Display firmware" page drive a real
// 860C/850C past its boot screen ("connecting to motor") without a real
// motor controller attached, using the same USB-UART adapter/cable already
// wired for flashing.
//
// Protocol reimplemented directly from this repo's own firmware source (not
// third-party docs - there weren't any for this link):
//  - Wire settings: firmwares/display/860C/860C_850C/src/usart1.c's
//    USART_Init call - 19200 8N1. (UNIVERSAL_FIRMWARE_PLAN.md and
//    firmwares/motor/tsdz2/src/uart.c's own comment both say "9600" - that's
//    stale/wrong for this fork's actual 860C build; usart1.c is what's
//    really flashed and running, so 19200 is what an emulator must use.)
//  - Frame shape (both directions): [STX][LEN][TYPE][payload...][CRC_LO][CRC_HI].
//    STX is 0x59 display->motor, 0x43 motor->display (this module only ever
//    builds 0x43 frames and parses 0x59 frames). LEN = payload.length + 3
//    (TYPE + payload + the two CRC bytes aren't counted here even though
//    LEN's own byte-count spans STX+LEN+TYPE+payload for the CRC region -
//    see crc16Frame()'s doc comment). Confirmed symmetric against both
//    firmwares/display/860C/860C_850C/src/usart1.c's USART1_IRQHandler
//    (receiver) and firmwares/display/860C/common/src/state.c's
//    rt_send_tx_package() (the display's own outbound builder, same layout,
//    opposite STX).
//  - CRC16: Modbus (poly 0xA001, init 0xFFFF, LSB-first), same algorithm as
//    firmwares/motor/tsdz2/src/common.c's crc16(), computed over the first
//    LEN bytes (STX+LEN byte+TYPE+payload, i.e. everything but the CRC
//    itself) - see firmwares/display/860C/common/src/state.c's
//    USART1_IRQHandler-equivalent CRC check in state.c's communications().
//  - Frame types + the exact request/response payload layouts below are all
//    from firmwares/display/860C/common/src/state.c: the enum at its top
//    (FRAME_TYPE_ALIVE=0/STATUS=1/PERIODIC=2/CONFIGURATIONS=3/
//    FIRMWARE_VERSION=4), rt_send_tx_package() for what the display sends,
//    and communications()'s FRAME_TYPE_* switch (~line 1385-1525) for what
//    it expects back and how it advances g_motor_init_state - see
//    motor_init() (~line 1585) for the boot-screen gating state machine
//    this emulator exists to satisfy.

type LogFn = (line: string) => void;

export const MOTOR_LINK_BAUD = 19200;

const STX_TO_DISPLAY = 0x43;
const STX_FROM_DISPLAY = 0x59;

const FRAME_TYPE_ALIVE = 0;
const FRAME_TYPE_STATUS = 1;
const FRAME_TYPE_PERIODIC = 2;
const FRAME_TYPE_CONFIGURATIONS = 3;
const FRAME_TYPE_FIRMWARE_VERSION = 4;

// Not part of the real motor protocol - a real motor never sends this. A
// bench-only extension (firmwares/display/860C/common/src/state.c's own
// FRAME_TYPE_BENCH_EEPROM_WIPE) that forces the display's config-menu
// "reset to defaults" flow over this same link, for when the menu itself
// is unreachable (stuck boot, dead buttons, etc.). Gated on the 4-byte
// "WIPE" payload below matching exactly, so nothing short of a deliberate
// call to sendBenchEepromWipe() can ever trigger it.
const FRAME_TYPE_BENCH_EEPROM_WIPE = 0x7e;
const BENCH_EEPROM_WIPE_MAGIC = new Uint8Array([0x57, 0x49, 0x50, 0x45]); // "WIPE"

// Must match firmwares/display/860C/common/Makefile.common's
// TSDZ2_FIRMWARE_MAJOR/MINOR/PATCH exactly (0/21/53 as of this fork) - the
// display compares this triplet byte-for-byte (major/minor exact, patch
// >=43) against its own compiled-in expectation and permanently sticks in
// MOTOR_INIT_ERROR_FIRMWARE_VERSION on any mismatch (state.c's
// MOTOR_INIT_GOT_MOTOR_FIRMWARE_VERSION case). Sending back this display's
// own expected version, rather than some other real TSDZ2 release's
// version, is what guarantees a match regardless of what this repo's
// firmware version macros happen to be set to later.
const EMULATED_MOTOR_FIRMWARE_VERSION = { major: 0, minor: 21, patch: 53 };

// state.h's motor_init_status_t - what a FRAME_TYPE_STATUS reply's one
// payload byte means. Replying INIT_OK directly (skipping the GOT_CONFIG
// intermediate) is enough - state.c's MOTOR_INIT_CONFIG_CHECK_STATUS jumps
// straight to MOTOR_INIT_READY on INIT_OK.
const MOTOR_INIT_STATUS_INIT_OK = 2;

// "Test ride" preset for FRAME_TYPE_PERIODIC, so a bench-flashed display
// shows a plausible, *moving* dashboard instead of all zeros. Field offsets
// match state.c's FRAME_TYPE_PERIODIC parse (~line 1414) exactly; battery
// voltage packing uses state.h's ADC_BATTERY_VOLTAGE_PER_ADC_STEP_X10000
// (866) - raw = volts / 0.0866.
//
// A first version of this sent one fixed, never-changing payload every
// reply. That's not a bug in itself (see below), but it reads as one on
// real hardware: reported 2026-08-22/23 as "EVERYTHING FREEZES" - speed/
// cadence/human power pinned, no dashboard motion at all except the trip
// timer and clock (which come from the display's own real-time clock, not
// this payload). A full investigation (a real usart1.c receive-buffer
// bounds-check fix, a TIME_1 click/long-click regression fix, and adding a
// periodic reply counter to the on-screen log) confirmed the display was
// never actually hung - the log's reply counter kept climbing right through
// the "freeze", and the trip timer/clock kept moving too. A rider genuinely
// holding an exact, unchanging 70rpm/9mph forever would look identical -
// the fix isn't a firmware or protocol fix at all, just giving this preset
// something to actually vary, the same way wasm-display-sim/sim_glue.c's
// own demo mode (a sine wave) does for the WASM sim.
//
// adc_pedal_torque_delta (p[9]) isn't "human power" directly - the display
// derives that itself from this raw ADC-domain field. With torque-sensor
// calibration off (state.c/eeprom.h's DEFAULT_TORQUE_SENSOR_CALIBRATION_FEATURE_ENABLE
// = 0, the real default), state.c's communications() uses:
//   pedal_power_x10 = (adc_pedal_torque_delta * 67 * pedal_cadence) / 96
// (67 = eeprom.h's DEFAULT_VALUE_PEDAL_TORQUE_ADC_STEP_x100). A first,
// still-static attempt at delta=200 produced (200*67*70)/96 = 977 ->
// ~980W displayed - reported 2026-08-22 as "went up to like 900W" (climbing
// there over ~2s is rt_low_pass_filter_pedal_power()'s EMA warming up
// toward that wrong target, not a real filter bug). The varying delta/
// cadence below stay in roughly a 40-165W band instead, all plausible
// sustained rider output.
//
// `t` is elapsed seconds since the emulator started - each field gets its
// own sine period so they don't all peak/trough in lockstep (a real rider's
// speed, cadence and effort don't move in perfect unison either). First
// attempt used ~30-60s periods, which read as "slower than molasses"
// against the main screen's own mini graph (only a ~2-minute-or-less
// window) - sped up ~5x (to ~6-11s periods) so multiple full swings were
// visible within any reasonably short graph window.
//
// That sped-up version created a NEW bug: theme_osf_modern.c's graph point
// interval is 3s (MINI_GRAPH_POINT_MS/GRAPH_POINT_MS), so a 6-11s sine
// period was only getting sampled ~2-3 times per cycle - severe aliasing,
// not a smooth wave. Reported 2026-08-23: "the graph is very sawtooth,
// very linear ups and downs rather than smooth waves... I suppose the
// speed doesn't need to change so rapidly." Slowed back down to ~70-115s
// periods (comments below), giving 20-30+ samples/cycle at the 3s graph
// rate - comfortably past Nyquist, and a more plausible pace for how a
// real rider's speed/cadence/effort actually drift anyway. Main-screen
// bars still read as continuously live (they update every ~100ms off the
// same smooth curve, independent of the graph's own 3s sampling), just
// with gentler swings than the aliased version had.
function buildPeriodicPreset(t: number): Uint8Array {
  const rawBatteryVoltage = 600; // ~52.0V, held steady - not something a rider visibly changes
  const p = new Uint8Array(24);
  p[0] = rawBatteryVoltage & 0xff;
  p[1] = (rawBatteryVoltage >> 4) & 0x30; // bits 8-9 of raw voltage, packed at payload[1] bits 4-5

  // theme_osf_modern.c's "motor power" bar/tile actually reads
  // rt_vars.ui16_battery_power_filtered (battery_current_filtered_x5 *
  // battery_voltage_filtered_x10 / 50, state.c's
  // rt_low_pass_filter_battery_voltage_current_power()), not anything
  // motor-current-derived - at this preset's ~52V, the previous 25-55
  // (5-11A) range could peak near (55*520)/50 = 572W. Capped to 22-42
  // (4.4-8.4A) -> ~229-437W, safely under a real ~500W ceiling (reported
  // 2026-08-23: "shouldn't send motor power > 500w").
  const batteryCurrentX5 = Math.round(32 + 10 * Math.sin(t * 0.09)); // ~4.4-8.4A, ~70s period
  p[2] = batteryCurrentX5 & 0xff;

  const rawSpeedX10 = Math.round(140 + 60 * Math.sin(t * 0.075)); // 8.0-20.0 km/h, ~84s period, packed low-10-bits across payload[3..4]
  p[3] = rawSpeedX10 & 0xff;
  p[4] = (rawSpeedX10 >> 8) & 0x03;
  p[5] = 0; // flags: no braking/fault/cutoff
  p[6] = 0; // throttle ADC - unused (no throttle)
  p[7] = 25; // motor_temperature, only read if optional ADC function = temperature

  const pedalCadence = Math.round(67 + 17 * Math.sin(t * 0.075)); // 50-84rpm, same phase as speed (pedaling drives it)
  const adcPedalTorqueDelta = Math.round(20 + 8 * Math.sin(t * 0.065)); // -> ~40-165W human power at this cadence range, see comment above, ~97s period
  p[9] = adcPedalTorqueDelta & 0xff; // adc_pedal_torque_delta low byte
  p[11] = pedalCadence & 0xff; // pedal_cadence

  const dutyCycle = Math.round(130 + 40 * Math.sin(t * 0.055)); // ~114s period
  p[12] = dutyCycle & 0xff;
  const motorSpeedErps = Math.round(350 + 150 * Math.sin(t * 0.075)); // tracks speed's phase
  p[13] = motorSpeedErps & 0xff; // motor_speed_erps low byte
  p[14] = (motorSpeedErps >> 8) & 0xff;
  p[16] = 0; // error_states - must stay 0

  const motorCurrentX5 = Math.round(50 + 20 * Math.sin(t * 0.06)); // ~105s period
  p[17] = motorCurrentX5 & 0xff; // motor_current_x5

  // state.c's rt_calc_odometer() computes distance from THIS field, not
  // wheel_speed_x10 above - (tick_counter delta) * wheel_perimeter, once a
  // real second - and it never moved at all before this: the preset always
  // left it at 0, so the delta (and therefore distance) was always 0
  // regardless of what speed was shown elsewhere (reported 2026-08-23:
  // "the Odo is not moving, nor the trip meter"). Free-running per real
  // eeprom.h's DEFAULT_VALUE_WHEEL_PERIMETER (2100mm, 27.5" wheel) - not
  // tied to the varying speed above (that'd need knowing this display's
  // actual configured wheel_perimeter, which isn't exposed over this link),
  // just a steady ~3.2 ticks/s so 0.1km ticks over roughly every 15s, a
  // similar pace to the sped-up graph intervals.
  const wheelTicks = Math.floor(t * 3.2) & 0xffffff;
  p[18] = wheelTicks & 0xff;
  p[19] = (wheelTicks >> 8) & 0xff;
  p[20] = (wheelTicks >> 16) & 0xff;

  p[21] = 50; // adc_pedal_torque_delta_boost low byte
  return p;
}

/** Modbus CRC16 (poly 0xA001, init 0xFFFF, LSB-first) - byte-for-byte port of firmwares/motor/tsdz2/src/common.c's crc16(). */
function crc16(bytes: ArrayLike<number>): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** Builds one motor->display frame: STX(0x43) LEN TYPE payload... CRC_LO CRC_HI. */
function buildMotorFrame(type: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 3;
  const frame = new Uint8Array(len + 2);
  frame[0] = STX_TO_DISPLAY;
  frame[1] = len;
  frame[2] = type;
  frame.set(payload, 3);
  const crc = crc16(frame.subarray(0, len));
  frame[len] = crc & 0xff;
  frame[len + 1] = (crc >> 8) & 0xff;
  return frame;
}

export interface MotorHandshakeHandle {
  /** Stops the emulator and releases the port's reader/writer locks so the caller can close/reopen the port for something else (e.g. back to the flasher's 57600 baud). */
  stop(): Promise<void>;
  /** Sends the bench-only EEPROM-wipe frame (see FRAME_TYPE_BENCH_EEPROM_WIPE's own comment) over this handle's already-open writer. */
  sendBenchEepromWipe(): Promise<void>;
}

/**
 * Starts emulating the motor controller's side of the runtime link on an
 * already-open SerialPort (must be opened at MOTOR_LINK_BAUD - see
 * uart-transport.ts). Sends unprompted ALIVE frames until the display
 * starts talking, then answers FIRMWARE_VERSION/STATUS/PERIODIC requests
 * with the minimum content that gets a display past its boot screen (see
 * this file's header comment for where each value comes from).
 * FRAME_TYPE_CONFIGURATIONS is display->motor only in the real protocol -
 * received and ignored, no reply expected.
 */
export function startMotorHandshakeEmulator(port: SerialPort, onLog: LogFn): MotorHandshakeHandle {
  if (!port.writable || !port.readable)
    throw new Error("Serial port has no writable/readable stream - is it still open?");
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let stopped = false;
  const startMs = Date.now();

  async function send(frame: Uint8Array): Promise<void> {
    try {
      await writer.write(frame);
    } catch {
      // Port closing/closed mid-send - the read loop below will also stop shortly.
    }
  }

  // Real motor only sends ALIVE once, before the display's own
  // MOTOR_INIT_WAIT_MOTOR_ALIVE state advances (state.c's motor_init()) -
  // stopped below as soon as a firmware-version request is seen, rather
  // than left running for the rest of the session. Continuing to send
  // unsolicited frames after that point is out-of-protocol traffic that
  // only adds more chances for a real-world framing glitch (see
  // usart1.c's USART1_IRQHandler bounds-check fix, 2026-08-22, for what a
  // single lost/misaligned byte on this link can do).
  let aliveTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    void send(buildMotorFrame(FRAME_TYPE_ALIVE, new Uint8Array(0)));
  }, 300);
  onLog("Motor emulator: sending ALIVE, waiting for the display to request firmware version…");

  let readState: 0 | 1 | 2 = 0;
  let frameLen = 0;
  let buf: number[] = [];
  let seenFirmwareRequest = false;
  let seenStatusRequest = false;
  let seenPeriodic = false;
  let periodicRepliesSent = 0;

  async function handleFrame(type: number): Promise<void> {
    switch (type) {
      case FRAME_TYPE_FIRMWARE_VERSION:
        if (!seenFirmwareRequest) {
          seenFirmwareRequest = true;
          if (aliveTimer !== null) {
            clearInterval(aliveTimer);
            aliveTimer = null;
          }
          onLog(
            `Motor emulator: got firmware-version request, replying ${EMULATED_MOTOR_FIRMWARE_VERSION.major}.${EMULATED_MOTOR_FIRMWARE_VERSION.minor}.${EMULATED_MOTOR_FIRMWARE_VERSION.patch}…`,
          );
        }
        await send(
          buildMotorFrame(
            FRAME_TYPE_FIRMWARE_VERSION,
            new Uint8Array([
              0, // error_states - none
              EMULATED_MOTOR_FIRMWARE_VERSION.major,
              EMULATED_MOTOR_FIRMWARE_VERSION.minor,
              EMULATED_MOTOR_FIRMWARE_VERSION.patch,
            ]),
          ),
        );
        break;

      case FRAME_TYPE_STATUS:
        if (!seenStatusRequest) {
          seenStatusRequest = true;
          onLog("Motor emulator: got status request, replying init-ok…");
        }
        await send(buildMotorFrame(FRAME_TYPE_STATUS, new Uint8Array([MOTOR_INIT_STATUS_INIT_OK])));
        break;

      case FRAME_TYPE_PERIODIC:
        periodicRepliesSent++;
        if (!seenPeriodic) {
          seenPeriodic = true;
          onLog(
            "Motor emulator: display reached MOTOR_INIT_READY, now answering periodic telemetry (fixed test-ride preset).",
          );
        }
        // A one-shot "reached READY" log can't tell a still-healthy emulator
        // (nothing new to report) apart from one the display simply stopped
        // requesting from - reported as a total UI freeze 2026-08-22/23 with
        // no further log lines either way. This heartbeat (~every 2s at the
        // display's ~100ms real request cadence) makes that distinguishable
        // on the next test: if the count stops climbing, the *display*
        // stopped asking (points at its own 100ms telemetry timer/ISR); if
        // it keeps climbing right through a visible freeze, this emulator is
        // fine and the stall is in how the display renders/consumes what it
        // already received.
        if (periodicRepliesSent % 20 === 0) {
          onLog(`Motor emulator: still answering periodic telemetry (${periodicRepliesSent} replies sent).`);
        }
        await send(buildMotorFrame(FRAME_TYPE_PERIODIC, buildPeriodicPreset((Date.now() - startMs) / 1000)));
        break;

      case FRAME_TYPE_CONFIGURATIONS:
        // One-way (display -> motor); the real motor never replies to this.
        break;

      default:
        break;
    }
  }

  let framesOk = 0;
  let framesBadCrc = 0;

  const pumpDone = (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) {
          // A real port only reports done:true after cancel()/close() - if
          // this fires while stop() was never called, something closed the
          // stream out from under us (unplugged adapter, driver reset,
          // etc.) - worth knowing rather than just going silently idle.
          if (!stopped)
            onLog(
              `Motor emulator: read stream ended unexpectedly (${framesOk} ok, ${framesBadCrc} bad-CRC frames so far).`,
            );
          break;
        }
        if (!value) continue;
        for (const b of value) {
          if (readState === 0) {
            if (b === STX_FROM_DISPLAY) {
              buf = [b];
              readState = 1;
            }
          } else if (readState === 1) {
            buf.push(b);
            frameLen = b;
            readState = 2;
          } else {
            buf.push(b);
            if (buf.length >= frameLen + 2) {
              const crc = crc16(buf.slice(0, frameLen));
              const crcRx = buf[frameLen] | (buf[frameLen + 1] << 8);
              if (crc === crcRx && frameLen >= 3) {
                framesOk++;
                void handleFrame(buf[2]);
              } else {
                // A real single lost/corrupted byte on the wire lands here -
                // the parser always resyncs on the next STX below, so one of
                // these alone is harmless. Logged (throttled) so a stream of
                // them - which would explain telemetry going stale even
                // though this loop itself keeps running - is visible instead
                // of silently discarded.
                framesBadCrc++;
                if (framesBadCrc <= 5 || framesBadCrc % 20 === 0) {
                  onLog(
                    `Motor emulator: bad CRC on a ${frameLen}-byte frame from the display (${framesBadCrc} so far) - dropped, resyncing.`,
                  );
                }
              }
              readState = 0;
              buf = [];
            }
          }
        }
      }
    } catch (err) {
      // Previously swallowed unconditionally on the assumption this only
      // ever fires from our own stop()/reader.cancel() - but a genuine
      // mid-session read error (framing/overrun/etc. from the real adapter)
      // lands here too and would otherwise kill this loop with zero
      // indication, leaving the display showing stale telemetry forever
      // while looking "frozen" - reported 2026-08-22/23. Only log it if we
      // didn't ask for the stop ourselves.
      if (!stopped)
        onLog(
          `Motor emulator: read loop stopped with an error: ${String(err)} (${framesOk} ok, ${framesBadCrc} bad-CRC frames so far).`,
        );
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (aliveTimer !== null) clearInterval(aliveTimer);
      try {
        await reader.cancel();
      } catch {
        // Already closed/errored.
      }
      await pumpDone.catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
    },
    async sendBenchEepromWipe() {
      onLog('Motor emulator: sending bench EEPROM-wipe frame ("WIPE" magic)…');
      await send(buildMotorFrame(FRAME_TYPE_BENCH_EEPROM_WIPE, BENCH_EEPROM_WIPE_MAGIC));
      onLog("Motor emulator: sent. The display should reset its settings on its next tick (screen_clock(), ~100ms).");
    },
  };
}

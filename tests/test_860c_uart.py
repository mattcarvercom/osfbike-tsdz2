"""
Tests for the gated CRC16 860C/850C UART protocol port (firmwares/motor/tsdz2/src/ebike_app.c, gated
by ENABLE_860C_LVGL_UART in config.h).

The checked-in firmwares/motor/tsdz2/src/config.h ships with the flag OFF, so these tests build a
separate compiled module (`_tsdz2_860c`) against a scratch copy of firmwares/motor/tsdz2/src/ with
just ENABLE_860C_LVGL_UART patched on - the same pattern as
test_cruise_override.py. Other test files keep using the stock module.

These tests synthesize CRC16-framed packets directly into ui8_rx_buffer (the
same pattern the cruise tests use to bypass the real UART peripheral), then
drive the dispatcher / state machine and assert on the applied state.

They only prove the *motor side* is internally consistent - not that a real
display will talk to it (that needs hardware, Story 9(b) in the plan). The
hardware-dependent SPL calls (TIM1_OC*Init via motor_disable_pwm, UART2_ITConfig
via uart2_send_buffer_start) are stubbed with cffi def_extern no-ops.
"""

import os
import re
import shutil
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_c_code  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, "firmwares", "motor", "tsdz2", "src")
STDPERPH_INC = os.path.join(SRC_DIR, "STM8S_StdPeriph_Lib", "inc")

# main.h
MOTOR_INIT_STATE_RESET = 0
MOTOR_INIT_STATE_NO_INIT = 1
MOTOR_INIT_STATE_INIT_START_DELAY = 2
MOTOR_INIT_STATE_INIT_WAIT_DELAY = 3
MOTOR_INIT_OK = 4

MOTOR_INIT_STATUS_RESET = 0
MOTOR_INIT_STATUS_GOT_CONFIG = 1
MOTOR_INIT_STATUS_INIT_OK = 2

COMM_FRAME_TYPE_ALIVE = 0
COMM_FRAME_TYPE_STATUS = 1
COMM_FRAME_TYPE_PERIODIC = 2
COMM_FRAME_TYPE_CONFIGURATIONS = 3
COMM_FRAME_TYPE_FIRMWARE_VERSION = 4

M_ERROR_NOT_INIT = 1

# common.h (riding modes)
OFF = 0
ECO = 1
TOUR = 2
SPORT = 3
TURBO = 4
POWER_ASSIST_MODE = 1
HYBRID_ASSIST_MODE = 5
CRUISE_MODE = 6
WALK_ASSIST_MODE = 7

CONFIG_OVERRIDES = {"ENABLE_860C_LVGL_UART": 1}


def _crc16(data, crc=0xFFFF):
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return crc & 0xFFFF


def build_frame(frame_type, payload):
    """Builds a full display->motor frame. `payload` is the bytes that occupy
    buffer[3..length-1] (i.e. everything after start/len/type but before the
    2-byte CRC). length = 3 + len(payload)."""
    length = 3 + len(payload)
    body = [0x59, length, frame_type] + list(payload)
    crc = _crc16(body)
    return body + [crc & 0xFF, (crc >> 8) & 0xFF]


def build_config_frame(fields):
    """CONFIGURATIONS frame: payload occupies buffer[3..85] (83 bytes). `fields`
    maps absolute buffer index -> byte value. Unspecified bytes stay 0."""
    payload = [0] * 83  # buffer[3..85]
    for idx, value in fields.items():
        assert 3 <= idx <= 85
        payload[idx - 3] = value
    return build_frame(COMM_FRAME_TYPE_CONFIGURATIONS, payload)


class _Tim1Stub:
    """Tracks motor_disable_pwm()/motor_enable_pwm() calls made through the
    TIM1_OC*Init SPL functions."""

    def __init__(self):
        self.disable_calls = 0
        self.enable_calls = 0

    def oc_init(self, *args):
        output_state = args[1]  # TIM1_OutputState
        if output_state == 0:  # TIM1_OUTPUTSTATE_DISABLE
            self.disable_calls += 1
        else:
            self.enable_calls += 1


def _build_860c_module(module_name):
    scratch = tempfile.mkdtemp(prefix="tsdz2-860c-test-")
    try:
        for name in os.listdir(SRC_DIR):
            path = os.path.join(SRC_DIR, name)
            if os.path.isfile(path) and name.endswith((".c", ".h")):
                shutil.copy(path, scratch)

        config_path = os.path.join(scratch, "config.h")
        with open(config_path, encoding="utf8") as fh:
            text = fh.read()
        for key, value in CONFIG_OVERRIDES.items():
            pattern = rf"^#define {key} .*$"
            text, count = re.subn(pattern, f"#define {key} {value}", text, flags=re.M)
            assert count == 1, f"expected exactly one '#define {key} ...' in config.h, found {count}"
        with open(config_path, "w", encoding="utf8") as fh:
            fh.write(text)

        orig_source_dirs = load_c_code.source_dirs
        orig_include_dirs = load_c_code.include_dirs
        load_c_code.source_dirs = [scratch + os.sep]
        load_c_code.include_dirs = [scratch + os.sep, STDPERPH_INC + os.sep]
        try:
            lib, ffi = load_c_code.load_code(module_name, force_recompile=True)
        finally:
            load_c_code.source_dirs = orig_source_dirs
            load_c_code.include_dirs = orig_include_dirs

        # Stub the SPL functions the tested code path reaches.
        tim1 = _Tim1Stub()

        @ffi.def_extern()
        def UART2_ITConfig(*args):
            pass

        @ffi.def_extern()
        def TIM1_OC1Init(*args):
            tim1.oc_init(*args)

        @ffi.def_extern()
        def TIM1_OC2Init(*args):
            tim1.oc_init(*args)

        @ffi.def_extern()
        def TIM1_OC3Init(*args):
            tim1.oc_init(*args)

        yield lib, ffi, tim1
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@pytest.fixture(scope="module")
def ebike():
    yield from _build_860c_module("_tsdz2_860c")


def _receive(ebike, frame):
    """Loads a full frame into the RX buffer and flags it for processing."""
    assert len(frame) <= 88
    for i, b in enumerate(frame):
        ebike.ui8_rx_buffer[i] = b
    ebike.ui8_received_package_flag = 1


def _prep_control(ebike):
    """ebike_control_motor() runs apply_smooth_start(), which divides by
    ui16_battery_voltage_filtered_x10 - leave it 0 and it's an integer
    div-by-zero (SIGFPE), not a Python exception (see CLAUDE.md)."""
    ebike.ui16_battery_voltage_filtered_x10 = 480


# ---------------------------------------------------------------------------
# CRC16 sanity (Story 2 / 3)
# ---------------------------------------------------------------------------


def test_crc16_matches_python_reference(ebike):
    ebike, ffi, _ = ebike
    # A known test vector: empty check matches the PetitModbus initial state
    # after feeding a single 0x00 byte.
    crc = ffi.new("uint16_t *", 0xFFFF)
    ebike.crc16(0x00, crc)
    assert crc[0] == _crc16([0x00])


# ---------------------------------------------------------------------------
# Boot handshake: ALIVE self-announce + FIRMWARE_VERSION reply (Story 5)
# ---------------------------------------------------------------------------


def test_boot_starts_in_reset_and_self_announces_alive(ebike):
    ebike, ffi, _ = ebike
    ebike.ui8_received_package_flag = 0
    ebike.communications_controller()
    # self-announce while RESET -> ALIVE frame
    assert ebike.ui8_tx_buffer[0] == 0x43
    assert ebike.ui8_tx_buffer[2] == COMM_FRAME_TYPE_ALIVE


def test_firmware_version_reply_is_0_21_52(ebike):
    ebike, ffi, _ = ebike
    _receive(ebike, build_frame(COMM_FRAME_TYPE_FIRMWARE_VERSION, []))
    ebike.communications_controller()
    # reply payload: [3]=error states, [4]=major, [5]=minor, [6]=patch
    assert ebike.ui8_tx_buffer[2] == COMM_FRAME_TYPE_FIRMWARE_VERSION
    assert ebike.ui8_tx_buffer[4] == 0
    assert ebike.ui8_tx_buffer[5] == 21
    assert ebike.ui8_tx_buffer[6] == 52
    # a valid packet moves the motor out of RESET
    assert ebike.ui8_m_motor_init_state == MOTOR_INIT_STATE_NO_INIT


def test_status_reply_reports_init_status(ebike):
    ebike, ffi, _ = ebike
    _receive(ebike, build_frame(COMM_FRAME_TYPE_STATUS, []))
    ebike.communications_controller()
    assert ebike.ui8_tx_buffer[2] == COMM_FRAME_TYPE_STATUS
    assert ebike.ui8_tx_buffer[3] == MOTOR_INIT_STATUS_RESET


# ---------------------------------------------------------------------------
# CONFIGURATIONS receive & apply (Story 6)
# ---------------------------------------------------------------------------


def test_configurations_apply_confirmed_fields_and_advance_state(ebike):
    ebike, ffi, tim1 = ebike

    # battery low-voltage cutoff = 420 (42.0V x10), little-endian at [3][4]
    # wheel perimeter = 2070 at [5][6]
    # battery max current = 18 at [7]
    frame = build_config_frame({
        3: 420 & 0xFF, 4: (420 >> 8) & 0xFF,
        5: 2070 & 0xFF, 6: (2070 >> 8) & 0xFF,
        7: 18,
    })

    tim1.disable_calls = 0
    _receive(ebike, frame)
    ebike.communications_controller()

    assert ebike.m_configuration_variables.ui16_battery_low_voltage_cut_off_x10 == 420
    assert ebike.m_configuration_variables.ui16_wheel_perimeter == 2070
    assert ebike.m_configuration_variables.ui8_battery_current_max == 18
    # motor-init state machine advances to the delay phase
    assert ebike.ui8_m_motor_init_state == MOTOR_INIT_STATE_INIT_START_DELAY
    assert ebike.ui8_m_motor_init_status == MOTOR_INIT_STATUS_GOT_CONFIG
    # PWM disabled during the write
    assert ebike.ui8_motor_enabled == 0
    assert tim1.disable_calls >= 3, "motor_disable_pwm() should have disabled the 3 PWM channels"


def test_motor_init_completes_after_40_tick_delay(ebike):
    ebike, ffi, _ = ebike

    frame = build_config_frame({
        3: 420 & 0xFF, 4: (420 >> 8) & 0xFF,
        5: 2070 & 0xFF, 6: (2070 >> 8) & 0xFF,
        7: 18,
    })
    _receive(ebike, frame)
    ebike.communications_controller()
    assert ebike.ui8_m_motor_init_state == MOTOR_INIT_STATE_INIT_START_DELAY

    # The first ebike_control_motor() call sets the 40-tick timer and moves to
    # INIT_WAIT_DELAY; subsequent calls count it down.
    _prep_control(ebike)
    ebike.ebike_control_motor()
    assert ebike.ui8_m_motor_init_state == MOTOR_INIT_STATE_INIT_WAIT_DELAY

    for _ in range(40):
        ebike.ebike_control_motor()
    assert ebike.ui8_m_motor_init_state == MOTOR_INIT_OK
    assert ebike.ui8_m_motor_init_status == MOTOR_INIT_STATUS_INIT_OK
    # the "not initialized" error bit is cleared once init completes
    assert ebike.ui8_m_system_state & M_ERROR_NOT_INIT == 0


def test_status_reply_reports_got_config_then_init_ok(ebike):
    ebike, ffi, _ = ebike

    frame = build_config_frame({
        3: 420 & 0xFF, 4: (420 >> 8) & 0xFF,
        5: 2070 & 0xFF, 6: (2070 >> 8) & 0xFF,
        7: 18,
    })
    _receive(ebike, frame)
    ebike.communications_controller()
    assert ebike.ui8_m_motor_init_status == MOTOR_INIT_STATUS_GOT_CONFIG

    _prep_control(ebike)
    for _ in range(41):
        ebike.ebike_control_motor()
    assert ebike.ui8_m_motor_init_status == MOTOR_INIT_STATUS_INIT_OK


# ---------------------------------------------------------------------------
# PERIODIC receive (Story 7)
# ---------------------------------------------------------------------------


def _send_periodic(ebike, payload_9):
    # PERIODIC payload occupies buffer[3..12] (10 bytes incl. the trailing gap)
    payload = list(payload_9) + [0]
    _receive(ebike, build_frame(COMM_FRAME_TYPE_PERIODIC, payload))
    ebike.communications_controller()


def test_periodic_applies_assist_walk_and_wheel_max_speed(ebike):
    ebike, ffi, _ = ebike

    # [3]=riding mode parameter, [7]=walk assist parameter, [9]=wheel max speed
    # [5]=0x04 -> assist level flag set (bit2), [8]=riding mode POWER_ASSIST
    _send_periodic(ebike, [64, 0, 0x04, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])

    assert ebike.ui8_riding_mode_parameter == 64
    assert ebike.ui8_walk_assist_parameter == 25
    assert ebike.ui8_wheel_speed_max == 59
    assert ebike.m_configuration_variables.ui8_riding_mode == POWER_ASSIST_MODE
    assert ebike.ui8_assist_level_flag == 1


def test_periodic_relays_real_assist_level_in_non_hybrid_mode(ebike):
    """Regression test: byte[4] carries the display's real 1-4 assist level
    whenever the base riding mode isn't hybrid (state.c:257-259) - it must not
    be collapsed to a flag-derived ECO/OFF, or apply_cruise()'s per-level speed
    table always resolves to the ECO row regardless of the level selected on
    the display."""
    ebike, ffi, _ = ebike

    # byte[4]=SPORT, byte[5]=0x04 (assist flag set), byte[8]=POWER_ASSIST_MODE
    _send_periodic(ebike, [64, SPORT, 0x04, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])
    assert ebike.ui8_assist_level == SPORT

    # assist flag clear -> OFF regardless of byte[4]
    _send_periodic(ebike, [64, TURBO, 0x00, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])
    assert ebike.ui8_assist_level == OFF

    # out-of-range byte[4] clamps to TURBO rather than wrapping/overflowing
    _send_periodic(ebike, [64, 9, 0x04, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])
    assert ebike.ui8_assist_level == TURBO


def test_periodic_hybrid_mode_keeps_torque_parameter_separate_from_level(ebike):
    """In hybrid mode byte[4] is the hybrid torque parameter, not a raw level
    (state.c:260-262) - ui8_assist_level has no raw value to relay there, so
    it falls back to a flag-derived ECO/OFF like before."""
    ebike, ffi, _ = ebike

    _send_periodic(ebike, [64, 77, 0x04, 0, 25, HYBRID_ASSIST_MODE, 59, 0, 0])
    assert ebike.ui8_hybrid_torque_parameter == 77
    assert ebike.ui8_assist_level == ECO


def test_periodic_telemetry_is_live_not_stubbed(ebike):
    ebike, ffi, _ = ebike

    ebike.ui16_adc_voltage_filtered = 500  # battery voltage ADC
    ebike.ui8_battery_current_filtered_x10 = 30  # 3.0A
    ebike.ui16_wheel_speed_x10 = 255
    ebike.ui8_pedal_cadence_RPM = 70
    ebike.ui16_adc_pedal_torque_delta = 1234
    ebike.ui16_motor_speed_erps = 300

    _send_periodic(ebike, [64, 0, 0x04, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])

    assert ebike.ui8_tx_buffer[3] == (500 & 0xFF)
    assert ebike.ui8_tx_buffer[5] == (30 >> 1)  # battery current x5
    assert ebike.ui8_tx_buffer[6] == (255 & 0xFF)  # wheel speed low
    assert ebike.ui8_tx_buffer[14] == 70  # cadence
    assert ebike.ui8_tx_buffer[16] == (300 & 0xFF)  # motor ERPS low
    assert ebike.ui8_tx_buffer[24] == (1234 & 0xFF)  # pedal torque delta low


def test_two_periodic_frames_change_applied_state(ebike):
    ebike, ffi, _ = ebike

    _send_periodic(ebike, [64, 0, 0x04, 0, 25, POWER_ASSIST_MODE, 59, 0, 0])
    assert ebike.ui8_riding_mode_parameter == 64
    assert ebike.ui8_wheel_speed_max == 59

    _send_periodic(ebike, [120, 0, 0x04, 0, 40, POWER_ASSIST_MODE, 30, 0, 0])
    assert ebike.ui8_riding_mode_parameter == 120
    assert ebike.ui8_wheel_speed_max == 30


# ---------------------------------------------------------------------------
# CRC rejection (Story 3)
# ---------------------------------------------------------------------------


def test_corrupted_frame_is_rejected_without_dispatch(ebike):
    ebike, ffi, _ = ebike

    frame = build_frame(COMM_FRAME_TYPE_FIRMWARE_VERSION, [])
    frame[-1] ^= 0xFF  # corrupt the CRC high byte
    _receive(ebike, frame)

    # move out of RESET so a rejected frame leaves state unchanged
    _receive(ebike, build_frame(COMM_FRAME_TYPE_STATUS, []))
    ebike.communications_controller()
    state = ebike.ui8_m_motor_init_state

    _receive(ebike, frame)
    ebike.communications_controller()
    assert ebike.ui8_received_package_flag == 0
    assert ebike.ui8_m_motor_init_state == state


if __name__ == "__main__":
    pytest.main([__file__])

"""
Regression tests for the "cruise control override for walk-assist" feature
(firmwares/motor/tsdz2/src/ebike_app.c, gated by CRUISE_OVERRIDE_WALK_ECO_ENABLED /
CRUISE_OVERRIDE_WALK_TOUR_ENABLED / CRUISE_OVERRIDE_WALK_SPORT_ENABLED /
CRUISE_OVERRIDE_WALK_TURBO_ENABLED in config.h, one independent toggle per
assist level - see main.h and UNIVERSAL_FIRMWARE_PLAN.md for the feature's
design).

The checked-in firmwares/motor/tsdz2/src/config.h ships with the feature OFF (matching stock
defaults), so these tests build SEPARATE compiled modules against scratch
copies of firmwares/motor/tsdz2/src/ with just the cruise/override macros patched on - see
`_build_cruise_module()` and the `ebike`/`ebike_all_levels` fixtures below.
Other test files are unaffected and keep using the stock module built by
tests/conftest.py.

The first four tests (using `ebike`, SPORT+TURBO only - the feature's
original shipped scope) each pin down one of three real bugs found only by
flashing real hardware and riding/bench-testing it (2026-08-13):

  1. A pre-existing "riding_mode == CRUISE_MODE" branch (for displays with
     Cruise set as a *permanent* riding mode) shadowed the override's own
     button-release-restore branch, permanently stranding the rider in
     CRUISE_MODE with no way back short of a display reboot.
  2. DZ40/VLCD5 displays report a decremented assist level while the shared
     walk-assist button is held; two spots in the cruise path still read the
     live (decremented) level instead of the pre-button one, either
     targeting the wrong cruiseSpeed entry or tripping the motor's master
     safety cutoff entirely (ui8_riding_mode_parameter == 0).
  3. apply_cruise()'s PID only initializes (and sets its target speed) on a
     poll where it was previously disengaged; the override can engage on its
     very first poll, skipping that warm-up, leaving the target speed at 0
     forever - motor produces zero output.

The remaining tests (using `ebike_all_levels`, all four overrides on) cover
the later extension to ECO/TOUR: the same three bug classes above, now
parametrized across all four levels instead of just SPORT/TURBO, plus one
test proving the four toggles are genuinely independent (only some enabled
still leaves the rest as plain walk assist), which is the whole point of
giving each level its own config.h macro instead of one shared switch.
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
STDPERIPH_INC = os.path.join(SRC_DIR, "STM8S_StdPeriph_Lib", "inc")

# main.h
OFF, ECO, TOUR, SPORT, TURBO = 0, 1, 2, 3, 4
# main.h - one-hot bits for ui8_rx_buffer[1], masked with 0xDE
ASSIST_PEDAL_LEVEL_BIT = {OFF: 0x10, ECO: 0x40, TOUR: 0x02, SPORT: 0x04, TURBO: 0x08}
WALK_BUTTON_BIT = 0x20  # ui8_rx_buffer[1]

# common.h
POWER_ASSIST_MODE = 1
CRUISE_MODE = 6
WALK_ASSIST_MODE = 7

# config.h overrides needed to exercise the feature (stock config.h ships
# with it disabled). ENABLE_WALK_ASSIST/ENABLE_BRAKE_SENSOR/
# STREET_MODE_CRUISE_ENABLED already match the real on-bike config as
# shipped, so they're left alone.
CONFIG_OVERRIDES = {
    "CRUISE_MODE_ENABLED": 1,
    "CRUISE_OVERRIDE_WALK_SPORT_ENABLED": 1,
    "CRUISE_OVERRIDE_WALK_TURBO_ENABLED": 1,
    "CRUISE_MODE_WALK_ENABLED": 1,  # cruiseWithoutPedaling
    "CRUISE_THRESHOLD_SPEED": 0,
}

# Same as CONFIG_OVERRIDES, but every level's override is on - used by
# ebike_all_levels below to test the ECO/TOUR extension.
CONFIG_OVERRIDES_ALL_LEVELS = {
    **CONFIG_OVERRIDES,
    "CRUISE_OVERRIDE_WALK_ECO_ENABLED": 1,
    "CRUISE_OVERRIDE_WALK_TOUR_ENABLED": 1,
}

# cruiseSpeedN defaults (firmwares/motor/tsdz2/src/config.h: CRUISE_TARGET_SPEED_LEVEL_1..4, km/h),
# as the x10 units apply_cruise() actually stores them in.
CRUISE_TARGET_X10 = {ECO: 120, TOUR: 160, SPORT: 200, TURBO: 240}
# ui8_riding_mode_parameter_array's raw (non-x10) km/h values for the same.
CRUISE_TARGET_KMH = {ECO: 12, TOUR: 16, SPORT: 20, TURBO: 24}


def _build_cruise_module(module_name, config_overrides):
    """Compiles a dedicated module against a scratch copy of firmwares/motor/tsdz2/src/ with
    config_overrides patched into config.h, leaving the real firmwares/motor/tsdz2/src/config.h
    and the default _tsdz2 module untouched. Shared by the ebike/
    ebike_all_levels fixtures below - only the module name and which
    macros get patched differ."""
    scratch = tempfile.mkdtemp(prefix="tsdz2-cruise-test-")
    try:
        for name in os.listdir(SRC_DIR):
            path = os.path.join(SRC_DIR, name)
            if os.path.isfile(path) and name.endswith((".c", ".h")):
                shutil.copy(path, scratch)

        config_path = os.path.join(scratch, "config.h")
        with open(config_path, encoding="utf8") as fh:
            text = fh.read()
        for key, value in config_overrides.items():
            pattern = rf"^#define {key} .*$"
            text, count = re.subn(pattern, f"#define {key} {value}", text, flags=re.M)
            assert count == 1, f"expected exactly one '#define {key} ...' in config.h, found {count}"
        # uart_receive_package() ends by re-enabling the UART2 RX interrupt
        # via a real register write (UART2->CR2 |= ...). UART2 is a macro
        # for a fixed STM8 hardware address (stm8s_uart2.h) - dereferencing
        # it natively segfaults. Redirect it at an ordinary process-memory
        # struct for tests; we bypass UART2 entirely anyway (writing
        # directly to ui8_rx_buffer instead of simulating real RX bytes).
        text += (
            "\n#ifdef UART2\n"
            "#undef UART2\n"
            "static UART2_TypeDef _test_uart2_backing;\n"
            "#define UART2 (&_test_uart2_backing)\n"
            "#endif\n"
        )
        with open(config_path, "w", encoding="utf8") as fh:
            fh.write(text)

        orig_source_dirs = load_c_code.source_dirs
        orig_include_dirs = load_c_code.include_dirs
        load_c_code.source_dirs = [scratch + os.sep]
        load_c_code.include_dirs = [scratch + os.sep, STDPERIPH_INC + os.sep]
        try:
            lib, _ = load_c_code.load_code(module_name, force_recompile=True)
        finally:
            load_c_code.source_dirs = orig_source_dirs
            load_c_code.include_dirs = orig_include_dirs
        yield lib
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@pytest.fixture(scope="module")
def ebike():
    """SPORT+TURBO only - the feature's original shipped scope."""
    yield from _build_cruise_module("_tsdz2_cruise", CONFIG_OVERRIDES)


@pytest.fixture(scope="module")
def ebike_all_levels():
    """All four levels' overrides on - the ECO/TOUR extension."""
    yield from _build_cruise_module("_tsdz2_cruise_all_levels", CONFIG_OVERRIDES_ALL_LEVELS)


def _reset(ebike):
    ebike.m_configuration_variables.ui8_riding_mode = POWER_ASSIST_MODE
    ebike.m_configuration_variables.ui8_set_parameter_enabled = 0
    ebike.m_configuration_variables.ui8_street_mode_enabled = 0
    ebike.m_configuration_variables.ui16_wheel_perimeter = 2070
    # uart_receive_package() also runs unrelated battery-current-limit math
    # every call (see test_diag.py, though it references a since-renamed
    # variable and is currently broken) that divides by this - left at 0
    # it's a real integer div-by-zero (SIGFPE), not a Python exception
    ebike.ui16_battery_voltage_filtered_x10 = 48 * 10
    ebike.ebike_app_init()
    ebike.ui8_startup_flag = 1  # skip the ~1.25s power-on window, not what's under test
    ebike.ui8_startup_assist_flag = 0
    ebike.ui8_walk_assist_flag = 0
    ebike.ui8_cruise_override_flag = 0
    ebike.ui8_cruise_button_flag = 0
    ebike.ui8_cruise_PID_initialize = 0
    ebike.ui16_wheel_speed_target_x10 = 0
    ebike.ui8_riding_mode_temp = 0
    ebike.ui16_wheel_speed_x10 = 0
    ebike.ui8_pedal_cadence_RPM = 0
    ebike.ui8_duty_cycle_target = 0
    ebike.ui8_assist_level_before_walk_button = ECO
    ebike.ui8_walk_assist_button_pressed = 0
    ebike.ui8_received_package_flag = 0


@pytest.fixture(autouse=True)
def reset_state(ebike):
    _reset(ebike)
    yield


def send_packet(ebike, level, button_pressed):
    """Simulates one display UART packet: assist level `level` (OFF/ECO/TOUR/
    SPORT/TURBO), walk-assist button pressed or not. Computes a valid
    checksum and calls the real uart_receive_package()."""
    buf = [0, ASSIST_PEDAL_LEVEL_BIT[level] | (WALK_BUTTON_BIT if button_pressed else 0), 0, 0, 0, 0]
    buf.append(sum(buf) & 0xFF)
    for i, b in enumerate(buf):
        ebike.ui8_rx_buffer[i] = b
    ebike.ui8_received_package_flag = 1
    ebike.uart_receive_package()


def press_button(ebike, level):
    """Models a real button press: level reported while NOT held, then held."""
    send_packet(ebike, level, button_pressed=False)
    send_packet(ebike, level, button_pressed=True)


def release_button(ebike, level):
    send_packet(ebike, level, button_pressed=False)


def test_ecotour_walk_assist_is_unaffected_by_the_override(ebike):
    """SPORT/TURBO are overridden to cruise; ECO/TOUR must still use plain
    walk assist, untouched (this is what actually worked on the stand test)."""
    press_button(ebike, TOUR)
    assert ebike.m_configuration_variables.ui8_riding_mode == WALK_ASSIST_MODE
    assert ebike.ui8_cruise_override_flag == 0


def test_override_engages_cruise_mode_at_turbo(ebike):
    press_button(ebike, TURBO)
    assert ebike.m_configuration_variables.ui8_riding_mode == CRUISE_MODE
    assert ebike.ui8_cruise_override_flag == 1
    assert ebike.ui8_cruise_button_flag == 1


def test_override_sets_a_nonzero_target_speed_on_first_engagement(ebike):
    """Regression for bug #3: apply_cruise()'s PID only (re)initializes -
    and only then sets ui16_wheel_speed_target_x10 - when
    ui8_cruise_PID_initialize was left set from a prior disengage. The
    override can engage on its very first poll ever, with no prior
    disengage to have set that flag; without ebike_app.c explicitly setting
    ui8_cruise_PID_initialize=1 on activation, target speed stays 0 forever
    and the PID's output clamps to zero - motor stays silent."""
    press_button(ebike, TURBO)
    ebike.ebike_control_motor()
    assert ebike.ui16_wheel_speed_target_x10 > 0, (
        "cruise target speed was never set - apply_cruise()'s PID never initialized "
        "on first engagement (this is the 'not even a whimper' bug)"
    )


def test_override_targets_the_pre_button_level_not_the_decremented_one(ebike):
    """Regression for bug #2: DZ40/VLCD5 displays report a decremented
    assist level while the walk-assist button is held. Simulates that: the
    display reports TURBO before the button is pressed, then SPORT while
    held (the decremented report). The override must still target TURBO's
    cruise speed (CRUISE_TARGET_SPEED_LEVEL_4=24 in the stock config, i.e.
    240 in x10 units), not SPORT's (CRUISE_TARGET_SPEED_LEVEL_3=20, 200)."""
    send_packet(ebike, TURBO, button_pressed=False)
    send_packet(ebike, SPORT, button_pressed=True)  # display's decremented report
    ebike.ebike_control_motor()
    assert ebike.ui16_wheel_speed_target_x10 == 240, (
        f"expected TURBO's target (240), got {ebike.ui16_wheel_speed_target_x10} "
        "- targeting the live (decremented) assist level instead of the pre-button one"
    )
    assert ebike.ui8_riding_mode_parameter == 24, (
        f"expected TURBO's ui8_riding_mode_parameter (24), got {ebike.ui8_riding_mode_parameter} "
        "- this also feeds ebike_control_motor()'s master safety cutoff "
        "(zeroes duty cycle/current entirely if it's 0)"
    )


def test_override_releases_back_to_original_riding_mode_on_button_release(ebike):
    """Regression for bug #1: a pre-existing 'riding_mode == CRUISE_MODE'
    branch (for displays with Cruise set as a permanent riding mode) used to
    shadow the override's own release-and-restore branch once CRUISE_MODE
    was entered, permanently stranding the rider there. Holds the button for
    several polls (to prove the legacy branch doesn't clobber state while
    held), then releases it."""
    press_button(ebike, TURBO)
    assert ebike.m_configuration_variables.ui8_riding_mode == CRUISE_MODE

    for _ in range(5):
        send_packet(ebike, TURBO, button_pressed=True)
        assert ebike.m_configuration_variables.ui8_riding_mode == CRUISE_MODE
        assert ebike.ui8_cruise_override_flag == 1

    release_button(ebike, TURBO)
    assert ebike.m_configuration_variables.ui8_riding_mode == POWER_ASSIST_MODE, (
        f"expected riding_mode restored to POWER_ASSIST_MODE ({POWER_ASSIST_MODE}), "
        f"got {ebike.m_configuration_variables.ui8_riding_mode} - stranded in CRUISE_MODE "
        "with no way back (this is the 'PAS vanished, needed a reboot' bug)"
    )
    assert ebike.ui8_cruise_override_flag == 0


# ---------------------------------------------------------------------------
# ECO/TOUR extension: same behaviors as above, now exercised at every level
# individually (ebike_all_levels has all four overrides on), plus one test
# proving the four config.h toggles are genuinely independent per-level
# switches rather than one shared on/off - not autouse, so each test resets
# its own module explicitly via _reset().
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("level", [ECO, TOUR, SPORT, TURBO])
def test_override_engages_cruise_mode_at_every_level(ebike_all_levels, level):
    _reset(ebike_all_levels)
    press_button(ebike_all_levels, level)
    assert ebike_all_levels.m_configuration_variables.ui8_riding_mode == CRUISE_MODE
    assert ebike_all_levels.ui8_cruise_override_flag == 1
    assert ebike_all_levels.ui8_cruise_button_flag == 1


@pytest.mark.parametrize("level", [ECO, TOUR, SPORT, TURBO])
def test_override_sets_correct_target_speed_at_every_level(ebike_all_levels, level):
    """Same as test_override_sets_a_nonzero_target_speed_on_first_engagement
    (bug #3) and test_override_targets_the_pre_button_level_not_the_decremented_one
    (bug #2), but checking the exact target (not just "nonzero") at each of
    the 4 levels - CRUISE_TARGET_X10 is level-specific, so a copy-paste
    mistake in main.h's per-level CRUISE_OVERRIDE_ACTIVE_LEVEL wiring (e.g.
    ECO accidentally checking TOUR's macro) would show up as a wrong target
    here even though "some level got overridden" would still look correct."""
    _reset(ebike_all_levels)
    press_button(ebike_all_levels, level)
    ebike_all_levels.ebike_control_motor()
    assert ebike_all_levels.ui16_wheel_speed_target_x10 == CRUISE_TARGET_X10[level]
    assert ebike_all_levels.ui8_riding_mode_parameter == CRUISE_TARGET_KMH[level]


@pytest.mark.parametrize("level", [ECO, TOUR, SPORT, TURBO])
def test_override_releases_back_to_original_riding_mode_at_every_level(ebike_all_levels, level):
    """Same as test_override_releases_back_to_original_riding_mode_on_button_release
    (bug #1), parametrized across all 4 levels."""
    _reset(ebike_all_levels)
    press_button(ebike_all_levels, level)
    assert ebike_all_levels.m_configuration_variables.ui8_riding_mode == CRUISE_MODE

    release_button(ebike_all_levels, level)
    assert ebike_all_levels.m_configuration_variables.ui8_riding_mode == POWER_ASSIST_MODE
    assert ebike_all_levels.ui8_cruise_override_flag == 0


def test_override_ramp_up_is_fast_at_riding_speed(ebike):
    """Regression for the "loses speed under load, has to bail" field report
    (2026-08-14): apply_cruise() used to hardcode CRUISE_DUTY_CYCLE_RAMP_UP_INVERSE_STEP
    unconditionally, instead of calling set_motor_ramp() like every other riding
    mode. That fixed rate (PWM_CYCLES_SECOND/116, 155 with the checked-in
    PWM_FREQ=18 default - PWM_CYCLES_SECOND = 16000000/(444*2) = 18018) is only
    marginally faster than the walk-speed/cold-start default (18018/98 = 183),
    while set_motor_ramp() drops to PWM_DUTY_CYCLE_RAMP_UP_INVERSE_STEP_MIN
    (18018/781 = 23, ~6.7x faster than 155) once wheel speed >= 20 km/h - real
    SPORT/TURBO riding speed. The override engages this same fast rate now;
    genuine display-selected Cruise mode (override flag off) keeps the
    original gentle rate - see the next test."""
    press_button(ebike, TURBO)
    ebike.ui16_wheel_speed_x10 = 250  # 25 km/h, well past the 20 km/h fast-ramp threshold
    ebike.ui8_pedal_cadence_RPM = 70
    ebike.ebike_control_motor()
    assert ebike.ui8_duty_cycle_ramp_up_inverse_step == 23, (
        f"expected the fast set_motor_ramp() rate (23) once at riding speed, "
        f"got {ebike.ui8_duty_cycle_ramp_up_inverse_step} - the override is still using "
        "Cruise's own fixed (slow) ramp rate instead"
    )


def test_native_cruise_mode_keeps_the_gentle_ramp(ebike):
    """Counterpart to the test above: genuine Cruise mode, selected directly
    (not via the walk-assist override), must keep apply_cruise()'s original
    fixed ramp rate - it's tuned for gentle corrections once already near the
    target speed, which is the actual use case when Cruise is a persistent
    riding mode picked from the display's own menu."""
    ebike.m_configuration_variables.ui8_riding_mode = CRUISE_MODE
    ebike.ui8_cruise_override_flag = 0
    ebike.ui8_assist_level = TURBO
    ebike.ui16_wheel_speed_x10 = 250
    ebike.ui8_pedal_cadence_RPM = 70
    ebike.ebike_control_motor()
    assert ebike.ui8_duty_cycle_ramp_up_inverse_step == 155, (
        f"expected Cruise's own fixed rate (155) for native (non-override) Cruise mode, "
        f"got {ebike.ui8_duty_cycle_ramp_up_inverse_step} - native Cruise mode's gentle ramp "
        "regressed"
    )


def test_override_toggles_are_independent_per_level(ebike):
    """The whole point of CRUISE_OVERRIDE_WALK_ECO/TOUR/SPORT/TURBO_ENABLED
    being 4 separate config.h macros (not one shared switch) is that a rider
    can override just the levels they want. `ebike` only has SPORT/TURBO
    enabled (ECO/TOUR left off) - confirms ECO/TOUR still get plain walk
    assist (not cruise) with that selective config, i.e. leaving a level's
    override off really does leave it alone, one level at a time."""
    for level in (ECO, TOUR):
        _reset(ebike)
        press_button(ebike, level)
        assert ebike.m_configuration_variables.ui8_riding_mode == WALK_ASSIST_MODE, (
            f"level {level}: expected plain Walk assist (override not enabled for this level), "
            f"got riding_mode={ebike.m_configuration_variables.ui8_riding_mode}"
        )
        assert ebike.ui8_cruise_override_flag == 0


if __name__ == "__main__":
    pytest.main([__file__])

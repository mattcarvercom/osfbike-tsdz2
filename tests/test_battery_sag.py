"""Battery-sag feature (2026-08-15): motor.c's undervoltage ramp-down check
(motor.c:813) now compares a lightly filtered voltage instead of a single raw
ADC sample, and ebike_app.c can surface a purely-informational E11 fault
(ERROR_BATTERY_SAG, main.h) whenever that check is actively throttling power -
see UNIVERSAL_FIRMWARE_PLAN.md's battery-sag entry for the full rationale.

Both pieces are exposed as small standalone static functions specifically so
they're directly testable without needing their much larger callers'
preconditions (the raw PWM ISR / uart_send_package()'s display-ready state) -
see the functions' own comments in firmwares/motor/tsdz2/src/motor.c and firmwares/motor/tsdz2/src/ebike_app.c.
"""

import os
import re
import shutil
import sys
import tempfile

import pytest
from sim._tsdz2 import ffi, lib as ebike  # module generated from c-code

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import load_c_code  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO_ROOT, "firmwares", "motor", "tsdz2", "src")


@pytest.fixture(autouse=True)
def reset_state():
    # ui32_adc_voltage_filter_accumulator (not ui16_adc_voltage_filtered) is the
    # filter's real working state now - filter_undervoltage_check_voltage() derives
    # ui16_adc_voltage_filtered from it fresh on every call, overwriting whatever it
    # was set to beforehand, so seeding/resetting the accumulator is what matters.
    # ui8_adc_voltage_filter_primed must be reset alongside it (not just the
    # accumulator) so each test starts from a genuine "power-on" state - real
    # hardware resets both together, and leaving primed=1 across tests (it's a
    # module-level static, shared by every test using this same compiled `ebike`
    # module) would silently skip the seed-from-first-sample path being tested.
    ebike.ui32_adc_voltage_filter_accumulator = 0
    ebike.ui8_adc_voltage_filter_primed = 0
    ebike.ui16_adc_voltage_filtered = 0
    ebike.ui16_adc_voltage = 0
    ebike.ui16_adc_voltage_cut_off = 0
    ebike.ui8_display_fault_code = 0  # NO_FAULT
    yield
    ebike.ui32_adc_voltage_filter_accumulator = 0
    ebike.ui8_adc_voltage_filter_primed = 0
    ebike.ui16_adc_voltage_filtered = 0
    ebike.ui16_adc_voltage = 0
    ebike.ui16_adc_voltage_cut_off = 0
    ebike.ui8_display_fault_code = 0


class TestUndervoltageVoltageFilterDefaultShip:
    """Lightweight smoke test against whatever the real default module ships
    (currently BATTERY_VOLTAGE_SAG_FILTER_SHIFT=10, ~57ms time constant at the
    18kHz/55.5us PWM period - see sections/battery.ts's tooltip for the full
    timing rationale). Deliberately qualitative only, not exact-convergence
    numbers - at shift=10 that would need ~1000+ iterations. The precise
    arithmetic is verified once, independent of whatever default is currently
    tuned in, by TestUndervoltageVoltageFilterMath below (pinned to shift=2)."""

    def test_first_call_since_reset_seeds_straight_to_the_raw_sample(self):
        # Regression test for the real bug (2026-08-16): the accumulator used
        # to start every power-on/reset at a hard 0, so the very first calls
        # after reset read far below any realistic raw voltage - and since
        # motor.c's undervoltage ramp-down check compares this filtered value
        # every single PWM cycle, that climb-from-zero window actively held
        # the motor's duty cycle at 0 (not just delayed ramp-up) for however
        # long it took the EMA to climb back above cutoff. ui8_adc_voltage_
        # filter_primed now seeds the accumulator from the very first real
        # sample instead, so there's no artificial climb: filtered should
        # equal the raw sample exactly on the first call, not partway there.
        ebike.ui16_adc_voltage = 400
        ebike.filter_undervoltage_check_voltage()
        assert ebike.ui16_adc_voltage_filtered == 400

    def test_repeated_calls_move_monotonically_toward_a_new_sustained_value(self):
        # Once primed, the filter should still behave as a normal EMA for a
        # genuine change in voltage (e.g. sag developing mid-ride) - smooth,
        # steady, monotonic progress toward the new value, not an instant
        # jump (that's the whole point of filtering) and not a collapse back
        # to 0 (the old same-resolution-accumulator bug this class's sibling
        # test above now covers at the reset point instead).
        ebike.ui16_adc_voltage = 400
        ebike.filter_undervoltage_check_voltage()  # primes to 400 immediately
        assert ebike.ui16_adc_voltage_filtered == 400

        ebike.ui16_adc_voltage = 100  # sustained drop starts now
        prev = 400
        for _ in range(20):
            ebike.filter_undervoltage_check_voltage()
            assert 100 <= ebike.ui16_adc_voltage_filtered <= prev
            prev = ebike.ui16_adc_voltage_filtered
        assert prev < 400


class TestUndervoltageVoltageFilterMath:
    """Precise convergence/smoothing-math checks, pinned to an explicit
    BATTERY_VOLTAGE_SAG_FILTER_SHIFT=2 scratch module (see ebike_shift_2 below)
    so they stay correct regardless of whatever the real default gets tuned to
    later - shift=2 just converges fast enough (~4 samples) to assert exact
    numbers within a small, fast iteration count."""

    def test_converges_to_a_sustained_raw_value(self, ebike_shift_2):
        # A genuinely sustained voltage should still be reflected accurately
        # once the filter settles - this isn't a permanent bias, just a delay.
        lib = ebike_shift_2
        lib.ui32_adc_voltage_filter_accumulator = 0
        lib.ui8_adc_voltage_filter_primed = 0
        lib.ui16_adc_voltage = 400
        for _ in range(50):
            lib.filter_undervoltage_check_voltage()
        assert lib.ui16_adc_voltage_filtered == 400

    def test_single_transient_dip_is_smoothed_not_passed_through(self, ebike_shift_2):
        # Settle at a healthy voltage, then simulate one brief low sample
        # (e.g. a momentary current-spike-induced dip) amid otherwise-healthy
        # readings - the filtered value should barely move, not instantly
        # read the same as the raw dip.
        lib = ebike_shift_2
        lib.ui32_adc_voltage_filter_accumulator = 0
        lib.ui8_adc_voltage_filter_primed = 0
        lib.ui16_adc_voltage = 400
        for _ in range(50):
            lib.filter_undervoltage_check_voltage()
        assert lib.ui16_adc_voltage_filtered == 400

        lib.ui16_adc_voltage = 100  # one noisy/transient low sample
        lib.filter_undervoltage_check_voltage()
        # Raw dropped by 300; filtered should have moved only a fraction of that
        # (325 exactly, per the accumulator math - loose bound here for
        # readability, exact value re-derived if this ever needs re-tuning).
        assert lib.ui16_adc_voltage_filtered > 300

    def test_sustained_drop_does_eventually_reach_the_cutoff_check(self, ebike_shift_2):
        # A single dip is smoothed, but a real, sustained drop still gets
        # through given enough cycles - this is a delay, not a defeat, of the
        # protection (see the cutoff-comparison tests below for the actual
        # ramp-down check this feeds). Unlike the old same-resolution design
        # (which settled into a small dead-band short of the true target when
        # approaching from above), the wider accumulator converges exactly.
        lib = ebike_shift_2
        lib.ui32_adc_voltage_filter_accumulator = 0
        lib.ui8_adc_voltage_filter_primed = 0
        lib.ui16_adc_voltage = 400
        for _ in range(50):
            lib.filter_undervoltage_check_voltage()

        lib.ui16_adc_voltage = 100
        for _ in range(50):
            lib.filter_undervoltage_check_voltage()
        assert lib.ui16_adc_voltage_filtered == 100


class TestBatterySagIndicator:
    """check_battery_sag_indicator() (firmwares/motor/tsdz2/src/ebike_app.c) - checked-in
    firmwares/motor/tsdz2/src/config.h has ENABLE_BATTERY_SAG_INDICATOR=1, matching the web
    configurator's batterySagIndicatorEnabled default (true)."""

    ERROR_BATTERY_SAG = 11  # main.h: E11, non-EKD01 branch (EKD01 branch: same value)
    NO_FAULT = 0
    ERROR_OVERVOLTAGE = 1  # main.h: E01, shared with ERROR_UNDERVOLTAGE

    def test_sets_e11_when_voltage_is_below_cutoff_and_no_other_fault(self):
        ebike.ui16_adc_voltage_cut_off = 300
        ebike.ui16_adc_voltage_filtered = 200
        ebike.ui8_display_fault_code = self.NO_FAULT
        ebike.check_battery_sag_indicator()
        assert ebike.ui8_display_fault_code == self.ERROR_BATTERY_SAG

    def test_stays_no_fault_when_voltage_is_healthy(self):
        ebike.ui16_adc_voltage_cut_off = 300
        ebike.ui16_adc_voltage_filtered = 400
        ebike.ui8_display_fault_code = self.NO_FAULT
        ebike.check_battery_sag_indicator()
        assert ebike.ui8_display_fault_code == self.NO_FAULT

    def test_never_overrides_a_more_serious_fault_already_set(self):
        # A real fault (e.g. overvoltage, set earlier the same poll by
        # uart_send_package()'s own logic before this runs) must win over the
        # benign sag indicator - this is the whole point of the NO_FAULT guard.
        ebike.ui16_adc_voltage_cut_off = 300
        ebike.ui16_adc_voltage_filtered = 200  # sag condition is also true
        ebike.ui8_display_fault_code = self.ERROR_OVERVOLTAGE
        ebike.check_battery_sag_indicator()
        assert ebike.ui8_display_fault_code == self.ERROR_OVERVOLTAGE

    def test_at_exactly_the_cutoff_boundary_does_not_trigger(self):
        # motor.c's own check is a strict "<", not "<=" - mirror that here so
        # both sides of this feature agree on exactly when sag starts.
        ebike.ui16_adc_voltage_cut_off = 300
        ebike.ui16_adc_voltage_filtered = 300
        ebike.ui8_display_fault_code = self.NO_FAULT
        ebike.check_battery_sag_indicator()
        assert ebike.ui8_display_fault_code == self.NO_FAULT


def _build_scratch_module(module_name, config_overrides):
    """Compiles a dedicated module against a scratch copy of firmwares/motor/tsdz2/src/ with
    config_overrides patched into config.h, leaving the real firmwares/motor/tsdz2/src/config.h and
    the default _tsdz2 module (used by every test above) untouched. Mirrors
    test_cruise_override.py's _build_cruise_module() - see tests/CLAUDE.md's
    "Testing a feature that needs a non-default config.h" section."""
    scratch = tempfile.mkdtemp(prefix="tsdz2-battery-sag-test-")
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
        with open(config_path, "w", encoding="utf8") as fh:
            fh.write(text)

        orig_source_dirs = load_c_code.source_dirs
        orig_include_dirs = load_c_code.include_dirs
        load_c_code.source_dirs = [scratch + os.sep]
        load_c_code.include_dirs = [scratch + os.sep, os.path.join(SRC_DIR, "STM8S_StdPeriph_Lib", "inc") + os.sep]
        try:
            lib, _ = load_c_code.load_code(module_name, force_recompile=True)
        finally:
            load_c_code.source_dirs = orig_source_dirs
            load_c_code.include_dirs = orig_include_dirs
        yield lib
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@pytest.fixture(scope="module")
def ebike_shift_2():
    """Pins BATTERY_VOLTAGE_SAG_FILTER_SHIFT=2 regardless of the real
    checked-in default, specifically so TestUndervoltageVoltageFilterMath's
    exact-convergence assertions stay correct if that default is ever tuned
    again (shift=2 converges in ~4 samples - fast enough to assert precisely
    within a small, fast loop count; the real default's much larger time
    constant would need ~1000+ iterations for the same precision)."""
    yield from _build_scratch_module("_tsdz2_battery_sag_shift_2", {"BATTERY_VOLTAGE_SAG_FILTER_SHIFT": 2})


@pytest.fixture(scope="module")
def ebike_indicator_disabled():
    """ENABLE_BATTERY_SAG_INDICATOR=0 - checked-in config.h ships this on, so
    this is the only way to cover the opt-out toggle actually compiling the
    E11 logic out (see check_battery_sag_indicator()'s #if in firmwares/motor/tsdz2/src/ebike_app.c)."""
    yield from _build_scratch_module("_tsdz2_battery_sag_indicator_off", {"ENABLE_BATTERY_SAG_INDICATOR": 0})


@pytest.fixture(scope="module")
def ebike_filter_disabled():
    """BATTERY_VOLTAGE_SAG_FILTER_SHIFT=0 - disables smoothing entirely, per
    filter_undervoltage_check_voltage()'s own comment in firmwares/motor/tsdz2/src/motor.c."""
    yield from _build_scratch_module("_tsdz2_battery_sag_filter_off", {"BATTERY_VOLTAGE_SAG_FILTER_SHIFT": 0})


class TestIndicatorCanBeCompiledOut:
    def test_e11_never_fires_when_the_toggle_is_off(self, ebike_indicator_disabled):
        lib = ebike_indicator_disabled
        lib.ui16_adc_voltage_cut_off = 300
        lib.ui16_adc_voltage_filtered = 200  # sag condition is true
        lib.ui8_display_fault_code = 0  # NO_FAULT
        lib.check_battery_sag_indicator()
        assert lib.ui8_display_fault_code == 0  # still NO_FAULT - feature fully compiled out


class TestFilterCanBeDisabled:
    def test_shift_zero_makes_filtered_track_raw_exactly_every_call(self, ebike_filter_disabled):
        lib = ebike_filter_disabled
        lib.ui32_adc_voltage_filter_accumulator = 0
        lib.ui8_adc_voltage_filter_primed = 0
        lib.ui16_adc_voltage = 250
        lib.filter_undervoltage_check_voltage()
        # No smoothing at all: filtered should equal the raw sample immediately,
        # not partway there like every shift>0 case tested above.
        assert lib.ui16_adc_voltage_filtered == 250

        lib.ui16_adc_voltage = 80  # a single transient dip
        lib.filter_undervoltage_check_voltage()
        assert lib.ui16_adc_voltage_filtered == 80  # passes straight through, unsmoothed


if __name__ == "__main__":
    pytest.main()

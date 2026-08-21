import pytest
from sim._tsdz2 import ffi, lib as ebike # module generated from c-code
import numpy as np

BATTERY_CURRENT_PER_10_BIT_ADC_STEP_X100 = 16
mA_to_ADC = 100/BATTERY_CURRENT_PER_10_BIT_ADC_STEP_X100 / 1000

# Set up initial values before each test
@pytest.fixture(autouse=True)
def setup_ebike():
    # Set up initial values before each test
    # ui8_wheel_speed_max is ebike_app.c's own file-scope static (resolved
    # from ui8_wheel_speed_max_array by street/offroad mode elsewhere) - not
    # part of m_configuration_variables.
    ebike.ui8_wheel_speed_max = 25
    ebike.ui8_duty_cycle_target = 255 # set by assistance function
    ebike.ui8_adc_battery_current_target = int(5000 * mA_to_ADC)  # 5000mA set by assistance function
    yield
    # Teardown after each test (optional)


def apply_speed_limit_float(speed):
    speed_max = ebike.ui8_wheel_speed_max
    speed_lo = speed_max - 2
    speed_hi = speed_max + 2
    curr_target = ebike.ui8_adc_battery_current_target
    current_lim = np.interp(speed, [speed_lo, speed_hi], [curr_target, 0])
    return current_lim

# Parameterized test function with different ticks values
@pytest.mark.parametrize("speed", [0, 22.9, 23, 23.5, 24, 24.5, 25, 25.5, 26, 26.5, 27, 27.1, 30])
def test_apply_speed_limit(speed):
    ebike.ui16_wheel_speed_x10 = int(speed * 10)

    expected = apply_speed_limit_float(speed) # this has to run first
    ebike.apply_speed_limit()
    result = ebike.ui8_adc_battery_current_target

    assert result ==pytest.approx(expected, rel=1e-1, abs=0.1), f'Expected target {expected/mA_to_ADC}mA, got {result/mA_to_ADC}mA'


# Regression tests for a real uint8_t wraparound bug (found 2026-08-14): with
# ui8_wheel_speed_max at 254 or 255, the old `(uint8_t)(ui8_wheel_speed_max +
# 2U)` wrapped around (255+2 -> 1) before being multiplied by 10, so
# speed_limit_high came out as ~0-1 km/h instead of ~256-257 km/h - a rider
# trying to configure "effectively no limit" via a near-max value would
# instead get the motor's duty cycle killed almost immediately at any real
# speed. Fixed by clamping the +2/-2 operands before the uint8_t cast.
@pytest.mark.parametrize("wheel_max,speed_kmh", [(254, 30), (254, 100), (255, 30), (255, 100), (255, 200)])
def test_apply_speed_limit_no_wraparound_near_uint8_max(wheel_max, speed_kmh):
    ebike.ui8_wheel_speed_max = wheel_max
    ebike.ui16_wheel_speed_x10 = speed_kmh * 10
    ebike.ui8_duty_cycle_target = 255
    ebike.ui8_adc_battery_current_target = 100
    ebike.apply_speed_limit()
    assert ebike.ui8_duty_cycle_target == 255, (
        f"wheel_speed_max={wheel_max}, speed={speed_kmh}km/h: duty cycle was zeroed - "
        "the near-max-uint8_t wraparound bug is back"
    )
    assert ebike.ui8_adc_battery_current_target == 100


@pytest.mark.parametrize("wheel_max", [251, 252, 253])
def test_apply_speed_limit_253_is_the_safe_ceiling(wheel_max):
    """253 is the highest value that doesn't touch the uint8_t wraparound
    (253 + 2 = 255, exactly at the boundary) - confirms it stays unlimited up
    through a speed no real TSDZ2 setup will ever reach."""
    ebike.ui8_wheel_speed_max = wheel_max
    ebike.ui16_wheel_speed_x10 = 200 * 10
    ebike.ui8_duty_cycle_target = 255
    ebike.ui8_adc_battery_current_target = 100
    ebike.apply_speed_limit()
    assert ebike.ui8_duty_cycle_target == 255
    assert ebike.ui8_adc_battery_current_target == 100


# Run the tests
if __name__ == '__main__':
    pytest.main()

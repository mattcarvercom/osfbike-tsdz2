import pytest
from hypothesis import given, assume, strategies as st
from sim._tsdz2 import ffi, lib as ebike # module generated from c-code

# Set up initial values before each test
@pytest.fixture(autouse=True)
def setup_ebike():
    # Set up initial values before each test
    ebike.m_configuration_variables.ui16_wheel_perimeter = 2070

    # for oem wheel speed
    ebike.ui8_display_ready_flag = 1

    yield
    # Teardown after each test (optional)
    ebike.ui16_wheel_speed_sensor_ticks = 0
    ebike.ui16_wheel_speed_x10 = 0


# Expected values below are derived from calc_wheel_speed()'s real formula
# (firmwares/motor/tsdz2/src/ebike_app.c):
#   ui16_wheel_speed_x10 = (perimeter_mm * ((PWM_CYCLES_SECOND/1000)*36)) / ticks
# with PWM_CYCLES_SECOND = 16000000/(PWM_COUNTER_MAX*2), and PWM_COUNTER_MAX
# selected by firmwares/motor/tsdz2/src/config.h's PWM_FREQ (currently 18 -> PWM_COUNTER_MAX=444,
# see firmwares/motor/tsdz2/src/main.h). All divisions are integer/truncating, including
# PWM_CYCLES_SECOND/1000 itself, and the final result narrows to uint16_t
# (wraps at 65536) - see the ticks=1 case below. These were previously
# computed for PWM_FREQ=19 (PWM_COUNTER_MAX=420) and went stale when
# config.h's default changed to 18 kHz; if that default ever changes again,
# these need recomputing too - see wheel_speed_calc_float() below for a
# from-scratch reference formula (used by the tolerant precision test).
# calc_wheel_speed() now clamps to 0 once ticks >= WHEEL_SPEED_COUNTER_MAX
# (a stale/very-low-speed reading) instead of doing the raw division - see
# the ticks=65535 case below, which used to wrap around to a small nonzero
# value instead of correctly reading as stopped.

# Test function for calc_wheel_speed
def test_calc_wheel_speed_simple():
    ebike.ui16_wheel_speed_sensor_ticks = 10000
    ebike.calc_wheel_speed()
    result = ebike.ui16_wheel_speed_x10
    expected = 134
    assert result == expected, f'Test failed! Expected {expected} value, got {result} value'

# Parameterized test function with different ticks values
@pytest.mark.parametrize("ticks, expected", [
    # (0,     0),
    (1,     30640),  # 2070*648=1341360, // 1 wraps mod 65536 -> 30640
    (1000,  1341),
    (2000,  670),
    (5000,  268),
    (10000, 134),
    (20000, 67),
    (65535, 0)
])
def test_calc_wheel_speed_with_various_ticks(ticks, expected):
    ebike.ui16_wheel_speed_sensor_ticks = ticks
    ebike.calc_wheel_speed()
    result = ebike.ui16_wheel_speed_x10
    assert result == expected, f'Expected {expected/10}km/h, got {result/10}km/h'





# 420*2 -> PWM_COUNTER_MAX for PWM_FREQ=19; current config.h default is
# PWM_FREQ=18, i.e. PWM_COUNTER_MAX=444 (firmwares/motor/tsdz2/src/main.h) - see the comment above
# test_calc_wheel_speed_simple for the full derivation.
MOTOR_TASK_FREQ = 16000000 / (444*2)
def wheel_speed_calc_float(ui16_wheel_perimeter: int, ui16_wheel_speed_sensor_ticks: int) -> float:
    rps = MOTOR_TASK_FREQ / ui16_wheel_speed_sensor_ticks
    kph = rps * ui16_wheel_perimeter * ((3600 / (1000 * 1000)))
    return kph

def wheel_inch_to_mm_circumference(wheel_inch: float) -> float:
    diameter_mm = wheel_inch * 25.4
    circumference_mm = diameter_mm * 3.14159
    return circumference_mm


@pytest.mark.parametrize("wheel_size", range(14, 30))
def test_wheel_speed_calculation_precision_parametrized(wheel_size):
    """
    Test wheel speed calculation precision for different wheel sizes
    
    :param ebike: An instance of the ebike with necessary attributes and methods
    :param wheel_size: The wheel perimeter to test
    """
    ui16_wheel_perimeter = int(wheel_inch_to_mm_circumference(wheel_size)) 
    ebike.m_configuration_variables.ui16_wheel_perimeter = ui16_wheel_perimeter
    error = {}
    for ticks in range(1000, 65535, 100):     # Range from 1 to 10000
        ebike.ui16_wheel_speed_sensor_ticks = ticks
        ebike.calc_wheel_speed()
        result = ebike.ui16_wheel_speed_x10 / 10
        expected = wheel_speed_calc_float(ui16_wheel_perimeter, ticks)
        assert result == pytest.approx(expected, rel=1e-1, abs=0.1), (
            f"Test failed for wheel size {wheel_size} (perimeter {ui16_wheel_perimeter}) and tick count {ticks}! "
            f"Expected {expected:.2f}, got {result:.2f}"
        )
        error[ticks] = abs(result - expected)
    # pytest -s to print
    print(f"Biggest error: {max(error.values())}")
    print(f"Average error: {sum(error.values()) / len(error)}")

OEM_WHEEL_SPEED_DIVISOR = 384

@given(
	ticks=st.integers(min_value=85, max_value=65535), #14in wheel min tics
	wheel_size=st.integers(min_value=10, max_value=32) # 10 to 32inch
    )
def test_calc_oem_wheel_speed(ticks, wheel_size):
    ebike.ui8_oem_wheel_diameter = wheel_size
    ebike.ui16_wheel_speed_sensor_ticks = ticks
    ui16_wheel_perimeter = int(wheel_inch_to_mm_circumference(wheel_size)) 
    ebike.m_configuration_variables.ui16_wheel_perimeter = ui16_wheel_perimeter
    expected = wheel_size * 80 * 10 * ticks / (ebike.m_configuration_variables.ui16_wheel_perimeter * OEM_WHEEL_SPEED_DIVISOR)
    ebike.calc_oem_wheel_speed()
    result = ebike.ui16_oem_wheel_speed_time

    assert result == pytest.approx(expected, rel=1e-1, abs=1), (
            f"Test failed for wheel size {wheel_size} (perimeter {ui16_wheel_perimeter}) and tick count {ticks}! "
            f"Expected {expected:.2f}, got {result}"
    )

# Run the tests
if __name__ == '__main__':
    pytest.main()

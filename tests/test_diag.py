import pytest
from sim._tsdz2 import ffi, lib as ebike # module generated from c-code

# Set up initial values before each test
@pytest.fixture(autouse=True)
def setup_ebike():
    # Set up initial values before each test
    ebike.m_configuration_variables.ui16_wheel_perimeter = 2070
    yield
    # Teardown after each test (optional)
    ebike.ui16_wheel_speed_sensor_ticks = 0
    ebike.ui16_wheel_speed_x10 = 0

def test_battery_current_max_from_battery_power_max():
    '''Regression for ui8_adc_battery_current_max's static-initializer default
    (firmwares/motor/tsdz2/src/ebike_app.c: `static uint8_t ui8_adc_battery_current_max =
    ADC_10_BIT_BATTERY_CURRENT_MAX;`). Despite the name/original docstring,
    this does NOT exercise the battery-power-based recompute in
    uart_receive_package() - that recompute lives inside a block gated on a
    valid received packet, which this test never simulates (no
    ui8_received_package_flag/ui8_rx_buffer set up), so it never runs here.
    ebike_app_init() itself never writes ui8_adc_battery_current_max either
    (only its temp_1/temp_2 helpers) - so the value asserted below is really
    just ADC_10_BIT_BATTERY_CURRENT_MAX's own hard clamp (firmwares/motor/tsdz2/src/main.h),
    unchanged since process start. Update `expected` if that constant
    changes.'''
    ebike.m_configuration_variables.ui8_battery_current_max = 255
    # Real field is ui16_battery_voltage_filtered_x10 (see firmwares/motor/tsdz2/src/ebike_app.c) -
    # x10, not x1000 - e.g. 48V is 480, not 48000.
    ebike.ui16_battery_voltage_filtered_x10 = 48*10
    ebike.ebike_app_init()
    ebike.uart_receive_package()
    result = ebike.ui8_adc_battery_current_max
    expected = 136  # ADC_10_BIT_BATTERY_CURRENT_MAX (firmwares/motor/tsdz2/src/main.h) = 22A
    assert result == expected


# Run the tests
if __name__ == '__main__':
    pytest.main()

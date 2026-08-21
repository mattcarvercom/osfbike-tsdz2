#include <stdio.h>
#include "screen.h"
#include "mainscreen.h"
#include "configscreen.h"
#include "eeprom.h"

/* Read-only string field buffers. The motor firmware version is formatted from
 * the live FIRMWARE_VERSION UART reply (g_tsdz2_firmware_version, state.h) at
 * config-screen entry; the display firmware version is a compile-time constant
 * (DISPLAY_FIRMWARE_MAJOR/MINOR/PATCH, Makefile.common); trip time is formatted
 * from ui_vars.ui32_trip_a_time the same way mainscreen.c's tripATimeField was. */
static char g_motor_firmware_version_str[16];
static char g_display_firmware_version_str[16] = DISPLAY_FIRMWARE_MAJOR "." DISPLAY_FIRMWARE_MINOR "." DISPLAY_FIRMWARE_PATCH;
static char g_trip_time_str[16];
/* History Errors -> Last error 1-4: ui_vars.ui8_last_error[] only stores the
 * raw motorErrorsIndex byte (0-9, see mainscreen.c's warnings()) - resolved
 * to text via motor_error_text() the same way the main screen's own "e: "
 * warning banner does, instead of showing the rider a bare index number. */
static char g_last_error_str[4][16];

/* Moved up from its old position below variousMenus: bikeMenus (860C) now
 * references it as the "History errors" submenu, so it must be declared first. */
static Field errorsMenus[] =
{
#ifndef SW102
	FIELD_READONLY_STRING("Last error 1", g_last_error_str[0]),
	FIELD_READONLY_STRING("Last error 2", g_last_error_str[1]),
	FIELD_READONLY_STRING("Last error 3", g_last_error_str[2]),
	FIELD_READONLY_STRING("Last error 4", g_last_error_str[3]),
	FIELD_READONLY_UINT("Time since err 1", &ui_vars.ui32_time_since_error[0], "", .div_digits = 2),
	FIELD_READONLY_UINT("Time since err 2", &ui_vars.ui32_time_since_error[1], "", .div_digits = 2),
	FIELD_READONLY_UINT("Time since err 3", &ui_vars.ui32_time_since_error[2], "", .div_digits = 2),
	FIELD_READONLY_UINT("Time since err 4", &ui_vars.ui32_time_since_error[3], "", .div_digits = 2),
#else
	FIELD_READONLY_STRING("Last err 1", g_last_error_str[0]),
	FIELD_READONLY_STRING("Last err 2", g_last_error_str[1]),
	FIELD_READONLY_STRING("Last err 3", g_last_error_str[2]),
	FIELD_READONLY_STRING("Last err 4", g_last_error_str[3]),
#endif
	FIELD_EDITABLE_ENUM("Reset", &ui_vars.ui8_history_errors_reset, "no", "yes"),
	FIELD_END };

static Field tripMenus[] =
{
#ifndef SW102
	FIELD_READONLY_UINT("Trip distance", &ui_vars.ui32_trip_a_distance_x10, "km", false, .div_digits = 1),
	FIELD_READONLY_STRING("Trip time", g_trip_time_str),
	FIELD_EDITABLE_ENUM("Reset trip", &ui8_g_configuration_trip_a_reset, "no", "yes"),
#else
	FIELD_EDITABLE_ENUM("Rst trip A", &ui8_g_configuration_trip_a_reset, "no", "yes"),
	FIELD_EDITABLE_ENUM("Rst trip B", &ui8_g_configuration_trip_b_reset, "no", "yes"),
#endif
	FIELD_END };

static Field bikeMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_ENUM("Motor power even /w eng. fault?", &ui_vars.ui8_assist_with_error_enabled, "no", "yes"),
	FIELD_EDITABLE_ENUM("Riding mode", &ui_vars.ui8_street_mode_enabled, "street", "off-road"),
	FIELD_EDITABLE_UINT("Odometer", &ui_vars.ui32_odometer_x10, "km", 0, UINT32_MAX, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationWheelOdometer),
	FIELD_EDITABLE_ENUM("A service", &ui_vars.ui8_service_a_distance_enable, "disabled", "chain", "brakes", "shocks", "other"),
	FIELD_EDITABLE_UINT("A service distance", &ui_vars.ui16_service_a_distance, "km", 0, 10000, .div_digits = 0, .inc_step = 10, .onSetEditable = onSetConfigurationServiceDistanceA),
	FIELD_EDITABLE_ENUM("B service", &ui_vars.ui8_service_b_distance_enable, "disabled", "chain", "brakes", "shocks", "other"),
	FIELD_EDITABLE_UINT("B service distance", &ui_vars.ui16_service_b_distance, "km", 0, 10000, .div_digits = 0, .inc_step = 10, .onSetEditable = onSetConfigurationServiceDistanceB),
	FIELD_SCROLLABLE("History errors", errorsMenus),
#else
	FIELD_EDITABLE_UINT("Wheel circ", &ui_vars.ui16_wheel_perimeter, "mm", 750, 3000, .inc_step = 10),
	FIELD_EDITABLE_ENUM("AssWithErr", &ui_vars.ui8_assist_with_error_enabled, "no", "yes"),
	FIELD_EDITABLE_ENUM("Hotkey", &ui_vars.ui8_street_mode_hotkey_enabled, "disable", "enable"),
	FIELD_EDITABLE_ENUM("StreetMode", &ui_vars.ui8_street_mode_enabled, "disable", "enable"),
	FIELD_EDITABLE_ENUM("EnablStart", &ui_vars.ui8_street_mode_enabled_on_startup, "no", "yes"),
	FIELD_EDITABLE_ENUM("Edit mode", &ui_vars.ui8_offroad_or_street_edit_mode, "offroad", "street"),
	FIELD_EDITABLE_UINT("Max speed", &ui_vars.ui8_offroad_or_street_max_speed, "kph", 1, 99, .div_digits = 0, .inc_step = 1, .hide_fraction = true),
	FIELD_EDITABLE_UINT("Max power", &ui_vars.ui16_offroad_or_street_max_power, "watts", 25, 1500, .div_digits = 0, .inc_step = 25, .hide_fraction = true),
	FIELD_EDITABLE_ENUM("Throttle", &ui_vars.ui8_offroad_or_street_throttle_enabled, "disable", "pedaling", "6km/h only", "6km/h&ped", "w/o pedal"),
	FIELD_EDITABLE_ENUM("Cruise", &ui_vars.ui8_offroad_or_street_cruise_enabled, "disable", "pedaling", "w/o pedal"),
	FIELD_EDITABLE_ENUM("PassEnable", &ui_vars.ui8_password_enabled, "no", "yes"),
	FIELD_EDITABLE_UINT("Password", &ui_vars.ui16_entered_password, "", 1000, 9999),
	FIELD_EDITABLE_ENUM("Confirm", &ui_vars.ui8_confirm_password, "logout", "login", "wait", "change"),
	FIELD_EDITABLE_ENUM("Reset", &ui_vars.ui8_reset_password, "no", "yes"),
#endif
	FIELD_END };

static Field batteryMenus[] =
{
#ifndef SW102
	FIELD_READONLY_UINT("Voltage est", &ui_vars.ui16_battery_voltage_soc_x10, "volts", false, .div_digits = 1),
	FIELD_READONLY_UINT("Resistance est", &ui_vars.ui16_battery_pack_resistance_estimated_x1000, "mohm", 0, 1000),
	FIELD_READONLY_UINT("Power loss est", &ui_vars.ui16_battery_power_loss, "watts", false, .div_digits = 0),
	FIELD_EDITABLE_UINT("Battery total Wh", &ui_vars.ui32_wh_x10_100_percent, "whr", 0, 29990, .div_digits = 1, .inc_step = 100),
	FIELD_EDITABLE_UINT("Used Wh", &ui_vars.ui32_wh_x10, "whr", 0, 99900, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationBatterySOCUsedWh),
	FIELD_EDITABLE_ENUM("Manual reset", &ui8_g_configuration_battery_soc_reset, "no", "yes"),
#else
	FIELD_EDITABLE_UINT("Max curren", &ui_vars.ui8_battery_max_current, "amps", 1, 26),
	FIELD_EDITABLE_UINT("Lo cut-off", &ui_vars.ui16_battery_low_voltage_cut_off_x10, "volts", 160, 630, .div_digits = 1),
	FIELD_EDITABLE_UINT("Voltag cal", &ui_vars.ui16_battery_voltage_calibrate_percent_x10, "volts", 950, 1050, .div_digits = 1),
	FIELD_EDITABLE_UINT("Resistance", &ui_vars.ui16_battery_pack_resistance_x1000, "mohm", 0, 1000),
	FIELD_READONLY_UINT("Voltag est", &ui_vars.ui16_battery_voltage_soc_x10, "volts", false, .div_digits = 1),
	FIELD_READONLY_UINT("Resist est", &ui_vars.ui16_battery_pack_resistance_estimated_x1000, "mohm", 0, 1000),
	FIELD_READONLY_UINT("Power loss", &ui_vars.ui16_battery_power_loss, "watts", false, .div_digits = 0),
	FIELD_EDITABLE_UINT("Charge cycl", &ui_vars.ui16_battery_charge_cycles_x10, "", 0, UINT16_MAX, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationChargeCycles),
#endif
	FIELD_END };

#ifndef SW102
static Field themeMenus[] =
{
	FIELD_EDITABLE_ENUM("Theme", &ui_vars.ui8_active_theme_index, "OSF Modern"),
	/* Option order/count must match MiniCardOption[] (theme_osf_modern.c) -
	 * the index picked here is used directly as that array's index. */
	FIELD_EDITABLE_ENUM("Mini-Card 1", &ui_vars.ui8_mini_card_1_field, "Cadence", "Trip", "Avg Speed", "Batt Voltage", "Batt Current", "Motor Current", "Motor Speed"),
	FIELD_EDITABLE_ENUM("Mini-Card 2", &ui_vars.ui8_mini_card_2_field, "Cadence", "Trip", "Avg Speed", "Batt Voltage", "Batt Current", "Motor Current", "Motor Speed"),
	/* Only one real option for now - the field exists so the main screen's
	 * mini-graph source is a real rider-visible setting (not silently fixed
	 * to speed) and a second option can be added later without another
	 * EEPROM version bump. */
	FIELD_EDITABLE_ENUM("Mini-Graph", &ui_vars.ui8_mini_graph_field, "Speed/Avg Speed"),
	/* Picks which of PWR's 2 full-screen graph pages (dashboard_theme.c's
	 * g_graph_screen_slot 0/1) shows what - unlike the mini-card/mini-graph
	 * fields above, these bind directly to the real, already-EEPROM-persisted
	 * ui_vars.graphs_field_selectors[1]/[2] (mainscreen.c's graph2/graph3,
	 * the same selector mainscreen-850.c's own stock UI would use for these
	 * pages if it had a way to edit it) rather than a new dedicated field -
	 * no new EEPROM storage needed. Option order/count must match graph2's/
	 * graph3's own FIELD_CUSTOMIZABLE choices list (mainscreen.c) exactly -
	 * the index picked here is used directly as that list's index. Defaults
	 * (eeprom.c's m_eeprom_data_defaults) are Wh/km and Motor Power, matching
	 * this fork's pre-existing factory graph pages. */
	FIELD_EDITABLE_ENUM("Graph Page 1", &ui_vars.graphs_field_selectors[1], "Speed", "Efficiency", "Cadence", "Human Power", "Motor Power", "Wh/km", "Batt Voltage", "Batt Current", "Motor Current", "Batt SOC", "Motor Temp", "Motor Speed", "PWM Duty", "Motor FOC"),
	FIELD_EDITABLE_ENUM("Graph Page 2", &ui_vars.graphs_field_selectors[2], "Speed", "Efficiency", "Cadence", "Human Power", "Motor Power", "Wh/km", "Batt Voltage", "Batt Current", "Motor Current", "Batt SOC", "Motor Temp", "Motor Speed", "PWM Duty", "Motor FOC"),
	/* Option order/count must match HUMAN_POWER_BAR_SCALE[]/
	 * MOTOR_POWER_BAR_SCALE[] (theme_osf_modern.c) exactly - the index
	 * picked here is used directly as that table's index. A plain
	 * multiplier scales only the side power bar's fill percentage, never
	 * the watts number shown below it - lets a lower-power rider/motor
	 * still visually reach the top of the bar instead of it reading as
	 * permanently half-empty. "Disable bars" hides just the bar; "Disable
	 * all" hides the bar and its watts number both. Motor's own list adds
	 * 0.1x-0.9x (scaling down) for motors that can output well past a
	 * typical configured max. */
	FIELD_EDITABLE_ENUM("Human power bar scaling", &ui_vars.ui8_human_power_bar_scale, "1x", "1.1x", "1.2x", "1.3x", "1.4x", "1.5x", "1.6x", "1.7x", "1.8x", "1.9x", "2x", "3x", "4x", "5x", "Disable all", "Disable bars"),
	FIELD_EDITABLE_ENUM("Motor power bar scaling", &ui_vars.ui8_motor_power_bar_scale, "0.1x", "0.2x", "0.3x", "0.4x", "0.5x", "0.6x", "0.7x", "0.8x", "0.9x", "1x", "1.1x", "1.2x", "1.3x", "1.4x", "1.5x", "1.6x", "1.7x", "1.8x", "1.9x", "2x", "3x", "4x", "5x", "Disable all", "Disable bars"),
	FIELD_END };
#endif

#ifndef SW102
static Field torqueSensorMenus[] =
{
	FIELD_EDITABLE_ENUM("Calibration", &ui_vars.ui8_torque_sensor_calibration_feature_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("Weight on pedal", &ui_vars.ui8_weight_on_pedal, "kg", 20, 80),
	FIELD_EDITABLE_UINT("Torque adc offset", &ui_vars.ui16_adc_pedal_torque_offset, "", 0, 300),
	FIELD_EDITABLE_UINT("Torque adc max", &ui_vars.ui16_adc_pedal_torque_max, "", 0, 500),
	FIELD_EDITABLE_UINT("Torque adc on weight", &ui_vars.ui16_adc_pedal_torque_with_weight, "", 100, 500),
	FIELD_EDITABLE_ENUM("Default weight", &ui8_g_configuration_set_default_weight, "no", "yes"),
	FIELD_READONLY_UINT("ADC torque step calc", &ui_vars.ui8_pedal_torque_ADC_step_calc_x100, ""),
	FIELD_READONLY_UINT("Torque adc step", &ui_vars.ui8_pedal_torque_per_10_bit_ADC_step_x100, ""),
	FIELD_READONLY_UINT("Torque adc step adv", &ui_vars.ui8_pedal_torque_per_10_bit_ADC_step_adv_x100, ""),
	FIELD_READONLY_UINT("Torque offset adj", &ui_vars.ui8_adc_pedal_torque_offset_adj, ""),
	FIELD_READONLY_UINT("Torque range adj", &ui_vars.ui8_adc_pedal_torque_range_adj, ""),
	FIELD_READONLY_UINT("Torque angle adj", &ui_vars.ui8_adc_pedal_torque_angle_adj_index, ""),
	FIELD_END };
#else
static Field torqueSensorMenus[] =
{
	FIELD_EDITABLE_ENUM("A w/o ped", &ui_vars.ui8_motor_assistance_startup_without_pedal_rotation, "disable", "enable"),
	FIELD_EDITABLE_UINT("Torque thr", &ui_vars.ui8_torque_sensor_adc_threshold, "", 1, 100),
	FIELD_EDITABLE_ENUM("Coast brk", &ui_vars.ui8_coast_brake_enable, "disable", "enable"),
	FIELD_EDITABLE_UINT("Coast ADC", &ui_vars.ui8_coast_brake_adc, "", 5, 50),
	FIELD_END };
	
static Field torqueCalibrationMenus[] =
{
	FIELD_EDITABLE_ENUM("Calibrat", &ui_vars.ui8_torque_sensor_calibration_feature_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("ADC step", &ui_vars.ui8_pedal_torque_per_10_bit_ADC_step_x100, "", 20, 120),      
	FIELD_EDITABLE_UINT("ADC s adv", &ui_vars.ui8_pedal_torque_per_10_bit_ADC_step_adv_x100, "", 20, 50),
	FIELD_EDITABLE_UINT("OffsetAdj", &ui_vars.ui8_adc_pedal_torque_offset_adj, "", 0, 34, .div_digits = 0),
	FIELD_EDITABLE_UINT("RangeAdj", &ui_vars.ui8_adc_pedal_torque_range_adj, "", 0, 40, .div_digits = 0),
	FIELD_EDITABLE_UINT("AngleAdj", &ui_vars.ui8_adc_pedal_torque_angle_adj_index, "", 0, 40, .div_digits = 0),
	FIELD_EDITABLE_UINT("ADCoffset", &ui_vars.ui16_adc_pedal_torque_offset, "", 0, 300),
	FIELD_EDITABLE_UINT("ADC max", &ui_vars.ui16_adc_pedal_torque_max, "", 0, 500),
	FIELD_EDITABLE_UINT("Weight", &ui_vars.ui8_weight_on_pedal, "kg", 20, 80),
	FIELD_EDITABLE_UINT("ADC weight", &ui_vars.ui16_adc_pedal_torque_with_weight, "", 100, 500),
	FIELD_READONLY_UINT("ADC step c", &ui_vars.ui8_pedal_torque_ADC_step_calc_x100, ""),
	FIELD_EDITABLE_ENUM("Set weight", &ui8_g_configuration_set_default_weight, "no", "yes"),
	FIELD_END };
#endif

static Field motorTempMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_UINT("Temp. min warn offset", &ui_vars.ui8_temp_min_warn_offset, "C", -50, 0, .is_signed = true),
	FIELD_READONLY_UINT("Temp. min limit", &ui_vars.ui8_motor_temperature_min_limit_value, "C"),
	FIELD_READONLY_UINT("Temp. max limit", &ui_vars.ui8_motor_temperature_max_limit_value, "C"),
	FIELD_EDITABLE_ENUM("Display Temp Icon", &ui_vars.ui8_display_temp_icon_enabled, "no", "yes"),
	FIELD_EDITABLE_ENUM("Display Temp Value", &ui_vars.ui8_display_temp_value_enabled, "no", "yes"),
	FIELD_EDITABLE_ENUM("Units", &ui_vars.ui8_screen_temperature, "auto", "celsius", "farenheit"),
#else
	FIELD_EDITABLE_ENUM("Feature", &ui_vars.ui8_optional_ADC_function, "disable", "temperature", "throttle"),
	FIELD_EDITABLE_UINT("Min limit", &ui_vars.ui8_throttle_or_temperature_min_value_to_limit, "C", 0, 255),
	FIELD_EDITABLE_UINT("Max limit", &ui_vars.ui8_throttle_or_temperature_max_value_to_limit, "C", 0, 255),
	FIELD_EDITABLE_ENUM("Units", &ui_vars.ui8_screen_temperature, "auto", "celsius", "farenheit"),
	FIELD_EDITABLE_ENUM("Sens type", &ui_vars.ui8_temperature_sensor_type, "LM35", "TMP36"),
	FIELD_EDITABLE_ENUM("Brake", &ui_vars.ui8_brake_input, "brake", "temperature"),
    FIELD_EDITABLE_UINT("V thr step", &ui_vars.ui8_throttle_virtual_step, "", 1, 100),
#endif
	FIELD_END };

static Field displayMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_ENUM("Clock field", &ui_vars.ui8_time_field_enable, "disable", "clock", "batt volts"),
	FIELD_EDITABLE_UINT("Clock hours", &ui8_g_configuration_clock_hours, "", 0, 23, .onSetEditable = onSetConfigurationClockHours),
	FIELD_EDITABLE_UINT("Clock minutes", &ui8_g_configuration_clock_minutes, "", 0, 59, .onSetEditable = onSetConfigurationClockMinutes),
	FIELD_EDITABLE_ENUM("Battery field", &ui_vars.ui8_battery_field_enable, "percentage", "disabled", "battery voltage"),
	FIELD_EDITABLE_UINT("Brightness (lights on)", &ui_vars.ui8_lcd_backlight_on_brightness, "", 5, 100, .inc_step = 5, .onSetEditable = onSetConfigurationDisplayLcdBacklightOnBrightness),
	FIELD_EDITABLE_UINT("Brightness (lights off)", &ui_vars.ui8_lcd_backlight_off_brightness, "", 5, 100, .inc_step = 5, .onSetEditable = onSetConfigurationDisplayLcdBacklightOffBrightness),
	FIELD_EDITABLE_ENUM("Buttons invert", &ui_vars.ui8_buttons_up_down_invert, "default", "invert"),
	FIELD_EDITABLE_UINT("Auto power off", &ui_vars.ui8_lcd_power_off_time_minutes, "mins", 0, 255),
	FIELD_EDITABLE_ENUM("Units", &ui_vars.ui8_units_type, "SI", "Imperial"),
	FIELD_EDITABLE_ENUM("Reset to defaults", &ui8_g_configuration_display_reset_to_defaults, "no", "yes"),
	FIELD_EDITABLE_ENUM("Confirm reset", &ui_vars.ui8_confirm_default_reset, "no", "yes"),
#else
	FIELD_EDITABLE_UINT("Auto p off", &ui_vars.ui8_lcd_power_off_time_minutes, "mins", 0, 255),
	FIELD_EDITABLE_ENUM("Units", &ui_vars.ui8_units_type, "SI", "Imperial"),
	FIELD_EDITABLE_ENUM("Reset BLE", &ui8_g_configuration_display_reset_bluetooth_peers, "no", "yes"),
	FIELD_EDITABLE_ENUM("Reset def", &ui8_g_configuration_display_reset_to_defaults, "no", "yes"),
	FIELD_EDITABLE_ENUM("Confirm", &ui_vars.ui8_confirm_default_reset, "no", "yes"),
	FIELD_READONLY_UINT("Mot v20.1C", &g_tsdz2_firmware_version.patch, "", false, .div_digits = 1),
#endif
	FIELD_END };

static Field technicalMenus[] =
{
#ifndef SW102
	FIELD_READONLY_STRING("Motor firmware", g_motor_firmware_version_str),
	FIELD_READONLY_STRING("Display firmware", g_display_firmware_version_str),
	FIELD_READONLY_UINT("Max motor power", &ui_vars.ui16_max_motor_power, "watts", false, .div_digits = 0),
	FIELD_READONLY_UINT("PWM frequency", &ui_vars.ui8_pwm_frequency, "kHz", false, .div_digits = 0),
	FIELD_READONLY_UINT("ADC battery current", &ui_vars.ui16_adc_battery_current, ""),
	FIELD_READONLY_UINT("ADC throttle sensor", &ui_vars.ui8_adc_throttle, ""),
	FIELD_READONLY_UINT("Throttle sensor", &ui_vars.ui8_throttle_adc_map, ""),
	FIELD_READONLY_UINT("ADC torque sensor", &ui_vars.ui16_adc_pedal_torque_sensor, ""),
	FIELD_READONLY_UINT("ADC torque delta", &ui_vars.ui16_adc_pedal_torque_delta, ""),
	FIELD_READONLY_UINT("ADC torque boost", &ui_vars.ui16_adc_pedal_torque_delta_boost, ""),
	FIELD_READONLY_UINT("Pedal cadence", &ui_vars.ui8_pedal_cadence, "rpm"),
	FIELD_READONLY_UINT("PWM duty-cycle", &ui_vars.ui8_duty_cycle, ""),
	FIELD_READONLY_UINT("Motor speed", &ui_vars.ui16_motor_speed_erps, ""),
	FIELD_READONLY_UINT("Motor FOC", &ui_vars.ui8_foc_angle, ""),
	FIELD_READONLY_UINT("Hall sensors", &ui_vars.ui8_motor_hall_sensors, ""),
#else
	FIELD_READONLY_UINT("ADC bat cu", &ui_vars.ui16_adc_battery_current, ""),
	FIELD_READONLY_UINT("ADC thrott", &ui_vars.ui8_adc_throttle, ""),
	FIELD_READONLY_UINT("Throttle s", &ui_vars.ui8_throttle_adc_map, ""),
	FIELD_READONLY_UINT("ADC torque", &ui_vars.ui16_adc_pedal_torque_sensor, ""),
	FIELD_READONLY_UINT("ADC delta", &ui_vars.ui16_adc_pedal_torque_delta, ""),
	FIELD_READONLY_UINT("ADC boost", &ui_vars.ui16_adc_pedal_torque_delta_boost, ""),
	FIELD_READONLY_UINT("Cadence", &ui_vars.ui8_pedal_cadence, "rpm"),
	FIELD_READONLY_UINT("PWM duty", &ui_vars.ui8_duty_cycle, ""),
	FIELD_READONLY_UINT("Mot speed", &ui_vars.ui16_motor_speed_erps, ""),
	FIELD_READONLY_UINT("Motor FOC", &ui_vars.ui8_foc_angle, ""),
	FIELD_READONLY_UINT("Hall sens", &ui_vars.ui8_motor_hall_sensors, ""),
#endif
	FIELD_END };

#ifdef SW102
/* These menus are only reached by the SW102 branch of topMenus below - they
 * were cut from the 860C/850C tree but remain compiled for SW102, whose own
 * top-level menu still references them. */
static Field batterySOCMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_ENUM("Text 1", &ui_vars.ui8_battery_soc_enable_array[0], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Text 2", &ui_vars.ui8_battery_soc_enable_array[1], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Text 3", &ui_vars.ui8_battery_soc_enable_array[2], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Calculation", &ui_vars.ui8_battery_soc_percent_calculation, "auto", "Wh", "volts"),
	FIELD_EDITABLE_UINT("Reset at voltage", &ui_vars.ui16_battery_voltage_reset_wh_counter_x10, "volts", 160, 680, .div_digits = 1),
	FIELD_EDITABLE_UINT("Battery total Wh", &ui_vars.ui32_wh_x10_100_percent, "whr", 0, 29990, .div_digits = 1, .inc_step = 100),
	FIELD_EDITABLE_UINT("Used Wh", &ui_vars.ui32_wh_x10, "whr", 0, 99900, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationBatterySOCUsedWh),
	FIELD_EDITABLE_ENUM("Manual reset", &ui8_g_configuration_battery_soc_reset, "no", "yes"),
	FIELD_EDITABLE_UINT("Auto reset %", &ui_vars.ui8_battery_soc_auto_reset, "", 0, 100),
	FIELD_EDITABLE_UINT("Distance for avg Wh", &ui_vars.ui8_distance_for_avg_Wh_calc, "km", 10, 250, .div_digits = 1, .inc_step = 10),
	FIELD_EDITABLE_UINT("Percentage of avg Wh", &ui_vars.ui8_Wh_avg_percentage, "", 0, 100),
	FIELD_EDITABLE_UINT("Wh/unit distance", &ui_vars.ui16_Wh_for_unit_distance, "Wh/km", 100, 2000, .div_digits = 2, .inc_step = 10),
#else
	FIELD_EDITABLE_ENUM("Text 1", &ui_vars.ui8_battery_soc_enable_array[0], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Text 2", &ui_vars.ui8_battery_soc_enable_array[1], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Text 3", &ui_vars.ui8_battery_soc_enable_array[2], "disable", "SOC %", "volts", "distance"),
	FIELD_EDITABLE_ENUM("Calculation", &ui_vars.ui8_battery_soc_percent_calculation, "auto", "Wh", "volts"),
	FIELD_EDITABLE_UINT("Reset at", &ui_vars.ui16_battery_voltage_reset_wh_counter_x10, "volts", 160, 680, .div_digits = 1),
	FIELD_EDITABLE_UINT("Batt total", &ui_vars.ui32_wh_x10_100_percent, "whr", 0, 29990, .div_digits = 1, .inc_step = 100),
	FIELD_EDITABLE_UINT("Used Wh", &ui_vars.ui32_wh_x10, "whr", 0, 99900, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationBatterySOCUsedWh),
	FIELD_EDITABLE_ENUM("Manual rst", &ui8_g_configuration_battery_soc_reset, "no", "yes"),
	FIELD_EDITABLE_UINT("Auto rst%", &ui_vars.ui8_battery_soc_auto_reset, "", 0, 100),
	FIELD_EDITABLE_UINT("Dist.avgWh", &ui_vars.ui8_distance_for_avg_Wh_calc, "km", 10, 250, .div_digits = 1, .inc_step = 10),
	FIELD_EDITABLE_UINT("% of avgWh", &ui_vars.ui8_Wh_avg_percentage, "", 0, 100),
	FIELD_EDITABLE_UINT("Wh/unitDis", &ui_vars.ui16_Wh_for_unit_distance, "Wh/km", 100, 2000, .div_digits = 2, .inc_step = 10),
#endif
	FIELD_END };

static Field motorMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_ENUM("Motor voltage", &ui_vars.ui8_motor_type, "48V", "36V"),
	FIELD_READONLY_UINT("Max motor power", &ui_vars.ui16_max_motor_power, "watts", false, .div_digits = 0),
	FIELD_EDITABLE_UINT("Motor acceleration", &ui_vars.ui8_motor_acceleration_adjustment, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_UINT("Motor deceleration", &ui_vars.ui8_motor_deceleration_adjustment, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Field weakening", &ui_vars.ui8_field_weakening_feature_enabled, "disable", "enable"),
	FIELD_EDITABLE_ENUM("Overcurrent delay", &ui_vars.ui8_battery_overcurrent_delay, "disable", "1", "2", "3", "4", "5"),
	FIELD_READONLY_UINT("PWM frequency", &ui_vars.ui8_pwm_frequency, "kHz", false, .div_digits = 0),
#else
	FIELD_EDITABLE_ENUM("Motor volt", &ui_vars.ui8_motor_type, "48V", "36V"),
	FIELD_READONLY_UINT("MaxMotorPw", &ui_vars.ui16_max_motor_power, "watts", false, .div_digits = 0),
	FIELD_EDITABLE_UINT("Motor acc", &ui_vars.ui8_motor_acceleration_adjustment, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_UINT("Motor dec", &ui_vars.ui8_motor_deceleration_adjustment, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Field weak", &ui_vars.ui8_field_weakening_feature_enabled, "disable", "enable"),
	FIELD_EDITABLE_ENUM("Overcurren", &ui_vars.ui8_battery_overcurrent_delay, "disable", "1", "2", "3", "4", "5"),
	FIELD_READONLY_UINT("PWM freq", &ui_vars.ui8_pwm_frequency, "kHz", false, .div_digits = 0),
#endif
	FIELD_END };

static Field powerAssistMenus[] =
{
	FIELD_EDITABLE_UINT("Level 1", &ui_vars.ui8_assist_level_factor[POWER_MODE][0], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 2", &ui_vars.ui8_assist_level_factor[POWER_MODE][1], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 3", &ui_vars.ui8_assist_level_factor[POWER_MODE][2], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 4", &ui_vars.ui8_assist_level_factor[POWER_MODE][3], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 5", &ui_vars.ui8_assist_level_factor[POWER_MODE][4], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 6", &ui_vars.ui8_assist_level_factor[POWER_MODE][5], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 7", &ui_vars.ui8_assist_level_factor[POWER_MODE][6], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 8", &ui_vars.ui8_assist_level_factor[POWER_MODE][7], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 9", &ui_vars.ui8_assist_level_factor[POWER_MODE][8], "", 1, 255, .div_digits = 0),
	FIELD_END };
	
static Field torqueAssistMenus[] =
{
	FIELD_EDITABLE_UINT("Level 1", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][0], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 2", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][1], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 3", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][2], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 4", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][3], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 5", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][4], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 6", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][5], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 7", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][6], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 8", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][7], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 9", &ui_vars.ui8_assist_level_factor[TORQUE_MODE][8], "", 1, 255, .div_digits = 0),
	FIELD_END };
	
static Field cadenceAssistMenus[] =
{
	FIELD_EDITABLE_UINT("Level 1", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][0], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 2", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][1], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 3", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][2], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 4", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][3], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 5", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][4], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 6", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][5], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 7", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][6], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 8", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][7], "", 1, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 9", &ui_vars.ui8_assist_level_factor[CADENCE_MODE][8], "", 1, 255, .div_digits = 0),
	FIELD_END };
	
static Field eMTBAssistMenus[] =
{
	FIELD_EDITABLE_ENUM("Based on", &ui_vars.ui8_eMTB_based_on_power, "torque", "power"),
	FIELD_EDITABLE_UINT("Level 1", &ui_vars.ui8_assist_level_factor[eMTB_MODE][0], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 2", &ui_vars.ui8_assist_level_factor[eMTB_MODE][1], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 3", &ui_vars.ui8_assist_level_factor[eMTB_MODE][2], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 4", &ui_vars.ui8_assist_level_factor[eMTB_MODE][3], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 5", &ui_vars.ui8_assist_level_factor[eMTB_MODE][4], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 6", &ui_vars.ui8_assist_level_factor[eMTB_MODE][5], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 7", &ui_vars.ui8_assist_level_factor[eMTB_MODE][6], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 8", &ui_vars.ui8_assist_level_factor[eMTB_MODE][7], "", 21, 255, .div_digits = 0),
	FIELD_EDITABLE_UINT("Level 9", &ui_vars.ui8_assist_level_factor[eMTB_MODE][8], "", 21, 255, .div_digits = 0),
	FIELD_END };

	static Field assistMenus[] =
{
#ifndef SW102
	FIELD_EDITABLE_UINT("Num assist levels", &ui_vars.ui8_number_of_assist_levels, "", 1, 5),
	FIELD_EDITABLE_ENUM("Start assist level", &ui_vars.ui8_startup_assist_level, "last", "1", "2", "3", "4", "5"),
	FIELD_EDITABLE_ENUM("Start riding mode", &ui_vars.ui8_startup_ridimg_mode, "last", "power", "torque", "cadence", "emtb", "hybrid"),
	FIELD_SCROLLABLE("Power assist", powerAssistMenus),
	FIELD_SCROLLABLE("Torque assist", torqueAssistMenus),
	FIELD_SCROLLABLE("Cadence assist", cadenceAssistMenus),
	FIELD_SCROLLABLE("eMTB assist", eMTBAssistMenus),
	FIELD_EDITABLE_ENUM("Torque modes on", &ui_vars.ui8_torque_modes_based_on_power, "current", "power"),
	FIELD_EDITABLE_UINT("Ref.voltage", &ui_vars.ui8_power_based_reference_voltage, "volts", 24, 54, .div_digits = 0),
#else
	FIELD_EDITABLE_UINT("Num Levels", &ui_vars.ui8_number_of_assist_levels, "", 1, 5),
	FIELD_EDITABLE_ENUM("StartLevel", &ui_vars.ui8_startup_assist_level, "last", "1", "2", "3", "4", "5"),
	FIELD_EDITABLE_ENUM("Start mode", &ui_vars.ui8_startup_ridimg_mode, "last", "power", "torque", "cadence", "emtb", "hybrid"),
	FIELD_SCROLLABLE("Power", powerAssistMenus),
	FIELD_SCROLLABLE("Torque", torqueAssistMenus),
	FIELD_SCROLLABLE("Cadence", cadenceAssistMenus),
	FIELD_SCROLLABLE("eMTB", eMTBAssistMenus),
	FIELD_EDITABLE_ENUM("TorqueMods", &ui_vars.ui8_torque_modes_based_on_power, "current", "power"),
	FIELD_EDITABLE_UINT("Ref.voltag", &ui_vars.ui8_power_based_reference_voltage, "volts", 24, 54, .div_digits = 0),
#endif
	FIELD_END };
	
static Field walkAssistMenus[] =
{
	FIELD_EDITABLE_ENUM("Feature", &ui_vars.ui8_walk_assist_feature_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("Speed 1", &ui_vars.ui8_walk_assist_level_factor[0], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 2", &ui_vars.ui8_walk_assist_level_factor[1], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 3", &ui_vars.ui8_walk_assist_level_factor[2], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 4", &ui_vars.ui8_walk_assist_level_factor[3], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 5", &ui_vars.ui8_walk_assist_level_factor[4], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 6", &ui_vars.ui8_walk_assist_level_factor[5], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 7", &ui_vars.ui8_walk_assist_level_factor[6], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 8", &ui_vars.ui8_walk_assist_level_factor[7], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_EDITABLE_UINT("Speed 9", &ui_vars.ui8_walk_assist_level_factor[8], "kph", 0, 60, .div_digits = 1, .inc_step = 1),
	FIELD_END };

static Field startupPowerMenus[] =
{
	FIELD_EDITABLE_ENUM("Feature", &ui_vars.ui8_startup_motor_power_boost_feature_enabled, "disable", "enable"), // FIXME, share one array of disable/enable strings
#ifndef SW102
	FIELD_EDITABLE_UINT("Boost torque factor", &ui_vars.ui16_startup_boost_torque_factor, "%", 1, 500, .div_digits = 0),
	FIELD_EDITABLE_UINT("Boost cadence step", &ui_vars.ui8_startup_boost_cadence_step, "", 10, 50, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Boost at zero", &ui_vars.ui8_startup_boost_at_zero, "cadence", "speed", "auto"),
	FIELD_EDITABLE_ENUM("Startup assist", &ui_vars.ui8_startup_assist_feature_enabled, "disable", "manual", "semi-aut", "auto", "extended"),
	FIELD_EDITABLE_UINT("Startup assist time", &ui_vars.ui8_auto_startup_assist_time, "sec", 1, 50, .div_digits = 1),
	FIELD_EDITABLE_UINT("Auto start.timeout", &ui_vars.ui8_auto_startup_assist_timeout, "sec", 1, 20, .div_digits = 1),
	FIELD_EDITABLE_UINT("Auto start.threshold", &ui_vars.ui8_auto_startup_assist_threshold, "", 8, 20, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Smooth start", &ui_vars.ui8_smooth_start_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("Smooth start ramp", &ui_vars.ui8_smooth_start_counter_set, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Extended boost", &ui_vars.ui8_extended_boost_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("Extended boost mul", &ui_vars.ui8_extended_boost_multiplier, "", 1, 5, .div_digits = 0),
	FIELD_EDITABLE_UINT("Ext.boost ramp down", &ui_vars.ui8_extended_boost_ramp_down, "", 1, 5, .div_digits = 0),
	FIELD_EDITABLE_UINT("Ext.boost threshold", &ui_vars.ui8_extended_boost_threshold, "", 1, 20, .div_digits = 0),
#else
	FIELD_EDITABLE_UINT("Boost fact", &ui_vars.ui16_startup_boost_torque_factor, "%", 1, 500, .div_digits = 0),
	FIELD_EDITABLE_UINT("Boost step", &ui_vars.ui8_startup_boost_cadence_step, "", 10, 50, .div_digits = 0),
	FIELD_EDITABLE_ENUM("Boost zero", &ui_vars.ui8_startup_boost_at_zero, "cadence", "speed", "auto"),
	FIELD_EDITABLE_ENUM("StartupAss", &ui_vars.ui8_startup_assist_feature_enabled, "disable", "manual", "semi-aut", "auto", "extended"),
	FIELD_EDITABLE_UINT("StartupTim", &ui_vars.ui8_auto_startup_assist_time, "sec", 1, 50, .div_digits = 1),
	FIELD_EDITABLE_UINT("AutoTimeou", &ui_vars.ui8_auto_startup_assist_timeout, "sec", 1, 20, .div_digits = 1),
	FIELD_EDITABLE_UINT("AutoThresh", &ui_vars.ui8_auto_startup_assist_threshold, "", 8, 15, .div_digits = 0),
	FIELD_EDITABLE_ENUM("SmoothStar", &ui_vars.ui8_smooth_start_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("SmoothRamp", &ui_vars.ui8_smooth_start_counter_set, "%", 0, 100, .div_digits = 0),
	FIELD_EDITABLE_ENUM("ExtBoost", &ui_vars.ui8_extended_boost_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("ExtBstMul", &ui_vars.ui8_extended_boost_multiplier, "", 1, 5, .div_digits = 0),
	FIELD_EDITABLE_UINT("ExtBstRmp", &ui_vars.ui8_extended_boost_ramp_down, "", 1, 5, .div_digits = 0),
	FIELD_EDITABLE_UINT("ExtBstThr", &ui_vars.ui8_extended_boost_threshold, "", 1, 20, .div_digits = 0),
#endif
	FIELD_END };

static Field variousMenus[] =
{
	FIELD_SCROLLABLE("History errors", errorsMenus),
	FIELD_EDITABLE_ENUM("Lights", &ui_vars.ui8_lights_enabled, "disable", "enable"),
#if defined(DISPLAY_860C) || defined(DISPLAY_860C_V12) || defined(DISPLAY_860C_V13)
	FIELD_EDITABLE_ENUM("Light sensor", &ui_vars.ui8_light_sensor_enabled, "disable", "enable"),
	FIELD_EDITABLE_UINT("Light sensitivity %", &ui_vars.ui8_light_sensor_sensitivity, "", 1, 100),
	FIELD_EDITABLE_UINT("Light hysteresis %", &ui_vars.ui8_light_sensor_hysteresis, "", 1, 20),
#endif
#ifndef SW102
	FIELD_EDITABLE_UINT("Lights configuration", &ui_vars.ui8_lights_configuration, "", 0, 8),
    FIELD_EDITABLE_UINT("Odometer", &ui_vars.ui32_odometer_x10, "km", 0, UINT32_MAX, .div_digits = 1, .inc_step = 10, .onSetEditable = onSetConfigurationWheelOdometer),
	FIELD_EDITABLE_ENUM("A service", &ui_vars.ui8_service_a_distance_enable, "disabled", "chain", "brakes", "shocks", "other"),
	FIELD_EDITABLE_UINT("A service distance", &ui_vars.ui16_service_a_distance, "km", 0, 10000, .div_digits = 0, .inc_step = 10, .onSetEditable = onSetConfigurationServiceDistanceA),
	FIELD_EDITABLE_ENUM("B service", &ui_vars.ui8_service_b_distance_enable, "disabled", "chain", "brakes", "shocks", "other"),
	FIELD_EDITABLE_UINT("B service distance", &ui_vars.ui16_service_b_distance, "km", 0, 10000, .div_digits = 0, .inc_step = 10, .onSetEditable = onSetConfigurationServiceDistanceB),
#else
	FIELD_EDITABLE_UINT("Light conf", &ui_vars.ui8_lights_configuration, "", 0, 8),
    FIELD_EDITABLE_UINT("Odometer", &ui_vars.ui32_odometer_x10, "km", 0, UINT32_MAX, .div_digits = 1, .inc_step = 100, .onSetEditable = onSetConfigurationWheelOdometer),
#endif
	FIELD_END };
#endif /* SW102 */

static Field topMenus[] =
{
#ifndef SW102
	FIELD_SCROLLABLE("Trip memories", tripMenus),
	FIELD_SCROLLABLE("Bike", bikeMenus),
	FIELD_SCROLLABLE("Battery", batteryMenus),
	FIELD_SCROLLABLE("Display", displayMenus),
	FIELD_SCROLLABLE("Theme", themeMenus),
	FIELD_SCROLLABLE("Torque sensor", torqueSensorMenus),
	FIELD_SCROLLABLE("Temperature", motorTempMenus),
	FIELD_SCROLLABLE("Technical", technicalMenus),
#else
	FIELD_SCROLLABLE("Trip memories", tripMenus),
	FIELD_SCROLLABLE("Bike", bikeMenus),
	FIELD_SCROLLABLE("Battery", batteryMenus),
	FIELD_SCROLLABLE("SOC", batterySOCMenus),
	FIELD_SCROLLABLE("Motor", motorMenus),
	FIELD_SCROLLABLE("Torque sen", torqueSensorMenus),
	FIELD_SCROLLABLE("Torque cal", torqueCalibrationMenus),
	FIELD_SCROLLABLE("Assist", assistMenus),
	FIELD_SCROLLABLE("Walk", walkAssistMenus),
	FIELD_SCROLLABLE("StartBOOST", startupPowerMenus),
	FIELD_SCROLLABLE("Throt/Temp", motorTempMenus),
	//FIELD_SCROLLABLE("Street mod", streetModeMenus),
	FIELD_SCROLLABLE("Various", variousMenus),
	FIELD_SCROLLABLE("Display", displayMenus),
	FIELD_SCROLLABLE("Technical", technicalMenus),
#endif
	FIELD_END };

#ifndef SW102
static Field configRoot = FIELD_SCROLLABLE("Configurations", topMenus);
#else
static Field configRoot = FIELD_SCROLLABLE("Config", topMenus);
#endif

uint8_t ui8_g_configuration_display_reset_to_defaults = 0;
uint32_t ui32_g_configuration_wh_100_percent = 0;
uint8_t ui8_g_configuration_display_reset_bluetooth_peers = 0;
uint8_t ui8_g_configuration_trip_a_reset = 0;
uint8_t ui8_g_configuration_trip_b_reset = 0;
uint8_t ui8_g_configuration_battery_soc_reset = 0;
uint8_t ui8_g_configuration_set_default_weight = 0;

static void configScreenRefreshDynamicStrings() {
	snprintf(g_motor_firmware_version_str, sizeof(g_motor_firmware_version_str), "%u.%u.%u",
		g_tsdz2_firmware_version.major, g_tsdz2_firmware_version.minor, g_tsdz2_firmware_version.patch);

	uint32_t t = ui_vars.ui32_trip_a_time % 86400; // 86400 = seconds in one day minus 1s
	uint8_t hours = t / 3600;
	uint8_t minutes = (t % 3600) / 60;
	uint8_t seconds = t % 60;
	if (hours > 0)
		snprintf(g_trip_time_str, sizeof(g_trip_time_str), "%u:%02u", hours, minutes);
	else
		snprintf(g_trip_time_str, sizeof(g_trip_time_str), "%u:%02u", minutes, seconds);

	for (uint8_t i = 0; i < 4; i++)
		snprintf(g_last_error_str[i], sizeof(g_last_error_str[i]), "%s", motor_error_text(ui_vars.ui8_last_error[i]));
}

static void configScreenOnEnter() {
	// Set the font preference for this screen
	editable_label_font = &CONFIGURATIONS_TEXT_FONT;
	editable_value_font = &CONFIGURATIONS_TEXT_FONT;
	editable_units_font = &CONFIGURATIONS_TEXT_FONT;

	// Refresh read-only string fields that depend on live values (motor
	// firmware version is fixed post-boot, trip time accrues while riding).
	configScreenRefreshDynamicStrings();
}

static void configExit() {
	prepare_torque_sensor_calibration_table();

	// save the variables on EEPROM
	eeprom_write_variables();
	set_conversions(); // we just changed units

	update_battery_power_usage_label();

	// send the configurations to TSDZ2
  if (g_motor_init_state == MOTOR_INIT_READY)
    g_motor_init_state = MOTOR_INIT_SET_CONFIGURATIONS;
}

static void configPreUpdate() {
	set_conversions(); // while in the config menu we might change units at any time - keep the display looking correct
}

//
// Screens
//
Screen configScreen = {
    .onExit = configExit,
    .onEnter = configScreenOnEnter,
    .onPreUpdate = configPreUpdate,

.fields = {
		{ .color = ColorNormal, .field = &configRoot },
		{ .field = NULL } } };

/*
 * TongSheng TSDZ2 motor controller firmware/
 *
 * Copyright (C) Casainho and Leon, 2019.
 *
 * Released under the GPL License, Version 3
 */

#ifndef EEPROM_H_
#define EEPROM_H_

#include "main.h"

#define EEPROM_BASE_ADDRESS                                 0x4000

#define ADDRESS_KEY                                     0 + EEPROM_BASE_ADDRESS
#define ADDRESS_BATTERY_CURRENT_MAX                     1 + EEPROM_BASE_ADDRESS
#define ADDRESS_BATTERY_LOW_VOLTAGE_CUT_OFF_X10_0       2 + EEPROM_BASE_ADDRESS
#define ADDRESS_BATTERY_LOW_VOLTAGE_CUT_OFF_X10_1       3 + EEPROM_BASE_ADDRESS
#define ADDRESS_WHEEL_PERIMETER_0                       4 + EEPROM_BASE_ADDRESS
#define ADDRESS_WHEEL_PERIMETER_1                       5 + EEPROM_BASE_ADDRESS
// for oem display
#define ADDRESS_STARTUP_ASSIST_ENABLED					EEPROM_BASE_ADDRESS + 6
#define ADDRESS_TORQUE_SENSOR_ESTIMATED					EEPROM_BASE_ADDRESS + 7
#define ADDRESS_PEDAL_TORQUE_PER_10_BIT_ADC_STEP_X100	EEPROM_BASE_ADDRESS + 8
#define ADDRESS_MOTOR_ASSISTANCE_WITHOUT_PEDAL_ROTATION EEPROM_BASE_ADDRESS + 9
#define ADDRESS_MOTOR_ASSISTANCE_WITH_ERROR_ENABLED		EEPROM_BASE_ADDRESS + 10
#define ADDRESS_BATTERY_SOC								EEPROM_BASE_ADDRESS + 11																
#define ADDRESS_SET_PARAMETER_ON_STARTUP				EEPROM_BASE_ADDRESS + 12
#define ADDRESS_STREET_MODE_ON_STARTUP					EEPROM_BASE_ADDRESS + 13
#define ADDRESS_RIDING_MODE_ON_STARTUP					EEPROM_BASE_ADDRESS + 14
#define ADDRESS_LIGHTS_CONFIGURATION_ON_STARTUP			EEPROM_BASE_ADDRESS + 15
#define ADDRESS_STARTUP_BOOST_ON_STARTUP				EEPROM_BASE_ADDRESS + 16
#define ADDRESS_ENABLE_AUTO_DATA_DISPLAY				EEPROM_BASE_ADDRESS + 17
#define ADDRESS_SOC_PERCENT_CALC						EEPROM_BASE_ADDRESS + 18
#define ADDRESS_TORQUE_SENSOR_ADV_ON_STARTUP			EEPROM_BASE_ADDRESS + 19
#define EEPROM_BYTES_STORED                             20
#define EEPROM_BYTES_STORED_OEM_DISPLAY					13
#define EEPROM_BYTES_INIT_OEM_DISPLAY					EEPROM_BYTES_STORED - EEPROM_BYTES_STORED_OEM_DISPLAY


// system
// EEPROM_init() (eeprom.c) only ever compares the stored key byte against
// this value - a match is trusted as "already initialized, read it as-is",
// a mismatch reseeds everything from ui8_default_array/config.h, same as a
// genuinely blank chip. 204 alone is the original casainho/Leon stock key,
// which this fork inherited but never bumped itself - meaning ANY two builds
// that both ever wrote a real key (DZ40 protocol, 860C protocol, before/after
// an EEPROM-backed field's meaning changed) look identically "valid" to each
// other, even when what they stored means something different. Real-hardware
// bring-up 2026-08-24 hit exactly this: 860C-protocol EEPROM state silently
// surviving into a DZ40 boot, with no crash or error - just wrong behavior.
//
// EEPROM_LAYOUT_VERSION is this fork's own guard on top of that: bump it by
// hand whenever a change could alter what the stored bytes mean (reordering/
// reinterpreting ui8_default_array, or changing how a compile-time flag like
// ENABLE_860C_LVGL_UART affects an EEPROM-backed field's meaning) - NOT on
// every ordinary settings change (wheel size, current limits, etc. - those
// are supposed to persist across reflashes). Deliberately manual rather than
// auto-derived from config.h, to avoid wiping calibration data on benign
// changes - see UNIVERSAL_FIRMWARE_PLAN.md and this fork's stance against
// EEPROM migration complexity (no installed base to migrate; wipe-clean on
// any real mismatch is the whole policy).
#define EEPROM_LAYOUT_VERSION  1
#define DEFAULT_VALUE_KEY      (204 + EEPROM_LAYOUT_VERSION)
#define SET_TO_DEFAULT        0
#define READ_FROM_MEMORY      1
#define WRITE_TO_MEMORY       2


void EEPROM_init(void);

void EEPROM_controller(uint8_t ui8_operation, uint8_t ui8_byte_init);

#endif /* EEPROM_H_ */

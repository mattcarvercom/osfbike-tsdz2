#pragma once

#include "screen.h"

// Error state
#define NO_ERROR                                0	// "None"
#define ERROR_NOT_INIT                          1	// "Motor not init"
#define ERROR_TORQUE_SENSOR                     2	// "Torque Fault"
#define ERROR_CADENCE_SENSOR		    		3	// "Cadence fault"
#define ERROR_MOTOR_BLOCKED     				4	// "Motor Blocked"
#define ERROR_THROTTLE						 	5	// "Throttle Fault"
#define ERROR_FATAL                             6	// "Fatal error" or  "Undervoltage"
#define ERROR_BATTERY_OVERCURRENT               7	// "Overcurrent"
#define ERROR_SPEED_SENSOR	                    8	// "Speed fault"
#define ERROR_UNDERVOLTAGE						9   // "Undervoltage"

// TSDZ2 20.1
#define WALK_ASSIST_THRESHOLD_SPEED_X10			70  // 70 -> 7.0 km/h
#define CRUISE_THRESHOLD_SPEED_X10				90  // 90 -> 9.0 km/h
#define WARNING_MESSAGE_MIN_TIME				30  // x0.1 sec
#define LOW_EFFICIENCY_MIN_TIME					120  // x0.1 sec

extern volatile uint8_t ui8_battery_soc_used[100];
extern volatile uint8_t ui8_battery_soc_index;
extern volatile uint8_t ui8_waiting_voltage_ready_counter;
extern volatile uint8_t ui8_motorErrorsIndex;
extern volatile uint8_t ui8_startup_assist_speed_limit;

#ifndef SW102
// for calculate Wh trip A and B
extern uint32_t ui32_wh_x10_reset_trip_a;
extern uint32_t ui32_wh_x10_reset_trip_b;
extern uint32_t ui32_wh_x10_since_power_on;
extern uint32_t ui32_trip_a_wh_km_value_x100;
extern uint32_t ui32_trip_b_wh_km_value_x100;
#endif

// common
extern Screen mainScreen1, mainScreen2, bootScreen;
extern Screen *screens[];
extern Field
  socField,
  timeField,
  assistLevelField,
  wheelSpeedIntegerField,
  wheelSpeedDecimalField,
  upTimeField,
  tripATimeField,
  tripADistanceField,
  tripAAvgSpeedField,
  tripAMaxSpeedField,
  tripBTimeField,
  tripBDistanceField,
  tripBAvgSpeedField,
  tripBMaxSpeedField,
  odoField,
  wheelSpeedField,
  cadenceField,
  humanPowerField,
  batteryPowerField,
  batteryPowerUsageField,
#ifndef SW102
  tripAUsedWhField,
  tripBUsedWhField,
  tripAWhKmField,
  tripBWhKmField,
#endif
  fieldAlternate,
  batteryVoltageField,
  batteryCurrentField,
  motorCurrentField,
  batterySOCField,
  motorTempField,
  motorErpsField,
  pwmDutyField,
  motorFOCField,
  //motorTempGraph,
  motorEfficiencyField,
  motorFieldWeakeningField,
  bootStatus2,
#ifdef SW102
  custom1, custom2,
  custom3, custom4,
  custom5, custom6,
  warnField; // just close previous definition
#endif
#ifndef SW102 // we don't have any graphs yet on SW102, possibly move this into mainscreen_850.c
  graph1, graph2, graph3,
  *graphs[3],
  custom1, custom2, custom3, custom4,
  custom5, custom6, custom7, custom8,
  custom9, custom10, custom11, custom12,
  warnField,

  wheelSpeedGraph,
  //tripDistanceGraph,
  motorEfficiencyGraph,
  //odoGraph,
  cadenceGraph,
  humanPowerGraph,
  batteryPowerGraph,
  batteryPowerUsageGraph,
  batteryPowerUsageFieldGraph,
  batteryVoltageGraph,
  batteryCurrentGraph,
  motorCurrentGraph,
  batterySOCGraph,
  motorTempGraph,
  motorErpsGraph,
  pwmDutyGraph,
  motorFOCGraph;
  void mainScreenOnDirtyClean();
#endif

extern uint8_t g_showNextScreenIndex;
extern uint8_t g_showNextScreenPreviousIndex;

extern Field batteryField; // These fields are custom for board type
void battery_display(); // 850C and sw102 provide alternative versions due to different implementations
void set_conversions();
void password_check();
bool anyscreen_onpress(buttons_events_t events);
void clock_time(void);
void onSetConfigurationClockHours(uint32_t v);
void onSetConfigurationClockMinutes(uint32_t v);
void onSetConfigurationDisplayLcdBacklightOnBrightness(uint32_t v);
void onSetConfigurationDisplayLcdBacklightOffBrightness(uint32_t v);
void onSetConfigurationBatteryTotalWh(uint32_t v);
void onSetConfigurationWheelOdometer(uint32_t v);
void onSetConfigurationChargeCycles(uint32_t v);
#ifndef SW102
void onSetConfigurationServiceDistanceA(uint32_t v);
void onSetConfigurationServiceDistanceB(uint32_t v);
#endif
void onSetConfigurationBatterySOCUsedWh(uint32_t v);
void mainScreenOnDirtyClean(void);
void secondMainScreenOnDirtyClean(void);
void mainScreenonPostUpdate(void);
bool mainScreenOnPress(buttons_events_t events);
void showNextScreen();
void main_idle(); // call every 20ms
void setWarning(ColorOp color, const char *str);

#if defined(DISPLAY_860C) || defined(DISPLAY_860C_V12) || defined(DISPLAY_860C_V13)
void auto_on_off_lights(void);
#endif

/// set to true if this boot was caused because we had a watchdog failure, used to show user the problem in the fault line
extern bool wd_failure_detected;

extern uint8_t ui8_g_configuration_clock_hours;
extern uint8_t ui8_g_configuration_clock_minutes;

#define EFFICIENCY_TRESHOLDS_DISABLED						0
#define EFFICIENCY_TRESHOLDS_MANUAL							1
#define EFFICIENCY_TRESHOLDS_AUTO							2


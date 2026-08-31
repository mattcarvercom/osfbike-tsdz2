#pragma once

#include "screen.h" // Field - needed by update_field_locks()'s prototype below;
                     // not every includer of this header pulls screen.h in first.

void configscreen_show();

#ifndef SW102
// Walks the whole config menu tree, locking/unlocking every field listed in
// configscreen.c's field_lock_rules[] (dynamic FieldRW.locked, not the
// compile-time editable.read_only bit) based on whatever controls it - e.g.
// "Clock hours" while "Clock field" != clock. Call every tick the config
// screen is showing (theme_osf_modern.c's update_config_screen() - NOT
// Screen.onPreUpdate, which this LVGL build doesn't call, see its own
// comment on update_boot_screen()).
//
// editing_field/editing_value let the caller report an in-progress (not yet
// committed) edit: commit_edit() doesn't write a field's real storage until
// the user confirms/leaves it, so without this a rule watching the field
// currently being edited would only see its old value and stay stale until
// commit. Pass the field being edited (NULL if not editing) and its
// in-progress raw value (same units as field_read_uint(), i.e. no display
// conversion for enums) - if that field happens to be a rule's controller,
// the pending value is used in place of its committed storage.
void update_field_locks(const Field *editing_field, int32_t editing_value);
#endif

extern Screen configScreen;

extern uint8_t ui8_g_configuration_display_reset_to_defaults;
extern uint8_t ui8_g_configuration_trip_a_reset;
extern uint8_t ui8_g_configuration_trip_b_reset;
extern uint32_t ui32_g_configuration_wh_100_percent;
extern uint8_t ui8_g_configuration_display_reset_bluetooth_peers;
extern uint8_t ui8_g_configuration_battery_soc_reset;
extern uint8_t ui8_g_configuration_set_default_weight;
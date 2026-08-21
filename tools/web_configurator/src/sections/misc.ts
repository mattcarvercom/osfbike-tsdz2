// Miscellaneous section: field metadata + any named radio/intSelect controls for
// this page. Assembled into the full control list by ui-model.ts's
// buildControls() - see that file for the raw-field iteration + moveBefore()
// reordering that turns this (plus every other section file) into final
// per-page display order.

import { type ExplicitFieldMeta, type RadioControl, type IntSelectControl } from "../control-types.ts";
export const radioControls: RadioControl[] = [];
export const intSelectControls: IntSelectControl[] = [];

export const fields: Record<string, ExplicitFieldMeta> = {
  odoCompensation: {
    label: "Odometer compensation",
    section: "misc",
    tooltip:
      "Corrects the odometer for distance the firmware silently accumulates while the bike is stationary (data is still sent to the display even at a standstill). With this enabled, the speed shown stays at zero at the next power-on until the accumulated slack is caught up.",
  },
};

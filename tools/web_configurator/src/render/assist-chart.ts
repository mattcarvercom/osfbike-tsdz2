import "./assist-chart.css";
import type { Control } from "../ui-model.ts";
import { state, assistChartUpdaters } from "../app-state.ts";
import { el } from "../dom.ts";
import {
  STEM_TO_ASSIST5_LABEL,
  assistLevel5ChartField,
  assistLevel5Result,
  assistLevel5DisplayValue,
} from "../assist-level5.ts";

/**
 * Small live bar chart of one assist-type family's 4 configured levels
 * (ECO/TOUR/SPORT/TURBO) - a visual "what does this ramp actually look
 * like" companion to the raw number inputs below it, since four bare
 * integers don't say much about their relative shape at a glance. When
 * Assist level 5 is active, the chart gets its own live-computed bar at its
 * real firmware position (before ECO in Before Eco mode, after TURBO in
 * After Turbo mode - see ASSIST_LEVEL_5_MODE's tooltip), using the exact
 * same assistLevel5Result() math (and wrapped, not raw, value) as the
 * assistLevel5Percent field's own computed badges elsewhere on the page, so
 * both stay consistent with each other. (A near-identical header badge used
 * to sit next to this card's title too - removed as redundant once the L5
 * bar + its own label below the chart already showed the same value.)
 * Returns null for families with no STEM_TO_ASSIST5_LABEL entry (nothing
 * else in this app uses repeater cards for a 4-level ramp, but kept
 * defensive rather than assuming).
 *
 * Bars are scaled against the field's own rawMax (255 for Torque/Cadence/
 * eMTB, 511 for Power - see POWER_ASSIST_LEVEL_FIELDS in ui-model.ts for why
 * Power's is different) rather than the current data's own max/min - a
 * value that's actually at the firmware's storage ceiling should visually
 * reach the chart's ceiling too, not just "look tallest among these 4
 * particular numbers". Returned rawMax lets renderControlGroup print that
 * same ceiling next to the card's title (no in-chart reference line for it
 * any more - that read as clutter without adding information the title
 * badge below doesn't already give).
 */
export function renderAssistCurveChart(
  stem: string,
  members: { control: Control; tag: string }[],
): { chart: HTMLElement; rawMax: number } | null {
  const assist5Label = STEM_TO_ASSIST5_LABEL[stem];
  if (!assist5Label) return null;

  interface Bar {
    tag: string;
    value: number;
    warn: boolean;
    isLevel5: boolean;
  }

  // Every STEM_TO_ASSIST5_LABEL family is a plain "number" repeater (see its
  // own doc comment) - .rawMax only exists on that Control kind, so narrow
  // the same defensive way the Bar-building loop below does.
  const first = members[0].control;
  const rawMax = first.kind === "number" ? first.rawMax : 255;

  const bars = el("div", { className: "assist-chart-bars" });
  const labels = el("div", { className: "assist-chart-labels" });

  const update = () => {
    const result: Bar[] = members.map((m) => ({
      tag: m.tag,
      value: m.control.kind === "radio" ? 0 : Number(state.values[m.control.key] ?? 0),
      warn: false,
      isLevel5: false,
    }));

    const l5 = assistLevel5ChartField(assist5Label);
    const percent = Number(state.values.assistLevel5Percent ?? 0);
    if (l5) {
      const { wrapped, overflowed } = assistLevel5Result(l5.field, percent);
      // Charted in the same units as the other 4 bars (the family's own
      // input field), not the raw array-space wrapped byte - matters for
      // Power, whose array byte is half of what its input box shows (see
      // assistLevel5DisplayValue). wrapped is always 0-255, so this can
      // never exceed rawMax even for Power's doubled value (max 510 of 511).
      const bar: Bar = {
        tag: "L5",
        value: assistLevel5DisplayValue(l5.field, wrapped),
        warn: overflowed,
        isLevel5: true,
      };
      if (l5.position === "before") result.unshift(bar);
      else result.push(bar);
    }

    const barEls = result.map((b) => {
      const bar = el(
        "div",
        {
          className: `assist-chart-bar${b.isLevel5 ? " assist-chart-bar-l5" : ""}${b.warn ? " assist-chart-bar-warn" : ""}`,
          title: `${b.tag}: ${b.value}`,
        },
        [el("span", { className: "assist-chart-value", text: String(b.value) })],
      );
      bar.style.height = `${Math.max(2, (b.value / rawMax) * 100)}%`;
      return bar;
    });

    bars.replaceChildren(...barEls);
    labels.replaceChildren(
      ...result.map((b) => el("span", { text: b.tag, className: b.isLevel5 ? "assist-chart-bar-l5" : "" })),
    );
  };

  update();
  assistChartUpdaters.push(update);
  return { chart: el("div", { className: "assist-chart" }, [bars, labels]), rawMax };
}

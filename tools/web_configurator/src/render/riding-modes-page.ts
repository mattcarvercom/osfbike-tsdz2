import "./control-group.css"; // .field-group/.field-group-header/.field-group-startup(-badge) - reused as-is, same look as an assist-level repeater card
import "./control.css"; // .field-note-box - reused for the one consolidated "why is this whole card disabled" note
import { type Control } from "../ui-model.ts";
import { state } from "../app-state.ts";
import { el, icon } from "../dom.ts";
import { renderControl } from "./control.ts";

const OFFROAD_KEYS = ["targetMaxBatteryPower", "wheelMaxSpeed"];
const STREET_KEYS = ["streetModePowerLimit", "streetModeSpeedLimit", "streetCruiseEnabled", "streetWalkEnabled"];

/** One explanation per dead card, not one per field inside it (see riding-modes.ts's dz40OffroadDead/dz40StreetDead doc comment) - every field in a dead card already disables itself via dependsOn, so repeating the same sentence 2-4 times over would just be noise. Shown once, at the top of the card, above its fields. */
function deadCardNote(modeName: string, otherModeName: string): string {
  return `Disabled: DZ40 can't switch riding modes while riding (no lights-button menu) - ${otherModeName} is the configured "Riding mode on power-on" (above), so ${modeName} never actually runs.`;
}

function renderCard(
  title: string,
  keys: string[],
  byKey: Map<string, Control>,
  isPowerOnDefault: boolean,
  deadNote: string,
  app: HTMLElement,
): HTMLElement {
  const headerChildren: (Node | null)[] = [el("span", { text: title })];
  if (isPowerOnDefault) {
    headerChildren.push(el("span", { className: "field-group-startup-badge", text: "Power-on default" }));
  }
  const cardClasses = ["field-group"];
  if (isPowerOnDefault) cardClasses.push("field-group-startup");
  const card = el("div", { className: cardClasses.join(" ") }, [
    el("div", { className: "field-group-header" }, headerChildren),
  ]);
  // Pro mode bypasses the actual field-level dependsOn gating (see
  // controlEnabled() in app-state.ts, which renderControl() below now goes
  // through) - suppress this note too when that's on, so it doesn't keep
  // claiming a card is dead while every field in it is actually editable.
  if (!isPowerOnDefault && state.proMode !== true) {
    card.append(el("div", { className: "field-note-box" }, [icon("infoCircle"), el("span", { text: deadNote })]));
  }
  for (const key of keys) {
    const c = byKey.get(key);
    if (c) card.append(renderControl(c, app));
  }
  return card;
}

/**
 * DZ40-only layout for the Riding modes page (see renderSectionPage's own
 * check - every other display type keeps the plain ungrouped rows). DZ40 has
 * no lights-button menu to switch riding modes while riding, so whichever
 * mode isn't this same page's own "Riding mode on power-on" setting
 * never actually runs there - framing Offroad-mode's 2 fields and
 * Street-mode's other 4 into their own titled cards, and badging/
 * highlighting whichever one currently applies, surfaces that at a glance
 * instead of leaving 6 identical-looking rows where 3-4 of them are dead
 * weight for this specific display. Same "Power-on default" badge wording
 * and accent highlight as the Assist levels page's own startupAssistNote
 * cards - deliberately reusing that exact visual language rather than
 * inventing a second one for the same concept. The actual disabling lives in
 * each field's own dependsOn (sections/riding-modes.ts's dz40OffroadDead/
 * dz40StreetDead) - this only supplies the framing/badge.
 */
export function renderRidingModesDZ40(sectionControls: Control[], app: HTMLElement): HTMLElement[] {
  const byKey = new Map(sectionControls.filter((c) => c.kind !== "radio").map((c) => [c.key, c]));
  const streetIsDefault = state.values.streetModeOnStart === true;
  // "Riding mode on power-on" itself (sections/riding-modes.ts's
  // STREET_MODE_ON_STARTUP) is a radio, so it's excluded from byKey above
  // like every other radio - this bespoke DZ40 layout only ever renders
  // fields it explicitly asks for (unlike the generic groupSectionControls()
  // path every other display type uses, which renders every control in the
  // section automatically), so it has to be pulled out and rendered here by
  // hand or it would silently disappear entirely for DZ40 - the one display
  // type where this specific setting matters most, since it's the only way
  // to actually change which mode runs.
  const startupRadio = sectionControls.find((c) => c.kind === "radio" && c.groupKeys.includes("streetModeOnStart"));
  return [
    ...(startupRadio ? [renderControl(startupRadio, app)] : []),
    renderCard("Offroad mode", OFFROAD_KEYS, byKey, !streetIsDefault, deadCardNote("Offroad-mode", "Street-mode"), app),
    renderCard("Street mode", STREET_KEYS, byKey, streetIsDefault, deadCardNote("Street-mode", "Offroad-mode"), app),
  ];
}

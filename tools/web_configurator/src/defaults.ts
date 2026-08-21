import { provenDefaultValues } from "./proven-defaults.ts";
import type { FieldValues } from "./ini-import.ts";

export function defaultValues(): FieldValues {
  return { ...provenDefaultValues };
}

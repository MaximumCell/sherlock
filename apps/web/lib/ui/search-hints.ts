/**
 * What the search box says while you type: the detected-type chip state and the rotating
 * typewriter placeholder of fictional examples. Pure, so the timing and wording are tested.
 */
import { DETECTION_LABEL } from "../detect-target";
import type { TargetType } from "../types";

export type ChipKind = "empty" | "unsure" | "detected" | "chosen";

export interface ChipState {
  kind: ChipKind;
  type: TargetType | null;
  /** "Looks like an email address", "Searching as a website", "Not sure what this is". */
  phrase: string;
  /** Short action word on the chip. */
  action: "change" | "choose" | null;
}

/**
 * The chip for the current input. A type picked by hand wins over the guess; an empty box
 * shows no chip unless a type was picked.
 */
export function chipState(
  value: string,
  chosen: TargetType | null,
  detected: TargetType | null,
): ChipState {
  if (chosen) {
    return {
      kind: "chosen",
      type: chosen,
      phrase: `Searching as ${DETECTION_LABEL[chosen]}`,
      action: "change",
    };
  }
  if (!value.trim()) return { kind: "empty", type: null, phrase: "", action: null };
  if (!detected) {
    return { kind: "unsure", type: null, phrase: "Not sure what this is", action: "choose" };
  }
  return {
    kind: "detected",
    type: detected,
    phrase: `Looks like ${DETECTION_LABEL[detected]}`,
    action: "change",
  };
}

export interface TypewriterTiming {
  /** ms per typed character */
  type: number;
  /** ms the full example stays */
  hold: number;
  /** ms per erased character */
  erase: number;
  /** ms of empty box between examples */
  gap: number;
}

export const TYPEWRITER: TypewriterTiming = { type: 55, hold: 1600, erase: 22, gap: 350 };

/** How long one example takes from first letter to the next example's start. */
export function exampleDuration(text: string, t: TypewriterTiming = TYPEWRITER): number {
  return text.length * t.type + t.hold + text.length * t.erase + t.gap;
}

/** The visible text of the typewriter at `elapsed` ms, cycling through `examples`. */
export function typewriterText(
  examples: readonly string[],
  elapsed: number,
  t: TypewriterTiming = TYPEWRITER,
): { text: string; index: number } {
  if (examples.length === 0) return { text: "", index: 0 };
  const cycle = examples.reduce((sum, e) => sum + exampleDuration(e, t), 0);
  let rest = ((elapsed % cycle) + cycle) % cycle;
  for (let index = 0; index < examples.length; index++) {
    const ex = examples[index]!;
    const d = exampleDuration(ex, t);
    if (rest < d) {
      const typed = ex.length * t.type;
      if (rest < typed) return { text: ex.slice(0, Math.floor(rest / t.type)), index };
      rest -= typed;
      if (rest < t.hold) return { text: ex, index };
      rest -= t.hold;
      const erased = Math.floor(rest / t.erase);
      return { text: ex.slice(0, Math.max(0, ex.length - erased)), index };
    }
    rest -= d;
  }
  return { text: "", index: 0 };
}

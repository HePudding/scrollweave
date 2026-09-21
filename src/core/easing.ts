import { cubicBezier, easeIn, easeOut, easeInOut } from "motion";
import type { Keyframe } from "./model";
import { compileExpression } from "./expression";
export type Easing = Keyframe["easing"];
export type Bezier = [number, number, number, number];
export const easingPresets: { name: string; value: Easing }[] = [
  { name: "线性", value: "linear" },
  { name: "缓入", value: "easeIn" },
  { name: "缓出", value: "easeOut" },
  { name: "缓入缓出", value: "easeInOut" },
  { name: "快速落定", value: [0.16, 1, 0.3, 1] },
  { name: "轻微回弹", value: [0.34, 1.56, 0.64, 1] },
];
export function easingFunction(value: Easing): (t: number) => number {
  if (Array.isArray(value)) return cubicBezier(...value);
  if (typeof value === "object") return compileExpression(value.formula);
  return { linear: (t: number) => t, easeIn, easeOut, easeInOut }[value];
}
export function toBezier(value: Easing): Bezier {
  if (Array.isArray(value)) return [...value];
  if (value === "linear") return [0, 0, 1, 1];
  if (value === "easeIn") return [0.42, 0, 1, 1];
  if (value === "easeOut") return [0, 0, 0.58, 1];
  return [0.42, 0, 0.58, 1];
}
export function easingPoints(value: Easing, count = 40) {
  const fn = easingFunction(value);
  return Array.from(
    { length: count + 1 },
    (_, i) => [i / count, fn(i / count)] as const,
  );
}

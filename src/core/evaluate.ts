import { interpolate, cubicBezier, easeIn, easeOut, easeInOut } from "motion";
import type { Element, Keyframe, Project } from "./model";
import { properties } from "./constants";
export const clamp = (n: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, n));
export const localProgress = (progress: number, start: number, end: number) =>
  clamp((progress - start) / (end - start));
export function elementRange(
  project: Project,
  compositionId: string,
  element: Element,
): { start: number; end: number } {
  const parent = element.parentId
    ? project.compositions[compositionId].elements.find(
        (e) => e.id === element.parentId,
      )
    : undefined;
  const range = parent
    ? elementRange(project, compositionId, parent)
    : { start: 0, end: 1 };
  const duration = range.end - range.start;
  return {
    start: range.start + (element.start + element.timeOffset) * duration,
    end: range.start + (element.end + element.timeOffset) * duration,
  };
}
const samplers = new WeakMap<Keyframe[], (progress: number) => number>();
export function sampleTrack(
  keys: Keyframe[] | undefined,
  progress: number,
  fallback: number,
): number {
  if (!keys?.length) return fallback;
  if (keys.length === 1) return keys[0].value;
  let sample = samplers.get(keys);
  if (!sample) {
    const easing = { easeIn, easeOut, easeInOut, linear: (p: number) => p };
    sample = interpolate(
      keys.map((k) => k.at),
      keys.map((k) => k.value),
      {
        ease: keys
          .slice(0, -1)
          .map((k) =>
            Array.isArray(k.easing)
              ? cubicBezier(...k.easing)
              : easing[k.easing],
          ),
      },
    );
    samplers.set(keys, sample);
  }
  return sample(progress);
}
export function sampleElement(element: Element, parentProgress: number) {
  const sourceProgress = parentProgress - element.timeOffset;
  const p = localProgress(sourceProgress, element.start, element.end);
  const values = Object.fromEntries(
    properties.map((prop) => [
      prop,
      sampleTrack(element.tracks[prop], p, element[prop]),
    ]),
  ) as Pick<Element, (typeof properties)[number]>;
  return {
    ...values,
    opacity: clamp(values.opacity),
    progress: p,
    visible:
      !element.hidden &&
      (element.trim
        ? parentProgress >= element.trim.start &&
          (parentProgress < element.trim.end ||
            (element.trim.end === 1 && parentProgress === 1))
        : element.outside === "hold" ||
          (sourceProgress >= element.start && sourceProgress <= element.end)),
  };
}
/** The smoothing state belongs to the viewport, never to a composition instance. */
export const chase = (
  current: number,
  target: number,
  deltaMs: number,
  smoothing: number,
) =>
  current +
  (target - current) * (1 - Math.exp(-Math.max(0, deltaMs) / smoothing));
export function sampleComposition(
  project: Project,
  compositionId: string,
  progress: number,
) {
  const result: Record<string, ReturnType<typeof sampleElement>> = {};
  function visit(cid: string, p: number, path: string) {
    const c = project.compositions[cid];
    function children(parent: string | null, at: number, prefix: string) {
      for (const e of c.elements.filter((e) => e.parentId === parent)) {
        const key = `${prefix}/${e.id}`;
        const value = sampleElement(e, at);
        result[key] = value;
        if (e.type === "group") children(e.id, value.progress, key);
        if (e.type === "composition")
          visit(e.compositionId!, value.progress, key);
      }
    }
    children(null, p, path);
  }
  visit(compositionId, clamp(progress), compositionId);
  return result;
}

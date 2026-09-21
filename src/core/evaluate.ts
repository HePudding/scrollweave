import { interpolate } from "motion";
import { easingFunction } from "./easing";
import type { Element, Keyframe, Project } from "./model";
import { properties } from "./constants";
export const clamp = (n: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, n));
export const localProgress = (time: number, start: number, end: number) =>
  clamp((time - start) / (end - start));
export const sourceTime = (e: Element, time: number) =>
  e.sourceIn + (time - e.start) * e.speed;
export function parentTime(
  project: Project,
  cid: string,
  e: Element,
  time: number,
): number {
  const parent = project.compositions[cid].elements.find(
    (n) => n.id === e.parentId,
  );
  return parent
    ? sampleElement(parent, parentTime(project, cid, parent, time)).progress
    : time;
}
export function globalTime(
  project: Project,
  cid: string,
  e: Element,
  source: number,
): number {
  const local = e.start + (source - e.sourceIn) / e.speed;
  const parent = project.compositions[cid].elements.find(
    (n) => n.id === e.parentId,
  );
  return parent ? globalTime(project, cid, parent, local) : local;
}
export function elementRange(project: Project, cid: string, e: Element) {
  return {
    start: globalTime(project, cid, e, e.sourceIn),
    end: globalTime(project, cid, e, e.sourceIn + (e.end - e.start) * e.speed),
  };
}
const samplers = new WeakMap<Keyframe[], (time: number) => number>();
export function sampleTrack(
  keys: Keyframe[] | undefined,
  time: number,
  fallback: number,
): number {
  if (!keys?.length) return fallback;
  if (keys.length === 1) return keys[0].value;
  const exact = keys.find((k) => Math.abs(k.at - time) < 1e-9);
  if (exact) return exact.value;
  let sample = samplers.get(keys);
  if (!sample) {
    sample = interpolate(
      keys.map((k) => k.at),
      keys.map((k) => k.value),
      {
        ease: keys.slice(0, -1).map((k) => easingFunction(k.easing)),
      },
    );
    samplers.set(keys, sample);
  }
  return sample(time);
}
export function sampleElement(element: Element, parent: number) {
  const raw = sourceTime(element, parent);
  const time =
    element.sourceDuration !== undefined
      ? clamp(raw, 0, element.sourceDuration)
      : raw;
  const values = Object.fromEntries(
    properties.map((prop) => [
      prop,
      sampleTrack(element.tracks[prop], time, element[prop]),
    ]),
  ) as Pick<Element, (typeof properties)[number]>;
  return {
    ...values,
    opacity: clamp(values.opacity),
    progress: time,
    sourceTime: raw,
    visible:
      !element.hidden && parent >= element.start - 1e-8 && parent < element.end,
  };
}
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
  time: number,
) {
  const result: Record<string, ReturnType<typeof sampleElement>> = {};
  function visit(cid: string, t: number, path: string, parentVisible = true) {
    const c = project.compositions[cid];
    function children(
      parent: string | null,
      at: number,
      prefix: string,
      visible: boolean,
    ) {
      for (const e of c.elements.filter((e) => e.parentId === parent)) {
        const key = `${prefix}/${e.id}`,
          value = sampleElement(e, at);
        value.visible =
          value.visible &&
          visible &&
          !c.tracks.find((track) => track.id === e.trackId)?.hidden;
        result[key] = value;
        if (e.type === "group")
          children(e.id, value.progress, key, value.visible);
        if (e.type === "composition")
          visit(e.compositionId!, value.progress, key, value.visible);
      }
    }
    children(null, t, path, parentVisible);
  }
  visit(compositionId, time, compositionId);
  return result;
}

import type { Element, Project } from "./model";
import { clamp, elementRange } from "./evaluate";

export type Interval = { start: number; end: number };

/** A conservative support interval: only discard spans provably at zero opacity.
 * Curves and source keyframes are never rewritten, so seeking and reverse playback agree.
 */
export function clipWindow(e: Element): Interval {
  if (e.trim) return { ...e.trim };
  let start = e.outside === "hide" ? e.start + e.timeOffset : 0;
  let end = e.outside === "hide" ? e.end + e.timeOffset : 1;
  const keys = e.tracks.opacity;
  if (keys?.length) {
    const first = keys.findIndex((k) => k.value > 0);
    const last = keys.reduce((index, k, i) => (k.value > 0 ? i : index), -1);
    if (first > 0)
      start = Math.max(
        start,
        e.start + e.timeOffset + keys[first - 1].at * (e.end - e.start),
      );
    if (last >= 0 && last < keys.length - 1)
      end = Math.min(
        end,
        e.start + e.timeOffset + keys[last + 1].at * (e.end - e.start),
      );
  }
  return { start: clamp(start), end: clamp(end) };
}

export function parentRange(
  project: Project,
  cid: string,
  e: Element,
): Interval {
  const parent = project.compositions[cid].elements.find(
    (n) => n.id === e.parentId,
  );
  return parent ? elementRange(project, cid, parent) : { start: 0, end: 1 };
}

export function clipRange(project: Project, cid: string, e: Element): Interval {
  const parent = parentRange(project, cid, e);
  const local = clipWindow(e);
  return {
    start: parent.start + local.start * (parent.end - parent.start),
    end: parent.start + local.end * (parent.end - parent.start),
  };
}

/** New still assets occupy 20% from the playhead; the final edge stays inside the scene. */
export function insertionTiming(
  progress: number,
): Pick<Element, "start" | "end" | "outside"> {
  const start = Math.min(clamp(progress), 0.8);
  return { start, end: Math.min(1, start + 0.2), outside: "hide" };
}

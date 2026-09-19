import type { Element, Project } from "./model";
import { elementRange } from "./evaluate";
export type Interval = { start: number; end: number };
export const clipWindow = (e: Element): Interval => ({
  start: e.start,
  end: e.end,
});
export const clipRange = elementRange;
export function parentRange(p: Project, cid: string, e: Element): Interval {
  const parent = p.compositions[cid].elements.find((n) => n.id === e.parentId);
  return parent
    ? elementRange(p, cid, parent)
    : { start: 0, end: p.compositions[cid].duration };
}
export const insertionTiming = (time: number, duration = 5) => ({
  start: Math.max(0, time),
  end: Math.max(0, time) + duration,
});

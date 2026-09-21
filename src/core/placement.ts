import type { Composition } from "./model";

/** Find one visible, editable lane that can hold all requested clip intervals. */
export function findAvailableTrack(
  composition: Composition,
  ranges: { start: number; end: number }[],
  preferredId?: string,
) {
  const candidates = [...composition.tracks].sort(
    (a, b) => Number(b.id === preferredId) - Number(a.id === preferredId),
  );
  return candidates.find(
    (track) =>
      !track.locked &&
      !track.hidden &&
      ranges.every(
        (range) =>
          !composition.elements.some(
            (clip) =>
              !clip.parentId &&
              clip.trackId === track.id &&
              clip.start < range.end - 1e-6 &&
              clip.end > range.start + 1e-6,
          ),
      ),
  );
}

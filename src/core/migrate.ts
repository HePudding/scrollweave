import { validateProject as validateLegacy } from "./legacy-model";
import {
  validateProject,
  assetSchema,
  elementSchema,
  type Project,
} from "./model";

/** v1's ordinary preview took 12 seconds. Every nested local clock was 0–1.
 * Convert each local clock to 12 seconds, retaining rate/offset and held frames.
 * Clip support is explicit: opacity never determines the new cut boundaries. */
export function migrateProject(input: unknown): Project {
  if ((input as any)?.version === 2) return validateProject(input);
  const old = validateLegacy(input);
  const length = 12;
  const compositions = Object.fromEntries(
    Object.values(old.compositions).map((c) => [
      c.id,
      {
        ...c,
        duration: length,
        tracks: c.elements.length
          ? c.elements.map((e, i) => ({
              id: `lane_${e.id}`,
              name: `${i + 1} · ${e.name}`,
              hidden: false,
              locked: false,
            }))
          : [
              {
                id: "track_main",
                name: "主轨道",
                hidden: false,
                locked: false,
              },
            ],
        elements: c.elements.map((e) => {
          const { timeOffset, trim, outside, ...rest } = e;
          const speed = 1 / (e.end - e.start);
          const start = Math.max(
            0,
            (trim?.start ?? (outside === "hide" ? e.start + timeOffset : 0)) *
              length,
          );
          const end = Math.min(
            length,
            (trim?.end ?? (outside === "hide" ? e.end + timeOffset : 1)) *
              length,
          );
          return elementSchema.parse({
            ...rest,
            trackId: `lane_${e.id}`,
            start: Math.min(start, length - 0.001),
            end: Math.max(Math.min(start, length - 0.001) + 0.001, end),
            hidden: e.hidden || end <= start,
            sourceIn: (start - (e.start + timeOffset) * length) * speed,
            speed,
            sourceDuration: length,
            tracks: Object.fromEntries(
              Object.entries(e.tracks).map(([p, keys]) => [
                p,
                keys.map((k) => ({ ...k, at: k.at * length })),
              ]),
            ),
          });
        }),
      },
    ]),
  );
  const assets = Object.fromEntries(
    Object.values(old.assets).map((a) => [
      a.id,
      assetSchema.parse({ ...a, kind: "image" }),
    ]),
  );
  return validateProject({
    ...old,
    version: 2,
    compositions,
    assets,
    sections: old.sections.map((s) => ({ ...s, start: 0, end: length })),
    migration: {
      fromVersion: 1,
      secondsPerComposition: length,
      note: "按旧版 12 秒预览时长迁移。各层保留源时钟、偏移、裁剪、曲线与嵌套；透明度不再决定片段边界。原始文件另存备份。",
    },
  });
}

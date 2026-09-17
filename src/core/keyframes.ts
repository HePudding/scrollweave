import { uid, type AnimProperty, type Keyframe, type Project } from "./model";
import { elementRange } from "./evaluate";
import type { Command } from "./commands";

export type KeySelection = {
  elementId: string;
  property: AnimProperty;
  keyframeId: string;
};
export type CopiedKey = {
  elementId: string;
  property: AnimProperty;
  keyframe: Keyframe;
  position: number;
};
export const keyId = (k: KeySelection) =>
  `key:${k.elementId}:${k.property}:${k.keyframeId}`;
const round = (n: number) => Math.round(n * 1e8) / 1e8;

export function readKeys(
  project: Project,
  cid: string,
  selection: KeySelection[],
): CopiedKey[] {
  return selection.flatMap((ref) => {
    const e = project.compositions[cid].elements.find(
      (e) => e.id === ref.elementId,
    );
    const keyframe = e?.tracks[ref.property]?.find(
      (k) => k.id === ref.keyframeId,
    );
    if (!e || !keyframe) return [];
    const range = elementRange(project, cid, e);
    return [
      {
        elementId: e.id,
        property: ref.property,
        keyframe: structuredClone(keyframe),
        position: range.start + keyframe.at * (range.end - range.start),
      },
    ];
  });
}

/** One batch and one undo entry; collisions fail explicitly without losing other keys. */
export function moveKeys(
  project: Project,
  cid: string,
  selection: KeySelection[],
  delta: number,
): Command[] {
  return readKeys(project, cid, selection).map((k) => {
    const e = project.compositions[cid].elements.find(
      (e) => e.id === k.elementId,
    )!;
    if (e.locked) throw new Error("请先解锁图层");
    const range = elementRange(project, cid, e);
    const at = round(k.keyframe.at + delta / (range.end - range.start));
    if (at < 0 || at > 1) throw new Error("关键帧不能移出动画映射区间");
    if (
      e.tracks[k.property]?.some(
        (other) =>
          Math.abs(other.at - at) < 1e-8 &&
          !selection.some(
            (s) =>
              s.elementId === e.id &&
              s.property === k.property &&
              s.keyframeId === other.id,
          ),
      )
    )
      throw new Error("目标位置已有关键帧，请选择其他位置");
    return {
      type: "keyframe.set",
      compositionId: cid,
      elementId: e.id,
      property: k.property,
      keyframe: { ...k.keyframe, at },
    };
  });
}

/** Paste anchors the first copied key to the playhead. Existing keys at destinations are replaced. */
export function pasteKeys(
  project: Project,
  cid: string,
  copied: CopiedKey[],
  progress: number,
  selectedIds: string[],
): Command[] {
  if (!copied.length) return [];
  const first = Math.min(...copied.map((k) => k.position));
  const singleSource = new Set(copied.map((k) => k.elementId)).size === 1;
  return copied.map((k) => {
    const elementId =
      singleSource && selectedIds.length === 1 ? selectedIds[0] : k.elementId;
    const e = project.compositions[cid].elements.find(
      (e) => e.id === elementId,
    );
    if (!e) throw new Error("复制的图层不在当前合成中，请选中一个目标图层");
    if (e.locked) throw new Error("请先解锁图层");
    const range = elementRange(project, cid, e);
    const at = round(
      (progress + k.position - first - range.start) / (range.end - range.start),
    );
    if (at < 0 || at > 1) throw new Error("粘贴后的关键帧超出动画映射区间");
    const existing = e.tracks[k.property]?.find(
      (o) => Math.abs(o.at - at) < 1e-8,
    );
    return {
      type: "keyframe.set",
      compositionId: cid,
      elementId,
      property: k.property,
      keyframe: { ...k.keyframe, id: existing?.id ?? uid("key"), at },
    };
  });
}

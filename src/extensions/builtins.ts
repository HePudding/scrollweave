import { registerPreset } from "./registry";
import "./builtin-elements";
import { createElement, uid, type Keyframe } from "../core/model";
import type { Command } from "../core/commands";
import { insertionTiming } from "../core/timing";
const keys = (from: number, to: number): Keyframe[] => [
  { id: uid("key"), at: 0, value: from, easing: "easeOut" },
  { id: uid("key"), at: 1, value: to, easing: "easeOut" },
];
registerPreset({
  id: "title-rise",
  name: "标题淡入上移",
  description: "透明度 0 → 1，上移 100px；可应用到选中图层。",
  build({ project, compositionId, elementId, options }) {
    const selected = project.compositions[compositionId].elements.find(
      (e) => e.id === elementId,
    );
    const element =
      selected ??
      createElement({
        type: "text",
        name: "渐入标题",
        text: String(options.text ?? "让滚动，讲一个好故事。"),
        x: 160,
        y: 230,
        width: 1500,
        height: 150,
        fontSize: 100,
        fontWeight: 700,
        ...insertionTiming(Number(options.start ?? 0)),
        ...(options.end !== undefined ? { end: Number(options.end) } : {}),
      });
    const remove: Command[] = (["y", "opacity"] as const).flatMap((property) =>
      (element.tracks[property] ?? []).map((k) => ({
        type: "keyframe.delete",
        compositionId,
        elementId: element.id,
        property,
        keyframeId: k.id,
      })),
    );
    return [
      ...(selected
        ? remove
        : [{ type: "element.add" as const, compositionId, element }]),
      ...keys(element.y + Number(options.distance ?? 100), element.y).map(
        (keyframe) => ({
          type: "keyframe.set" as const,
          compositionId,
          elementId: element.id,
          property: "y" as const,
          keyframe,
        }),
      ),
      ...keys(0, 1).map((keyframe) => ({
        type: "keyframe.set" as const,
        compositionId,
        elementId: element.id,
        property: "opacity" as const,
        keyframe,
      })),
    ];
  },
});
registerPreset({
  id: "product-zoom",
  name: "产品缩放展示",
  description: "从 72% 平滑放大，可应用到图片或分组。",
  build({ project, compositionId, elementId, options }) {
    const selected = project.compositions[compositionId].elements.find(
      (e) => e.id === elementId,
    );
    const element =
      selected ??
      createElement({
        type: "shape",
        name: "产品展示",
        x: 620,
        y: 220,
        width: 640,
        height: 640,
        radius: 80,
        fill: "#c4f36b",
        ...insertionTiming(Number(options.start ?? 0)),
        ...(options.end !== undefined ? { end: Number(options.end) } : {}),
      });
    const remove: Command[] = (["scaleX", "scaleY"] as const).flatMap(
      (property) =>
        (element.tracks[property] ?? []).map((k) => ({
          type: "keyframe.delete",
          compositionId,
          elementId: element.id,
          property,
          keyframeId: k.id,
        })),
    );
    return [
      ...(selected
        ? remove
        : [{ type: "element.add" as const, compositionId, element }]),
      ...(["scaleX", "scaleY"] as const).flatMap((property) =>
        keys(Number(options.from ?? 0.72), 1).map((keyframe) => ({
          type: "keyframe.set" as const,
          compositionId,
          elementId: element.id,
          property,
          keyframe,
        })),
      ),
    ];
  },
});
registerPreset({
  id: "horizontal-cards",
  name: "横向卡片展示",
  description: "可编辑的卡片子合成，父区间驱动横向位移。",
  build({ compositionId, options }) {
    const id = uid("cards");
    const group = createElement({
      id: "strip",
      type: "group",
      name: "横向卡片轨道",
      width: 3400,
      height: 750,
      fill: "transparent",
      y: 160,
      tracks: { x: keys(130, -1420) },
    });
    const colors = ["#c4f36b", "#a9b8ff", "#f3b79e", "#cfdbd2"];
    const elements = [
      group,
      ...colors.flatMap((fill, i) => [
        createElement({
          id: `card_${i}`,
          parentId: "strip",
          type: "shape",
          name: `卡片 ${i + 1}`,
          x: i * 830,
          y: 0,
          width: 770,
          height: 750,
          fill,
          radius: 36,
        }),
        createElement({
          id: `label_${i}`,
          parentId: "strip",
          type: "text",
          name: `卡片标题 ${i + 1}`,
          x: i * 830 + 58,
          y: 68,
          width: 630,
          height: 100,
          text: [
            "01 / 精确到每一次滚动",
            "02 / 让创作自然发生",
            "03 / 与 Agent 一起编辑",
            "04 / 把故事带到任何地方",
          ][i],
          fontSize: 38,
          color: "#18201c",
        }),
        createElement({
          id: `mark_${i}`,
          parentId: "strip",
          type: "text",
          name: `卡片数字 ${i + 1}`,
          x: i * 830 + 58,
          y: 290,
          width: 650,
          height: 290,
          text: ["Flow.", "Make.", "Code.", "Share."][i],
          fontSize: 150,
          fontWeight: 700,
          color: "#18201c",
        }),
      ]),
    ];
    return [
      {
        type: "composition.add",
        composition: {
          id,
          name: String(options.name ?? "横向卡片"),
          width: 1920,
          height: 1080,
          background: "transparent",
          elements,
        },
      },
      {
        type: "element.add",
        compositionId,
        element: createElement({
          type: "composition",
          compositionId: id,
          name: "横向卡片 · 子合成",
          width: 1920,
          height: 1080,
          fill: "transparent",
          ...insertionTiming(Number(options.start ?? 0)),
          ...(options.end !== undefined ? { end: Number(options.end) } : {}),
        }),
      },
    ];
  },
});

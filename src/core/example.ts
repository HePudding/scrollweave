import {
  blankProject,
  createElement,
  type Keyframe,
  type Element,
  validateProject,
} from "./model";
import { applyCommands } from "./commands";
import { presets } from "../extensions/registry";
import "../extensions/builtins";
const track = (
  values: [number, number][],
  easing: Keyframe["easing"] = "easeInOut",
): Keyframe[] =>
  values.map(([at, value], i) => ({ id: `k${i}`, at, value, easing }));
export function exampleProject() {
  let p = blankProject();
  p.id = "scrollweave_demo";
  p.name = "FORM / 让灵感顺势而动";
  const e = (data: Partial<Element> & Pick<Element, "type">) =>
    createElement(data);
  p.compositions.main = {
    id: "main",
    name: "01 / 产品与横向叙事",
    width: 1920,
    height: 1080,
    background: "#121714",
    elements: [
      e({
        id: "brand",
        type: "text",
        name: "品牌标识",
        text: "FORM®",
        x: 116,
        y: 70,
        width: 500,
        height: 70,
        fontSize: 42,
        fontWeight: 800,
      }),
      e({
        id: "eyebrow",
        type: "text",
        name: "开场标签",
        text: "为你的下一个想法而生 / 2026",
        x: 120,
        y: 300,
        width: 850,
        height: 60,
        fontSize: 27,
        color: "#c4f36b",
        tracks: {
          opacity: track([
            [0, 0.25],
            [0.06, 1],
            [0.32, 1],
            [0.42, 0],
          ]),
        },
      }),
      e({
        id: "title",
        type: "text",
        name: "主标题 · 淡入上移",
        text: "让灵感\n顺势而动。",
        x: 112,
        y: 400,
        width: 1060,
        height: 330,
        fontSize: 146,
        fontWeight: 700,
        tracks: {
          y: track([
            [0, 490],
            [0.12, 390],
            [0.3, 390],
            [0.46, 230],
          ]),
          opacity: track([
            [0, 0],
            [0.1, 1],
            [0.32, 1],
            [0.46, 0],
          ]),
        },
      }),
      e({
        id: "subtitle",
        type: "text",
        name: "产品说明",
        text: "一块画布，无限种可能。\n向下滚动，展开你的创作空间。",
        x: 122,
        y: 800,
        width: 800,
        height: 120,
        fontSize: 30,
        color: "#9faa9e",
        tracks: {
          opacity: track([
            [0, 0],
            [0.12, 1],
            [0.3, 1],
            [0.42, 0],
          ]),
        },
      }),
      e({
        id: "product",
        type: "group",
        name: "FORM / 创作终端",
        x: 1160,
        y: 235,
        width: 520,
        height: 650,
        fill: "transparent",
        rotation: -9,
        tracks: {
          x: track([
            [0, 1260],
            [0.16, 1160],
            [0.34, 690],
            [0.5, 640],
          ]),
          y: track([
            [0, 310],
            [0.18, 235],
            [0.35, 170],
            [0.51, -750],
          ]),
          rotation: track([
            [0, -14],
            [0.22, -9],
            [0.38, 0],
          ]),
          scaleX: track([
            [0, 0.8],
            [0.16, 1],
            [0.34, 1.14],
          ]),
          scaleY: track([
            [0, 0.8],
            [0.16, 1],
            [0.34, 1.14],
          ]),
        },
      }),
      e({
        id: "case",
        parentId: "product",
        type: "shape",
        name: "产品外壳",
        width: 520,
        height: 650,
        radius: 52,
        fill: "#c4f36b",
      }),
      e({
        id: "screen",
        parentId: "product",
        type: "shape",
        name: "屏幕",
        x: 32,
        y: 32,
        width: 456,
        height: 460,
        radius: 28,
        fill: "#243328",
      }),
      e({
        id: "screenWord",
        parentId: "product",
        type: "text",
        name: "产品屏幕标题",
        x: 70,
        y: 90,
        width: 370,
        height: 300,
        text: "Ideas\nin\nmotion.",
        fontSize: 87,
        fontWeight: 650,
        color: "#d5f5a6",
      }),
      e({
        id: "dial",
        parentId: "product",
        type: "shape",
        name: "控制旋钮",
        x: 370,
        y: 536,
        width: 78,
        height: 78,
        radius: 50,
        fill: "#243328",
      }),
      e({
        id: "model",
        parentId: "product",
        type: "text",
        name: "产品型号",
        x: 58,
        y: 560,
        width: 270,
        height: 50,
        text: "F—01 / STUDIO",
        fontSize: 24,
        color: "#243328",
      }),
      e({
        id: "cardHeading",
        type: "text",
        name: "横向展示标题",
        x: 120,
        y: 148,
        width: 1400,
        height: 100,
        text: "把可能，一一展开。",
        fontSize: 56,
        fontWeight: 600,
        tracks: {
          opacity: track([
            [0, 0],
            [0.4, 0],
            [0.48, 1],
            [0.95, 1],
            [1, 0.4],
          ]),
        },
      }),
      e({
        id: "scrollHint",
        type: "text",
        name: "滚动提示",
        x: 120,
        y: 996,
        width: 1500,
        height: 40,
        text: "↓  向下滚动探索                                              FORM — MADE FOR THE WAY YOU THINK",
        fontSize: 20,
        color: "#8f9c91",
      }),
    ],
  };
  p = applyCommands(
    p,
    presets
      .get("horizontal-cards")!
      .build({
        project: p,
        compositionId: "main",
        options: { start: 0.43, end: 0.96 },
      }),
  );
  const instance = p.compositions.main.elements.at(-1)!;
  instance.id = "cardsInstance";
  instance.height = 920;
  instance.y = 95;
  instance.outside = "hold";
  instance.tracks.opacity = track([
    [0, 0],
    [0.09, 1],
    [1, 1],
  ]);
  const cid = instance.compositionId!;
  const cards = p.compositions[cid];
  delete p.compositions[cid];
  cards.id = "cards";
  p.compositions.cards = cards;
  instance.compositionId = "cards";
  p.compositions.outro = {
    id: "outro",
    name: "02 / 行动与收尾",
    width: 1920,
    height: 1080,
    background: "#d2edb1",
    elements: [
      e({
        id: "outroNote",
        type: "text",
        name: "收尾标签",
        text: "你的下一个作品，从这里开始",
        x: 490,
        y: 240,
        width: 950,
        height: 60,
        fontSize: 32,
        color: "#485e3d",
      }),
      e({
        id: "outroTitle",
        type: "text",
        name: "行动标题",
        text: "让想法，成为作品。",
        x: 300,
        y: 370,
        width: 1500,
        height: 150,
        fontSize: 115,
        fontWeight: 650,
        color: "#182618",
      }),
      e({
        id: "ctaBackground",
        type: "shape",
        name: "按钮背景",
        x: 700,
        y: 600,
        width: 520,
        height: 110,
        radius: 60,
        fill: "#182618",
      }),
      e({
        id: "cta",
        type: "text",
        name: "行动按钮",
        x: 700,
        y: 600,
        width: 520,
        height: 110,
        text: "开始创作  ↗",
        fontSize: 35,
        color: "#ecf9df",
        href: "https://github.com/",
      }),
      e({
        id: "footer",
        type: "text",
        name: "页脚",
        x: 660,
        y: 948,
        width: 800,
        height: 50,
        text: "FORM®  /  一个可编辑的滚动故事",
        fontSize: 23,
        color: "#567049",
      }),
    ],
  };
  p.sections = [
    { id: "story", compositionId: "main", kind: "pin", scrollDistance: 5200 },
    {
      id: "ending",
      compositionId: "outro",
      kind: "flow",
      scrollDistance: 1080,
    },
  ];
  return validateProject(p);
}

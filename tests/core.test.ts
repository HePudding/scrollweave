import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleProject } from "../src/core/example";
import {
  applyCommands,
  ProjectStore,
  ConflictError,
} from "../src/core/commands";
import {
  blankProject,
  createElement,
  validateProject,
  clone,
} from "../src/core/model";
import {
  sampleComposition,
  sampleTrack,
  localProgress,
  chase,
  elementRange,
  sampleElement,
} from "../src/core/evaluate";
import { propertyCommands } from "../src/ui/Canvas";
import { presets } from "../src/extensions/registry";
import { exportHTML } from "../server/export";
import { clipWindow, clipRange, insertionTiming } from "../src/core/timing";
import { readKeys, moveKeys, pasteKeys } from "../src/core/keyframes";

test("素材裁边不重定时：随机、反向采样保留原来的贝塞尔曲线", () => {
  const p = exampleProject();
  const source = p.compositions.main.elements.find((e) => e.id === "title")!;
  const next = applyCommands(p, [
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "title",
      start: 0.12,
      end: 0.35,
    },
  ]);
  const cut = next.compositions.main.elements.find((e) => e.id === "title")!;
  assert.deepEqual(cut.tracks, source.tracks);
  for (const at of [0.34, 0.12, 0.31, 0.2, 0.3499, 0.05, 0.8, 0.35]) {
    const a = sampleElement(source, at),
      b = sampleElement(cut, at);
    assert.equal(b.y, a.y);
    assert.equal(b.progress, a.progress);
    assert.equal(b.visible, at >= 0.12 && at < 0.35);
  }
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))), next);
});

test("组和子合成分割保留进度、绘制顺序与独立实例，切点只显示一段", () => {
  const p = exampleProject();
  for (const elementId of ["product", "cardsInstance"]) {
    const at = elementId === "product" ? 0.3 : 0.68;
    const next = applyCommands(p, [
      {
        type: "element.split",
        compositionId: "main",
        elementId,
        at,
        newId: "second",
      },
    ]);
    const first = next.compositions.main.elements.find(
      (e) => e.id === elementId,
    )!;
    const second = next.compositions.main.elements.find(
      (e) => e.id === "second",
    )!;
    const source = p.compositions.main.elements.find(
      (e) => e.id === elementId,
    )!;
    for (const progress of [
      at,
      at - 0.00001,
      at + 0.00001,
      0.9,
      0.1,
      0.7,
      0.3,
    ]) {
      const left = sampleElement(first, progress),
        right = sampleElement(second, progress);
      assert.ok(
        !(left.visible && right.visible),
        "半透明内容在切点不能重复叠加",
      );
      if (left.visible || right.visible)
        assert.deepEqual(
          left.visible ? left : right,
          sampleElement(source, progress),
        );
    }
    if (elementId === "product") {
      const children = next.compositions.main.elements.filter(
        (e) => e.parentId === "second",
      );
      assert.equal(
        children.length,
        p.compositions.main.elements.filter((e) => e.parentId === elementId)
          .length,
      );
      assert.ok(
        children.every(
          (e) =>
            !p.compositions.main.elements.some(
              (original) => original.id === e.id,
            ),
        ),
      );
    } else assert.equal(second.compositionId, source.compositionId);
  }
});

test("素材平移同步关键帧和嵌套进度，不改变裁边后的长度", () => {
  let p = exampleProject();
  p = applyCommands(p, [
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "product",
      start: 0.1,
      end: 0.4,
    },
  ]);
  const source = p.compositions.main.elements.find((e) => e.id === "product")!;
  const next = applyCommands(p, [
    {
      type: "element.move",
      compositionId: "main",
      elementId: "product",
      delta: 0.2,
    },
  ]);
  const shifted = next.compositions.main.elements.find(
    (e) => e.id === "product",
  )!;
  assert.ok(Math.abs(clipWindow(shifted).start - 0.3) < 1e-8);
  for (const at of [0.11, 0.22, 0.3999]) {
    const a = sampleElement(source, at),
      b = sampleElement(shifted, at + 0.2);
    assert.ok(Math.abs(a.y - b.y) < 1e-7);
    assert.ok(Math.abs(a.progress - b.progress) < 1e-7);
  }
  assert.throws(
    () =>
      applyCommands(next, [
        {
          type: "element.move",
          compositionId: "main",
          elementId: "product",
          delta: 0.8,
        },
      ]),
    /超出/,
  );
});

test("延长静态素材的裁剪边缘会延长显示，动画保持终点状态", () => {
  const p = blankProject();
  p.compositions.main.elements = [
    createElement({ id: "still", type: "text", ...insertionTiming(0.2) }),
  ];
  const next = applyCommands(p, [
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "still",
      start: 0.2,
      end: 0.8,
    },
  ]);
  assert.equal(
    sampleElement(next.compositions.main.elements[0], 0.7).visible,
    true,
  );
  assert.equal(
    sampleElement(next.compositions.main.elements[0], 0.7).progress,
    1,
  );
  assert.equal(
    sampleElement(next.compositions.main.elements[0], 0.8).visible,
    false,
  );
});

test("有效色块忽略零透明度尾段；静态素材按播放头插入有限时长", () => {
  const p = exampleProject();
  const title = p.compositions.main.elements.find((e) => e.id === "title")!;
  assert.deepEqual(clipWindow(title), { start: 0, end: 0.46 });
  const brand = p.compositions.main.elements.find((e) => e.id === "brand")!;
  assert.deepEqual(clipWindow(brand), { start: 0, end: 1 });
  for (const at of [0, 0.2, 0.8, 0.99, 1]) {
    const e = createElement({ type: "text", ...insertionTiming(at) });
    assert.ok(Math.abs(e.end - e.start - 0.2) < 1e-8);
    assert.equal(e.outside, "hide");
  }
  const nested = createElement({
    type: "text",
    id: "nested",
    parentId: "product",
    trim: { start: 0.2, end: 0.4 },
  });
  p.compositions.main.elements.push(nested);
  assert.deepEqual(clipRange(p, "main", nested), { start: 0.2, end: 0.4 });
});

test("关键帧多选移动/粘贴保留相对位置，碰撞明确报错，一次撤销", () => {
  const p = blankProject();
  p.compositions.main.elements.push(
    createElement({
      id: "a",
      type: "shape",
      tracks: {
        x: [
          { id: "k1", at: 0.1, value: 5, easing: "linear" },
          { id: "k2", at: 0.3, value: 30, easing: "linear" },
          { id: "k3", at: 0.7, value: 70, easing: "linear" },
        ],
      },
    }),
  );
  const refs = ["k1", "k2"].map((keyframeId) => ({
    elementId: "a",
    property: "x" as const,
    keyframeId,
  }));
  const store = new ProjectStore(p);
  store.commit(moveKeys(p, "main", refs, 0.1), 0);
  assert.deepEqual(
    store.project.compositions.main.elements[0].tracks.x!.map((k) => k.at),
    [0.2, 0.4, 0.7],
  );
  store.undo(1);
  assert.deepEqual(store.project, p);
  assert.throws(() => moveKeys(p, "main", refs, 0.4), /已有关键帧/);
  assert.throws(() => moveKeys(p, "main", refs, -0.2), /不能移出/);
  const copied = readKeys(p, "main", refs);
  store.commit(pasteKeys(p, "main", copied, 0.5, ["a"]), 2);
  assert.deepEqual(
    store.project.compositions.main.elements[0].tracks.x!.map((k) => [
      k.at,
      k.value,
    ]),
    [
      [0.1, 5],
      [0.3, 30],
      [0.5, 5],
      [0.7, 30],
    ],
  );
  store.undo(3);
  assert.deepEqual(store.project, p);
});

test("旧项目无需迁移，裁剪/分割校验失败和版本冲突不会污染状态", () => {
  const old: any = exampleProject();
  for (const c of Object.values(old.compositions) as any[])
    for (const e of c.elements) {
      delete e.trim;
      delete e.timeOffset;
    }
  const store = new ProjectStore(validateProject(old));
  const original = clone(store.project);
  assert.equal(store.project.compositions.main.elements[0].trim, null);
  assert.throws(() =>
    store.commit(
      [
        {
          type: "element.trim",
          compositionId: "main",
          elementId: "title",
          start: 0.8,
          end: 0.2,
        },
      ],
      0,
    ),
  );
  assert.deepEqual(store.project, original);
  store.commit(
    [
      {
        type: "element.split",
        compositionId: "main",
        elementId: "title",
        at: 0.2,
        newId: "split",
      },
    ],
    0,
  );
  assert.throws(
    () =>
      store.commit(
        [
          {
            type: "element.trim",
            compositionId: "main",
            elementId: "title",
            start: 0,
            end: 0.1,
          },
        ],
        0,
      ),
    ConflictError,
  );
  store.undo(1);
  assert.deepEqual(store.project, original);
});

test("完整示例是有效的版本化项目，并包含固定舞台、横向子合成与纵向收尾", () => {
  const p = exampleProject();
  assert.equal(validateProject(p).version, 1);
  assert.equal(p.sections[0].kind, "pin");
  assert.equal(p.sections[1].kind, "flow");
  assert.equal(
    p.compositions.main.elements.find((e) => e.id === "cardsInstance")
      ?.compositionId,
    "cards",
  );
});
test("任意顺序采样、反向滚动与快速跳转均是确定性的", () => {
  const p = exampleProject();
  const points = [0, 0.01, 0.1, 0.3, 0.4299, 0.43, 0.5, 0.7, 0.96, 1];
  const snapshots = new Map(
    points.map((t) => [t, sampleComposition(p, "main", t)]),
  );
  for (const t of [...points].reverse().concat([0.96, 0.1, 1, 0, 0.5]))
    assert.deepEqual(sampleComposition(p, "main", t), snapshots.get(t));
});
test("区间边界严格映射到本地 0–1 并保持首尾状态", () => {
  assert.equal(localProgress(0, 0.2, 0.8), 0);
  assert.equal(localProgress(0.2, 0.2, 0.8), 0);
  assert.ok(Math.abs(localProgress(0.5, 0.2, 0.8) - 0.5) < 1e-10);
  assert.equal(localProgress(1, 0.2, 0.8), 1);
});
test("分组中的轨道区间组合映射到合成进度", () => {
  const p = blankProject();
  const g = createElement({ id: "g", type: "group", start: 0.2, end: 0.8 });
  const child = createElement({
    id: "c",
    type: "shape",
    parentId: "g",
    start: 0.25,
    end: 0.75,
  });
  p.compositions.main.elements = [g, child];
  const range = elementRange(p, "main", child);
  assert.ok(Math.abs(range.start - 0.35) < 1e-12);
  assert.ok(Math.abs(range.end - 0.65) < 1e-12);
});
test("在已有轨道上重复应用预制会替换对应通道，其他通道保持原样", () => {
  let p = exampleProject();
  const preset = presets.get("title-rise")!;
  p = applyCommands(
    p,
    preset.build({
      project: p,
      compositionId: "main",
      elementId: "title",
      options: {},
    }),
  );
  p = applyCommands(
    p,
    preset.build({
      project: p,
      compositionId: "main",
      elementId: "title",
      options: { distance: 200 },
    }),
  );
  const e = p.compositions.main.elements.find((e) => e.id === "title")!;
  assert.equal(e.tracks.y!.length, 2);
  assert.equal(e.tracks.y![0].value, e.y + 200);
});
test("嵌套多实例具有独立的局部进度，无共享动画状态", () => {
  let p = exampleProject();
  p = applyCommands(p, [
    {
      type: "element.duplicate",
      compositionId: "main",
      elementId: "cardsInstance",
      newId: "second",
    },
    {
      type: "element.update",
      compositionId: "main",
      elementId: "second",
      patch: { start: 0.1, end: 0.3 },
    },
  ]);
  const state = sampleComposition(p, "main", 0.5);
  assert.equal(state["main/second"].progress, 1);
  assert.ok(state["main/cardsInstance"].progress < 0.2);
  assert.notEqual(
    state["main/second/strip"].x,
    state["main/cardsInstance/strip"].x,
  );
  const original = sampleComposition(p, "main", 0.5);
  sampleComposition(p, "main", 0.01);
  assert.deepEqual(sampleComposition(p, "main", 0.5), original);
});
test("直接和间接循环合成都被拒绝", () => {
  const p = exampleProject();
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "element.add",
          compositionId: "main",
          element: createElement({
            type: "composition",
            compositionId: "main",
          }),
        },
      ]),
    /循环/,
  );
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "element.add",
          compositionId: "cards",
          element: createElement({
            type: "composition",
            compositionId: "main",
          }),
        },
      ]),
    /循环/,
  );
});
test("平滑追随从实际值继续，反向目标不跳回起点；帧率无关", () => {
  let current = 0;
  for (let i = 0; i < 30; i++) current = chase(current, 1, 16, 180);
  const reversed = chase(current, 0.2, 16, 180);
  assert.ok(reversed < current && reversed > 0.2);
  const single = chase(0, 1, 480, 180);
  assert.ok(Math.abs(current - single) < 1e-12);
  assert.equal(chase(0.4, 1, 0, 180), 0.4);
});
test("批量编辑是原子事务，整批一次撤销；重做保留精确状态", () => {
  const store = new ProjectStore(exampleProject());
  const before = clone(store.project);
  store.commit(
    [
      {
        type: "element.update",
        compositionId: "main",
        elementId: "title",
        patch: { text: "Agent 修改" },
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "brand",
        patch: { x: 300 },
      },
    ],
    0,
    "Agent 批量操作",
  );
  const after = clone(store.project);
  assert.equal(store.revision, 1);
  store.undo(1);
  assert.deepEqual(store.project, before);
  store.redo(2);
  assert.deepEqual(store.project, after);
});
test("失败批次不修改项目或撤销栈", () => {
  const store = new ProjectStore(exampleProject());
  const before = clone(store.project);
  assert.throws(
    () =>
      store.commit(
        [
          {
            type: "element.update",
            compositionId: "main",
            elementId: "title",
            patch: { text: "不应保存" },
          },
          {
            type: "element.update",
            compositionId: "main",
            elementId: "cardsInstance",
            patch: { end: 0.2 },
          },
        ],
        0,
      ),
    /结束/,
  );
  assert.equal(store.revision, 0);
  assert.equal(store.snapshot().canUndo, false);
  assert.deepEqual(store.project, before);
});
test("持久化失败时回滚内存状态、版本与撤销历史", () => {
  const store = new ProjectStore(exampleProject());
  const before = clone(store.snapshot());
  assert.throws(
    () =>
      store.withPersistence(
        () =>
          store.commit(
            [{ type: "project.update", patch: { name: "未保存" } }],
            0,
          ),
        () => {
          throw new Error("disk failure");
        },
      ),
    /disk failure/,
  );
  assert.deepEqual(store.snapshot(), before);
});
test("部分属性更新不得给未指定属性补默认值", () => {
  const p = exampleProject();
  const old = p.compositions.main.elements.find((e) => e.id === "product")!;
  const next = applyCommands(p, [
    {
      type: "element.update",
      compositionId: "main",
      elementId: old.id,
      patch: { name: "重命名" },
    },
  ]);
  assert.deepEqual(
    next.compositions.main.elements.find((e) => e.id === old.id),
    { ...old, name: "重命名" },
  );
  const changed = applyCommands(p, [
    {
      type: "composition.update",
      compositionId: "cards",
      patch: { name: "重命名合成" },
    },
  ]);
  assert.equal(changed.compositions.cards.background, "transparent");
});
test("并发版本冲突不静默覆盖", () => {
  const store = new ProjectStore(exampleProject());
  store.commit([{ type: "project.update", patch: { name: "人工修改" } }], 0);
  assert.throws(
    () =>
      store.commit(
        [{ type: "project.update", patch: { name: "过期 Agent 修改" } }],
        0,
      ),
    ConflictError,
  );
  assert.equal(store.project.name, "人工修改");
});
test("保存和 JSON 恢复保持所有采样一致", () => {
  const p = exampleProject();
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored, p);
  for (const t of [0, 0.25, 0.43, 0.76, 1])
    assert.deepEqual(
      sampleComposition(restored, "main", t),
      sampleComposition(p, "main", t),
    );
});
test("导入子项目重新映射合成和素材 ID，复用结构仍可编辑", () => {
  const p = applyCommands(blankProject(), [
    { type: "project.import", prefix: "imported", project: exampleProject() },
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({
        id: "instance",
        type: "composition",
        compositionId: "imported_main",
      }),
    },
  ]);
  assert.equal(
    p.compositions.imported_main.elements.find((e) => e.id === "cardsInstance")!
      .compositionId,
    "imported_cards",
  );
  assert.ok(
    sampleComposition(p, "main", 0.7)["main/instance/cardsInstance/strip"],
  );
});
test("分组、复制与删除覆盖子层，解组保持静态坐标", () => {
  let p = blankProject();
  p = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({ id: "a", type: "shape", x: 100 }),
    },
    {
      type: "element.group",
      compositionId: "main",
      elementIds: ["a"],
      groupId: "g",
    },
    {
      type: "element.update",
      compositionId: "main",
      elementId: "g",
      patch: { x: 50 },
    },
  ]);
  p = applyCommands(p, [
    {
      type: "element.duplicate",
      compositionId: "main",
      elementId: "g",
      newId: "g2",
    },
  ]);
  assert.equal(p.compositions.main.elements.length, 4);
  p = applyCommands(p, [
    { type: "element.delete", compositionId: "main", elementId: "g2" },
    { type: "element.ungroup", compositionId: "main", elementId: "g" },
  ]);
  assert.equal(p.compositions.main.elements.length, 1);
  assert.equal(p.compositions.main.elements[0].x, 150);
});
test("属性编辑落到当前关键帧，与画布和 Agent 命令一致", () => {
  const p = exampleProject();
  const title = p.compositions.main.elements.find((e) => e.id === "title")!;
  const commands = propertyCommands(p, "main", title, 0.5, { y: 678 }, false);
  assert.equal(commands[0].type, "keyframe.set");
  const next = applyCommands(p, commands);
  assert.equal(sampleComposition(next, "main", 0.5)["main/title"].y, 678);
});
test("关键帧移动/复制、重复位置与不透明度范围校验", () => {
  let p = blankProject();
  p = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({ id: "a", type: "shape" }),
    },
    {
      type: "keyframe.set",
      compositionId: "main",
      elementId: "a",
      property: "x",
      keyframe: { id: "k", at: 0.2, value: 100, easing: "linear" },
    },
  ]);
  p = applyCommands(p, [
    {
      type: "keyframe.set",
      compositionId: "main",
      elementId: "a",
      property: "x",
      keyframe: { id: "k", at: 0.4, value: 100, easing: "linear" },
    },
  ]);
  assert.equal(p.compositions.main.elements[0].tracks.x!.length, 1);
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "keyframe.set",
          compositionId: "main",
          elementId: "a",
          property: "x",
          keyframe: { id: "copy", at: 0.4, value: 200, easing: "linear" },
        },
      ]),
    /重复/,
  );
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "keyframe.set",
          compositionId: "main",
          elementId: "a",
          property: "opacity",
          keyframe: { id: "k", at: 0.4, value: 2, easing: "linear" },
        },
      ]),
    /透明度/,
  );
});
test("依赖 Motion 的贝塞尔插值边界正确", () => {
  const keys: any = [
    { id: "a", at: 0, value: 0, easing: [0.42, 0, 0.58, 1] },
    { id: "b", at: 1, value: 100, easing: "linear" },
  ];
  assert.equal(sampleTrack(keys, -1, 999), 0);
  assert.ok(Math.abs(sampleTrack(keys, 0.5, 999) - 50) < 0.1);
  assert.equal(sampleTrack(keys, 2, 999), 100);
});
test("仅允许可打包栅格素材和安全链接，不接受绝对路径或脚本协议", () => {
  const p = exampleProject();
  const broken = clone(p);
  (broken.assets as any).a = {
    id: "a",
    name: "image",
    mime: "image/png",
    data: "C:/secret.png",
  };
  assert.throws(() => validateProject(broken), /内嵌/);
  assert.throws(() =>
    createElement({ type: "text", href: "javascript:alert(1)" }),
  );
  assert.throws(() => createElement({ type: "shape", id: "__proto__" }));
});
test("自带预制走公开扩展命令接口，并可单次撤销", () => {
  for (const preset of presets.values()) {
    const store = new ProjectStore(blankProject());
    const commands = preset.build({
      project: store.project,
      compositionId: "main",
      options: {},
    });
    store.commit(commands, 0);
    assert.ok(store.project.compositions.main.elements.length);
    store.undo(1);
    assert.equal(store.project.compositions.main.elements.length, 0);
  }
});
test("导出脚本和素材内嵌，恶意文字无法终止 JSON script 标签", async () => {
  const p = exampleProject();
  p.name = "</title><script>alert(1)</script>";
  p.compositions.main.elements[0].text = "</script><script>alert(2)</script>";
  const html = await exportHTML(p);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("sw-project"));
  assert.ok(!html.includes("<script src="));
  assert.ok(!html.includes("<script>alert(2)"));
  assert.ok(html.includes("\\u003c/script>"));
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  blankProject,
  createElement,
  validateProject,
  assetSchema,
  clone,
  properties,
} from "../src/core/model";
import {
  applyCommands,
  ProjectStore,
  ConflictError,
} from "../src/core/commands";
import {
  sampleElement,
  sampleComposition,
  globalTime,
  parentTime,
  sourceTime,
} from "../src/core/evaluate";
import { sampleComposition as legacySample } from "../src/core/legacy-evaluate";
import { validateProject as validateLegacy } from "../src/core/legacy-model";
import { migrateProject } from "../src/core/migrate";
import { clipWindow } from "../src/core/timing";
import { readKeys, moveKeys, pasteKeys } from "../src/core/keyframes";
import { sanitizeSVG } from "../server/assets";
import { exportHTML } from "../server/export";
import "../src/extensions/builtins";
const approximate = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
function populated() {
  const p = blankProject();
  p.compositions.main.elements.push(
    createElement({
      id: "a",
      name: "A",
      type: "shape",
      start: 2,
      end: 8,
      tracks: {
        x: [
          { id: "x0", at: 0, value: 10, easing: "linear" },
          { id: "x1", at: 6, value: 610, easing: "linear" },
        ],
      },
    }),
  );
  return validateProject(p);
}
const at = (p: ReturnType<typeof blankProject>, id = "a") =>
  p.compositions.main.elements.find((e) => e.id === id)!;
test("v1 migration preserves nested curves and source clocks at 201 positions", () => {
  const old = validateLegacy(
      JSON.parse(fs.readFileSync("examples/form.scrollweave.json", "utf8")),
    ),
    p = migrateProject(old);
  assert.equal(p.version, 2);
  assert.equal(p.compositions.main.duration, 12);
  for (const cid of Object.keys(old.compositions))
    for (let i = 0; i <= 200; i++) {
      const before = legacySample(old, cid, i / 200),
        after = sampleComposition(p, cid, (i / 200) * 12);
      for (const [path, v] of Object.entries(before))
        for (const property of properties)
          approximate(v[property], after[path][property]);
    }
  assert.equal(Object.keys(p.assets).length, Object.keys(old.assets).length);
  assert.deepEqual(migrateProject(p), p);
});
test("v1 trim and hold convert to explicit support, never infer opacity", () => {
  const raw = JSON.parse(
    fs.readFileSync("examples/form.scrollweave.json", "utf8"),
  );
  const p = validateLegacy(raw),
    c = p.compositions.main;
  const e = c.elements[0];
  e.start = 0.2;
  e.end = 0.7;
  e.timeOffset = 0.1;
  e.trim = { start: 0.35, end: 0.8 };
  const next = migrateProject(p),
    m = next.compositions.main.elements[0];
  approximate(m.start, 4.2);
  approximate(m.end, 9.6);
  for (const t of [0.4, 0.5, 0.65, 0.79]) {
    const before = legacySample(p, "main", t),
      after = sampleComposition(next, "main", t * 12);
    for (const property of properties)
      approximate(
        before["main/" + e.id][property],
        after["main/" + e.id][property],
      );
  }
  assert.deepEqual(
    clipWindow(
      createElement({
        type: "shape",
        start: 0,
        end: 9,
        tracks: { opacity: [{ id: "k", at: 5, value: 0, easing: "linear" }] },
      }),
    ),
    { start: 0, end: 9 },
  );
});
test("moving, left/right trims and splits retain source continuity and independent keys", () => {
  const p = populated(),
    original = sampleElement(at(p), 5);
  const moved = applyCommands(p, [
    { type: "element.move", compositionId: "main", elementId: "a", delta: 20 },
  ]);
  approximate(sampleElement(at(moved), 25).x, original.x);
  assert.equal(moved.compositions.main.duration, 28);
  assert.deepEqual(at(moved).tracks, at(p).tracks);
  const cut = applyCommands(p, [
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "a",
      start: 4,
      end: 7,
    },
  ]);
  assert.equal(at(cut).sourceIn, 2);
  approximate(sampleElement(at(cut), 5).x, original.x);
  const split = applyCommands(cut, [
    {
      type: "element.split",
      compositionId: "main",
      elementId: "a",
      at: 5,
      newId: "b",
    },
  ]);
  assert.equal(at(split, "b").sourceIn, 3);
  approximate(sampleElement(at(split, "b"), 6).x, sampleElement(at(p), 6).x);
  const edited = applyCommands(split, [
    {
      type: "keyframe.set",
      compositionId: "main",
      elementId: "b",
      property: "x",
      keyframe: { id: "x0", at: 0, value: 500, easing: "linear" },
    },
  ]);
  assert.equal(at(edited).tracks.x![0].value, 10);
  const deleted = applyCommands(edited, [
    { type: "element.delete", compositionId: "main", elementId: "a" },
  ]);
  assert.equal(deleted.compositions.main.elements.length, 1);
});
test("transactions reject collisions and invalid source ranges without partial commit", () => {
  const store = new ProjectStore(populated()),
    before = clone(store.snapshot());
  assert.throws(
    () =>
      store.commit(
        [
          {
            type: "element.update",
            compositionId: "main",
            elementId: "a",
            patch: { name: "changed" },
          },
          {
            type: "element.add",
            compositionId: "main",
            element: createElement({ type: "text", start: 4, end: 6 }),
          },
        ],
        0,
      ),
    /目标轨道/,
  );
  assert.deepEqual(store.snapshot(), before);
  assert.throws(() =>
    store.commit(
      [
        {
          type: "element.move",
          compositionId: "main",
          elementId: "a",
          delta: -3,
        },
      ],
      0,
    ),
  );
  assert.equal(store.revision, 0);
  const p = blankProject();
  p.assets.v = assetSchema.parse({
    id: "v",
    name: "v.mp4",
    kind: "video",
    mime: "video/mp4",
    path: "assets/v.mp4",
    duration: 8,
    width: 640,
    height: 360,
  });
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "clip.insert",
          compositionId: "main",
          assetId: "v",
          trackId: "track_main",
          at: 0,
          duration: 9,
        },
      ]),
    /真实时长/,
  );
  const valid = applyCommands(p, [
    {
      type: "clip.insert",
      compositionId: "main",
      assetId: "v",
      trackId: "track_main",
      at: 30,
      newId: "v1",
    },
  ]);
  assert.equal(at(valid, "v1").end, 38);
  assert.equal(valid.compositions.main.duration, 38);
});
test("insert and overwrite preserve displaced and surviving source intervals", () => {
  const p = populated(),
    clip = createElement({ id: "b", type: "text", start: 4, end: 5 });
  const inserted = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: clip,
      mode: "insert",
    },
  ]);
  const right = inserted.compositions.main.elements.find((e) =>
    e.name.includes("后段"),
  )!;
  assert.equal(at(inserted).end, 4);
  assert.equal(right.start, 5);
  assert.equal(right.end, 9);
  assert.equal(right.sourceIn, 2);
  approximate(sampleElement(right, 6).x, sampleElement(at(p), 5).x);
  const overwritten = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: clip,
      mode: "overwrite",
    },
  ]);
  const tail = overwritten.compositions.main.elements.find((e) =>
    e.name.includes("后段"),
  )!;
  assert.equal(tail.start, 5);
  assert.equal(tail.sourceIn, 3);
  approximate(sampleElement(tail, 6).x, sampleElement(at(p), 6).x);
});
test("multi move/delete, ripple union and linked overlap rejection", () => {
  let p = populated();
  p = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({ id: "b", type: "shape", start: 9, end: 12 }),
    },
    {
      type: "track.add",
      compositionId: "main",
      track: { id: "upper", name: "上层" },
    },
  ]);
  const moved = applyCommands(p, [
    {
      type: "clips.move",
      compositionId: "main",
      elementIds: ["a", "b"],
      delta: 3,
      trackOffset: 1,
    },
  ]);
  assert.equal(at(moved).trackId, "upper");
  assert.equal(at(moved, "b").start, 12);
  const regular = applyCommands(p, [
    { type: "clips.delete", compositionId: "main", elementIds: ["a"] },
  ]);
  assert.equal(at(regular, "b").start, 9);
  const ripple = applyCommands(p, [
    {
      type: "clips.delete",
      compositionId: "main",
      elementIds: ["a"],
      ripple: true,
    },
  ]);
  assert.equal(at(ripple, "b").start, 3);
  p = applyCommands(p, [
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({
        id: "overlay",
        type: "shape",
        trackId: "upper",
        start: 1,
        end: 6,
      }),
    },
  ]);
  assert.throws(
    () =>
      applyCommands(p, [
        {
          type: "clips.delete",
          compositionId: "main",
          elementIds: ["a"],
          ripple: true,
          linked: true,
        },
      ]),
    /穿过/,
  );
  const all = applyCommands(p, [
    {
      type: "clips.delete",
      compositionId: "main",
      elementIds: ["a", "b", "overlay"],
    },
  ]);
  assert.equal(all.compositions.main.elements.length, 0);
});
test("update patches do not apply defaults, locked tracks reject every selected clip", () => {
  const p = applyCommands(populated(), [
    {
      type: "element.update",
      compositionId: "main",
      elementId: "a",
      patch: { name: "Renamed" },
    },
  ]);
  assert.equal(at(p).start, 2);
  assert.equal(at(p).end, 8);
  const locked = applyCommands(p, [
    {
      type: "track.update",
      compositionId: "main",
      trackId: "track_main",
      patch: { locked: true },
    },
  ]);
  for (const command of [
    { type: "element.delete", compositionId: "main", elementId: "a" },
    { type: "clips.move", compositionId: "main", elementIds: ["a"], delta: 1 },
    {
      type: "keyframe.delete",
      compositionId: "main",
      elementId: "a",
      property: "x",
      keyframeId: "x0",
    },
  ])
    assert.throws(() => applyCommands(locked, [command]), /锁定/);
});
test("compound preserves nesting; shared content and independent recursive copies differ", () => {
  let p = applyCommands(populated(), [
    {
      type: "track.add",
      compositionId: "main",
      track: { id: "upper", name: "文字" },
    },
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({
        id: "b",
        type: "text",
        trackId: "upper",
        start: 3,
        end: 6,
        x: 20,
      }),
    },
  ]);
  const before = sampleElement(at(p), 5).x;
  p = applyCommands(p, [
    {
      type: "compound.create",
      compositionId: "main",
      elementIds: ["a", "b"],
      newId: "sub",
      name: "复合",
    },
  ]);
  const wrapper = p.compositions.main.elements[0];
  assert.equal(wrapper.start, 2);
  assert.equal(wrapper.end, 8);
  assert.equal(p.compositions.sub.elements.find((e) => e.id === "b")!.start, 1);
  const result = sampleComposition(p, "main", 5);
  approximate(result["main/" + wrapper.id + "/a"].x, before);
  p = applyCommands(p, [
    {
      type: "element.duplicate",
      compositionId: "main",
      elementId: wrapper.id,
      newId: "copy",
    },
  ]);
  assert.equal(at(p, "copy").compositionId, "sub");
  p = applyCommands(p, [
    { type: "compound.independent", compositionId: "main", elementId: "copy" },
  ]);
  assert.notEqual(at(p, "copy").compositionId, "sub");
  p = applyCommands(p, [
    {
      type: "element.update",
      compositionId: "sub",
      elementId: "b",
      patch: { text: "shared" },
    },
  ]);
  assert.equal(
    p.compositions[at(p, "copy").compositionId!].elements.find(
      (e) => e.id === "b",
    )!.text,
    "",
  );
});
test("external asset overlays survive undo/redo and persistence rollback", () => {
  const store = new ProjectStore(populated()),
    asset = assetSchema.parse({
      id: "svg",
      name: "arrow.svg",
      kind: "svg",
      mime: "image/svg+xml",
      path: "assets/arrow.svg",
      hash: "first",
    });
  store.syncAsset(asset);
  store.commit(
    [{ type: "element.move", compositionId: "main", elementId: "a", delta: 3 }],
    1,
  );
  store.syncAsset({ ...asset, hash: "second" });
  store.undo(3);
  assert.equal(at(store.project).start, 2);
  assert.equal(store.project.assets.svg.hash, "second");
  store.redo(4);
  assert.equal(at(store.project).start, 5);
  const before = clone(store.snapshot());
  assert.throws(
    () =>
      store.withPersistence(
        () =>
          store.commit(
            [{ type: "element.delete", compositionId: "main", elementId: "a" }],
            5,
          ),
        () => {
          throw Error("disk full");
        },
      ),
    /disk full/,
  );
  assert.deepEqual(store.snapshot(), before);
  assert.throws(() => store.undo(0), ConflictError);
});
test("keyframe coordinates stay in source seconds for moved/cut/rate-changed clips", () => {
  let p = populated();
  p = applyCommands(p, [
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "a",
      start: 3,
      end: 8,
    },
    { type: "clip.speed", compositionId: "main", elementId: "a", speed: 2 },
  ]);
  const e = at(p),
    ref = { elementId: "a", property: "x" as const, keyframeId: "x1" };
  approximate(globalTime(p, "main", e, 6), 5.5);
  const copied = readKeys(p, "main", [ref]);
  approximate(copied[0].position, 5.5);
  const moved = applyCommands(p, moveKeys(p, "main", [ref], -0.5));
  assert.equal(at(moved).tracks.x![1].at, 5);
  const pasted = applyCommands(p, pasteKeys(p, "main", copied, 4, ["a"]));
  assert.ok(at(pasted).tracks.x!.some((k) => k.at === 3));
  approximate(sourceTime(e, parentTime(p, "main", e, 4)), 3);
});
test("SVG retains vectors/local gradients and strips active/external content", () => {
  const raw =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40" onload="alert(1)"><script>alert(1)</script><style>path{fill:red}</style><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0L80 40" fill="url(#g)"/><use href="https://example.com/x.svg#s"/><image href="https://example.com/track.png"/><foreignObject><div>bad</div></foreignObject><animate attributeName="x"/></svg>';
  const result = sanitizeSVG(raw),
    text = result.bytes.toString();
  assert.equal(result.width, 80);
  assert.equal(result.height, 40);
  assert.match(text, /<path/);
  assert.match(text, /url\(#g\)/);
  assert.doesNotMatch(
    text,
    /script|onload|https:|foreignObject|animate|<style/,
  );
  assert.ok(result.warnings.length);
  assert.throws(() => sanitizeSVG("<svg><path"), /格式|写完/);
  assert.throws(() => sanitizeSVG("<!DOCTYPE svg><svg/>"), /DTD/);
});
test("unsafe paths, references, cycles and duplicate keys are rejected", () => {
  assert.throws(() =>
    assetSchema.parse({
      id: "a",
      name: "a",
      kind: "image",
      mime: "image/png",
      path: "assets/../../private",
    }),
  );
  const p = populated();
  p.compositions.main.elements[0].tracks.x!.push({
    id: "duplicate",
    at: 0,
    value: 2,
    easing: "linear",
  });
  assert.throws(() => validateProject(p), /关键帧/);
  const cyclic = blankProject();
  cyclic.compositions.main.elements.push(
    createElement({ type: "composition", compositionId: "main" }),
  );
  assert.throws(() => validateProject(cyclic), /循环/);
});
test("HTML uses escaped project data and bundles the same runtime", async () => {
  const p = populated();
  p.name = "</script><script>alert(1)</script>";
  const html = await exportHTML(p);
  assert.match(html, /ScrollWeave 0.2.0/);
  assert.match(html, /\\u003c\/script/);
  assert.doesNotMatch(html, /<title><\/script>/);
  assert.match(html, /sw-project/);
});

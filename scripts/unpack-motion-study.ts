import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  clone,
  properties,
  validateProject,
  type Element,
  type Keyframe,
  type Project,
} from "../src/core/model";
import {
  elementRange,
  parentTime,
  sampleElement,
  sampleTrack,
} from "../src/core/evaluate";

const client = new Client({ name: "unpack-motion-study", version: "1.0.0" });
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError || !Array.isArray(r.content))
    throw Error(JSON.stringify(r.content));
  return JSON.parse(r.content.find((item) => item.type === "text").text);
}
type Values = Pick<Element, (typeof properties)[number]>;
type Matrix = [number, number, number, number, number, number];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transform(v: Values): Matrix {
  const r = (v.rotation * Math.PI) / 180;
  return [
    Math.cos(r) * v.scaleX,
    Math.sin(r) * v.scaleX,
    -Math.sin(r) * v.scaleY,
    Math.cos(r) * v.scaleY,
    v.x,
    v.y,
  ];
}
function world(
  project: Project,
  cid: string,
  element: Element,
  time: number,
): Values {
  const chain: Element[] = [element];
  while (chain[0].parentId)
    chain.unshift(
      project.compositions[cid].elements.find(
        (e) => e.id === chain[0].parentId,
      )!,
    );
  let matrix: Matrix = [1, 0, 0, 1, 0, 0],
    opacity = 1,
    rotation = 0,
    local = time;
  for (const node of chain) {
    const v = sampleElement(node, local);
    matrix = multiply(matrix, transform(v));
    opacity *= v.opacity;
    rotation += v.rotation;
    local = v.progress;
  }
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const scaleY = (matrix[0] * matrix[3] - matrix[1] * matrix[2]) / scaleX;
  assert.ok(
    Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) < 1e-5,
    "Cannot flatten a skewed transform into editable scale/rotation",
  );
  return { x: matrix[4], y: matrix[5], scaleX, scaleY, rotation, opacity };
}
function simplify(samples: [number, number][], tolerance: number): Keyframe[] {
  const keep = new Set([0, samples.length - 1]);
  function visit(first: number, last: number) {
    const [t0, v0] = samples[first],
      [t1, v1] = samples[last];
    let worst = tolerance,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const [t, v] = samples[i],
        error = Math.abs(v - (v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)));
      if (error > worst) {
        worst = error;
        index = i;
      }
    }
    if (index !== -1) {
      keep.add(index);
      visit(first, index);
      visit(index, last);
    }
  }
  visit(0, samples.length - 1);
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => ({
      id: `flat_${i}`,
      at: samples[i][0],
      value: samples[i][1],
      easing: "linear",
    }));
}

await client.connect(
  new StreamableHTTPClientTransport(new URL("http://127.0.0.1:4100/mcp")),
);
try {
  const original = await call("read_project"),
    project: Project = clone(original.project);
  assert.equal(project.name, "SIGNAL / MOTION · 流动研究");
  const main = project.compositions.main;
  assert.equal(
    main.elements.length,
    4,
    "Unpacking expects the four original scene clips",
  );
  assert.ok(
    main.elements.every(
      (e) =>
        e.type === "composition" &&
        e.speed === 1 &&
        e.sourceIn === 0 &&
        e.x === 0 &&
        e.y === 0 &&
        e.scaleX === 1 &&
        e.scaleY === 1 &&
        e.rotation === 0,
    ),
  );
  const backup = await call("save_project", {
    filename: "motion-study-before-unpack",
    expectedRevision: original.revision,
  });
  const output: Element[] = [];
  const tolerances: Values = {
    x: 0.15,
    y: 0.15,
    rotation: 0.04,
    scaleX: 0.0004,
    scaleY: 0.0004,
    opacity: 0.001,
  };
  const tests: {
    source: Element;
    cid: string;
    target: Element;
    offset: number;
  }[] = [];
  let maxTrack = 0;
  for (const scene of main.elements) {
    const c = project.compositions[scene.compositionId!];
    const ordered: Element[] = [];
    function walk(parent: string | null) {
      const rank = new Map(c.tracks.map((t, i) => [t.id, i]));
      c.elements
        .filter((e) => e.parentId === parent)
        .sort((a, b) => rank.get(a.trackId)! - rank.get(b.trackId)!)
        .forEach((e) => {
          if (e.type === "group") walk(e.id);
          else ordered.push(e);
        });
    }
    walk(null);
    // Keep the recurring footer below the artwork, and editable headings above it.
    // These non-overlapping regions can be reordered without changing the image.
    const chrome = new Set([
      "页眉标记",
      "标识",
      "期号",
      "页脚基线",
      "全片进度",
      "章节号",
      "章节说明",
      "时长标记",
    ]);
    const priority = (e: Element) =>
      e.name === "空间网格"
        ? 0
        : chrome.has(e.name)
          ? 1
          : /接续擦入|连续擦出/.test(e.name)
            ? 4
            : !e.parentId && e.type === "text"
              ? 3
              : 2;
    ordered.sort((a, b) => priority(a) - priority(b));
    let lane = 0;
    for (const source of ordered) {
      assert.notEqual(source.type, "composition");
      const range = elementRange(project, c.id, source);
      const flat = clone(source);
      flat.parentId = null;
      flat.start = scene.start + range.start;
      flat.end = scene.start + Math.min(c.duration, range.end);
      flat.trackId = `layer_${++lane}`;
      // The media source time is unchanged. Parent transforms are converted into
      // normal position/rotation/scale/opacity keys, never a rendered movie.
      if (source.parentId) {
        assert.equal(source.speed, 1);
        const startSource = sampleElement(
          source,
          parentTime(project, c.id, source, range.start),
        ).progress;
        flat.sourceIn = startSource;
        const length = flat.end - flat.start;
        const count = Math.ceil(length * 180);
        const samples = Array.from({ length: count + 1 }, (_, i) => {
          const t = Math.min(length, i / 180);
          return {
            at: startSource + t,
            values: world(project, c.id, source, range.start + t),
          };
        });
        flat.tracks = {};
        for (const prop of properties) {
          flat[prop] = samples[0].values[prop];
          const values = samples.map(
            (s) => [s.at, s.values[prop]] as [number, number],
          );
          if (values.some(([, v]) => Math.abs(v - flat[prop]) > 1e-8))
            flat.tracks[prop] = simplify(values, tolerances[prop] * 0.5);
        }
        tests.push({ source, cid: c.id, target: flat, offset: scene.start });
      }
      output.push(flat);
    }
    maxTrack = Math.max(maxTrack, lane);
  }
  // Pack disjoint clips in each lane; there is never one lane per source asset.
  // Align heading/wipe rows at the top, and share lower rows between scenes.
  const sceneEnds = [7, 15, 23, 30];
  for (let index = 0; index < 4; index++) {
    const start = index ? sceneEnds[index - 1] : 0;
    const sceneElements = output.filter(
      (e) => e.start >= start && e.end <= sceneEnds[index],
    );
    const offset = maxTrack - sceneElements.length;
    for (const e of sceneElements)
      e.trackId = `layer_${Number(e.trackId.slice(6)) + offset}`;
  }
  for (const { source, cid, target, offset } of tests) {
    for (let t = target.start; t <= target.end; t += 1 / 90) {
      const before = world(project, cid, source, t - offset),
        after = sampleElement(target, t);
      for (const prop of properties)
        assert.ok(
          Math.abs(before[prop] - after[prop]) <= tolerances[prop] * 1.2 + 1e-5,
          `${source.name} ${prop} deviated at ${t}: ${before[prop]} -> ${after[prop]}`,
        );
    }
  }
  main.elements = output;
  main.tracks = Array.from({ length: maxTrack }, (_, i) => ({
    id: `layer_${i + 1}`,
    name: `轨道 ${i + 1}`,
    locked: false,
    hidden: false,
  }));
  project.compositions = { main };
  project.assets = Object.fromEntries(
    Object.entries(project.assets).filter(([, a]) => a.kind !== "composition"),
  );
  const result = validateProject(project);
  for (const track of main.tracks) {
    const clips = main.elements
      .filter((e) => e.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length; i++)
      assert.ok(
        clips[i].start >= clips[i - 1].end - 1e-6,
        "Timeline collision",
      );
  }
  assert.ok(
    main.elements.every(
      (e) => !e.parentId && e.type !== "composition" && e.type !== "group",
    ),
  );
  await call("edit_project", {
    expectedRevision: original.revision,
    label: "展开四幕 · 每个元素直接在主时间线编辑",
    commands: [{ type: "project.replace", project: result }],
  });
  const title = main.elements.find((e) => e.text === "MOTION.")!;
  await call("set_selection", {
    compositionId: "main",
    elementIds: [title.id],
  });
  await call("set_preview", { compositionId: "main", progress: 2.8 });
  const verification = await call("validate_project");
  const saved = await call("save_project", {
    filename: "signal-motion-study-editable-layers",
    expectedRevision: verification.revision,
  });
  const report = {
    tracks: main.tracks.length,
    elements: main.elements.length,
    compounds: 0,
    groups: 0,
    transformedElements: tests.length,
    tolerances,
    backup: backup.package,
    package: saved.package,
    verification,
  };
  await fs.writeFile(
    "test-results/motion-study/unpacked.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}

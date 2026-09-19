import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { unzipSync } from "fflate";
import { EditorService } from "../server/service";
import { sampleComposition } from "../src/core/evaluate";
import { blankProject, assetSchema, createElement } from "../src/core/model";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48"><path d="M0 0L32 24L0 48Z" fill="#c4f36b"/></svg>';
test(
  "cold portable folder regenerates safe media cache; independent directory export and atomic migration backup",
  { timeout: 30000 },
  async () => {
    const first = await fs.mkdtemp(
      path.join(os.tmpdir(), "scrollweave-source-"),
    );
    let service = await EditorService.open(first, 4109);
    try {
      await fs.writeFile(path.join(first, "assets", "arrow.svg"), svg);
      const asset = await service.assets.waitFor({
        name: "arrow.svg",
        timeoutMs: 10000,
      });
      await service.run("insert_asset", {
        expectedRevision: service.store.revision,
        compositionId: "main",
        assetId: asset.id,
        trackId: "track_main",
        at: 3,
        duration: 2,
      });
      const saved = await service.run("save_project", {
          expectedRevision: service.store.revision,
          filename: "portable",
        }),
        archive = unzipSync(await fs.readFile(saved.package)),
        second = await fs.mkdtemp(
          path.join(os.tmpdir(), "scrollweave-restored-"),
        );
      for (const [name, bytes] of Object.entries(archive)) {
        const file = path.join(second, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
      }
      const before = service.store.project;
      await service.close();
      service = await EditorService.open(second, 4109);
      assert.equal(
        service.store.project.compositions.main.elements[0].assetId,
        asset.id,
      );
      assert.equal(service.store.project.assets[asset.id].status, "ready");
      assert.ok(service.store.project.assets[asset.id].cachePath);
      assert.deepEqual(
        sampleComposition(service.store.project, "main", 4),
        sampleComposition(before, "main", 4),
      );
      const exported = await service.run("export_html", {
        expectedRevision: service.store.revision,
        filename: "restored",
      });
      assert.equal(exported.format, "独立单文件 HTML");
      assert.ok(
        (await fs.readFile(exported.path, "utf8")).includes(
          "data:image/svg+xml;base64,",
        ),
      );
      const legacy = await fs.readFile("examples/form.scrollweave.json");
      const third = await fs.mkdtemp(
        path.join(os.tmpdir(), "scrollweave-legacy-"),
      );
      await fs.writeFile(path.join(third, "workspace.json"), legacy);
      await service.close();
      service = await EditorService.open(third, 4109);
      assert.equal(service.store.project.version, 2);
      assert.equal(service.store.project.migration?.secondsPerComposition, 12);
      const backup = (await fs.readdir(third)).find(
        (name) => name.includes(".v1-") && name.endsWith(".bak"),
      );
      assert.ok(backup);
      assert.deepEqual(await fs.readFile(path.join(third, backup)), legacy);
      assert.deepEqual(
        await fs.readFile(path.join(third, "workspace.json")),
        legacy,
      );
    } finally {
      await service.close();
    }
  },
);
test(
  "subproject imports keep one watched asset identity, so later source edits reach compound content",
  { timeout: 20000 },
  async () => {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "scrollweave-subproject-"),
      ),
      service = await EditorService.open(directory, 4111);
    try {
      const incoming = blankProject();
      incoming.assets.arrow = assetSchema.parse({
        id: "arrow",
        name: "arrow.svg",
        kind: "svg",
        mime: "image/svg+xml",
        data:
          "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      });
      incoming.compositions.main.elements.push(
        createElement({ id: "arrow-clip", type: "svg", assetId: "arrow" }),
      );
      await service.importProject(Buffer.from(JSON.stringify(incoming)), true);
      const imported = Object.values(service.store.project.compositions).find(
          (c) => c.id !== "main",
        )!,
        clip = imported.elements[0],
        asset = service.store.project.assets[clip.assetId!];
      assert.equal(
        Object.values(service.store.project.assets).filter(
          (a) => a.path === asset.path,
        ).length,
        1,
      );
      await fs.writeFile(
        path.join(directory, asset.path!),
        svg.replace("#c4f36b", "#abcdef"),
      );
      const deadline = Date.now() + 10000;
      while (
        Date.now() < deadline &&
        service.store.project.assets[asset.id].hash === asset.hash
      )
        await new Promise((r) => setTimeout(r, 100));
      assert.notEqual(
        service.store.project.assets[clip.assetId!].hash,
        asset.hash,
      );
      assert.equal(imported.elements[0].start, 0);
    } finally {
      await service.close();
    }
  },
);
test(
  "unused invalid material cannot break editing or export; names do not overwrite original files",
  { timeout: 20000 },
  async () => {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "scrollweave-assets-"),
      ),
      service = await EditorService.open(directory, 4110);
    try {
      const a = await service.assets.importBuffer("icon.svg", Buffer.from(svg)),
        b = await service.assets.importBuffer(
          "icon.svg",
          Buffer.from(svg.replace("#c4f36b", "#ffffff")),
        );
      assert.ok(a && b);
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.path, b.path);
      assert.equal(
        await fs.readFile(path.join(directory, a.path!), "utf8"),
        svg,
      );
      const bad = await service.assets.importBuffer(
        "broken.svg",
        Buffer.from("<svg><"),
      );
      assert.equal(bad?.status, "error");
      await service.run("insert_asset", {
        expectedRevision: service.store.revision,
        compositionId: "main",
        assetId: a.id,
        trackId: "track_main",
        at: 0,
      });
      const saved = await service.run("save_project", {
        expectedRevision: service.store.revision,
        filename: "valid",
      });
      assert.ok(saved.warnings[0].includes("broken.svg"));
      const exported = await service.run("export_html", {
        expectedRevision: service.store.revision,
        filename: "valid",
      });
      assert.equal(exported.format, "独立单文件 HTML");
      const refs = await service.run("inspect_asset", { assetId: a.id });
      assert.equal(refs.references.length, 1);
      await assert.rejects(
        service.run("archive_asset", {
          expectedRevision: service.store.revision,
          assetId: a.id,
        }),
        /使用/,
      );
      await assert.rejects(
        service.assets.importBuffer(
          "bad-relink.svg",
          Buffer.from("<svg><"),
          a.id,
        ),
        /写完|格式/,
      );
      assert.equal(service.store.project.assets[a.id].hash, a.hash);
    } finally {
      await service.close();
    }
  },
);

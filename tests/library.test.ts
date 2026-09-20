import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectLibrary } from "../server/library";
import { EditorService } from "../server/service";
import { blankProject } from "../src/core/model";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrollweave-library-"));
  const library = new ProjectLibrary(
    path.join(root, "registry.json"),
    path.join(root, "projects"),
  );
  fs.mkdirSync(library.defaultDirectory);
  const create = (folder: string, name = folder) => {
    const directory = path.join(library.defaultDirectory, folder);
    fs.mkdirSync(directory, { recursive: true });
    const project = blankProject();
    project.name = name;
    fs.writeFileSync(
      path.join(directory, "project.scrollweave.json"),
      JSON.stringify({ project, revision: 3 }),
    );
    return directory;
  };
  return { root, library, create };
}

test("project registry persists favorites, de-duplicates directories, and removes registrations without files", () => {
  const { library, create } = setup();
  const first = create("first"),
    second = create("second");
  const firstId = library.remember(first, "first");
  assert.equal(library.remember(path.join(first, "."), "first"), firstId);
  library.remember(second, "second");
  library.patch(firstId, { favorite: true });
  const reopened = new ProjectLibrary(library.file, library.defaultDirectory);
  assert.equal(reopened.list(second).length, 2);
  assert.equal(
    reopened.list(second).find((p) => p.id === firstId)?.favorite,
    true,
  );
  reopened.patch(firstId, { hidden: true });
  reopened.remember(first, "first", false); // Startup must not resurrect removed entries.
  assert.equal(reopened.list(second).length, 1);
  assert.ok(fs.existsSync(path.join(first, "project.scrollweave.json")));
  assert.equal(reopened.remember(first, "first"), firstId);
  assert.equal(
    reopened.list(first).find((p) => p.id === firstId)?.active,
    true,
  );
  assert.equal(
    reopened.list(first).find((p) => p.id === firstId)?.favorite,
    true,
  );
});

test("missing and malformed projects remain visible; a damaged registry is never overwritten", () => {
  const { root, library, create } = setup();
  const first = create("moved"),
    broken = create("broken");
  const id = library.remember(first, "Saved title");
  library.remember(broken, "Broken title");
  const source = path.join(first, "project.scrollweave.json");
  fs.renameSync(source, path.join(first, "saved.backup"));
  fs.writeFileSync(path.join(broken, "project.scrollweave.json"), "{");
  const entries = library.list(root);
  assert.equal(library.startupDirectory(), undefined);
  assert.equal(entries.find((p) => p.id === id)?.status, "missing");
  assert.equal(
    entries.find((p) => p.name === "Broken title")?.status,
    "invalid",
  );
  fs.writeFileSync(library.file, "original broken registry");
  assert.throws(() => library.remember(first, "Changed"), /原文件已保留/);
  assert.equal(
    fs.readFileSync(library.file, "utf8"),
    "original broken registry",
  );
});

test("directory browser lists one level only; new project folders reject collisions and unsafe names", async () => {
  const { library, create } = setup();
  const first = create("visible");
  fs.mkdirSync(path.join(first, "nested"));
  fs.mkdirSync(path.join(library.defaultDirectory, ".hidden"));
  const listing = await library.browse();
  assert.deepEqual(
    listing.folders.map((f) => f.name),
    ["visible"],
  );
  assert.equal(listing.folders[0].isProject, true);
  assert.equal(library.list(first).length, 0); // Browsing doesn't register folders.
  assert.throws(() => library.newDirectory("visible"), /已存在/);
  assert.throws(() => library.newDirectory("CON"), /有效/);
  assert.throws(() => library.newDirectory(".."), /有效/);
  assert.equal(
    path.dirname(library.newDirectory("safe/name")),
    library.defaultDirectory,
  );
  await assert.rejects(library.browse(path.join(first, "missing")));
});

test("closed project rename changes the actual file with revision checks and honors the process lock", async () => {
  const { library, create } = setup();
  const directory = create("rename");
  const id = library.remember(directory, "rename");
  EditorService.renameClosedProject(directory, "Renamed story", 3);
  const saved = JSON.parse(
    fs.readFileSync(path.join(directory, "project.scrollweave.json"), "utf8"),
  );
  assert.equal(saved.project.name, "Renamed story");
  assert.equal(saved.revision, 4);
  assert.equal(library.list(directory)[0].name, "Renamed story");
  assert.throws(() => EditorService.renameClosedProject(directory, "stale", 3));
  assert.equal(library.get(id).directory, directory);
  const service = await EditorService.open(directory, 4150);
  try {
    assert.throws(
      () => EditorService.renameClosedProject(directory, "locked", 4),
      /进程/,
    );
  } finally {
    await service.close();
  }
});

test("project cover reads cache thumbnails only and cannot traverse outside media cache", () => {
  const { root, library, create } = setup();
  const directory = create("cover"),
    id = library.remember(directory, "cover");
  const file = path.join(directory, "project.scrollweave.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const cache = path.join(directory, ".scrollweave", "media");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(root, "outside.png"), "secret test marker");
  saved.project.assets.image = {
    id: "image",
    name: "test.png",
    kind: "image",
    mime: "image/png",
    path: "assets/test.png",
    thumbnail: "../../../outside.png",
    status: "ready",
  };
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(library.list(directory)[0].status, "invalid");
  saved.project.assets.image.thumbnail = "thumb.png";
  fs.writeFileSync(path.join(cache, "thumb.png"), "synthetic thumbnail");
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(library.thumbnail(id), path.join(cache, "thumb.png"));
});

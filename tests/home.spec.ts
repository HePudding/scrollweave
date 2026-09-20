import { test, expect } from "@playwright/test";
import os from "node:os";

test("cancelling the OS picker leaves the active project untouched", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.route("**/api/directories/pick", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON().mode).toBe("open");
    await route.fulfill({ json: { directory: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  const after = await (await request.get("/api/state")).json();
  expect(after.project).toEqual(before.project);
  expect(after.revision).toBe(before.revision);
});

test("new project keeps its name on cancellation and uses the selected parent", async ({
  page,
  request,
}) => {
  const library = await (await request.get("/api/projects")).json();
  let selection: string | null = null;
  await page.route("**/api/directories/pick", async (route) => {
    expect(route.request().postDataJSON().mode).toBe("parent");
    await route.fulfill({ json: { directory: selection } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "新建项目 从空白时间线开始创作" })
    .click();
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("保留这个名字");
  await page.getByRole("button", { name: "更改保存位置" }).click();
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue("保留这个名字");
  await expect(
    page
      .getByRole("dialog")
      .getByText(library.defaultDirectory, { exact: true }),
  ).toBeVisible();
  selection = os.tmpdir();
  await page.getByRole("button", { name: "更改保存位置" }).click();
  await expect(
    page.getByRole("dialog").getByText(selection, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue("保留这个名字");
});

test("unavailable system picker offers a path fallback that opens the real project", async ({
  page,
  request,
}) => {
  const library = await (await request.get("/api/projects")).json();
  await page.route("**/api/directories/pick", (route) =>
    route.fulfill({ status: 400, json: { error: "系统选择器不可用" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("系统选择器不可用");
  await page
    .getByRole("textbox", { name: "文件夹路径" })
    .fill(library.activeDirectory);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await expect(page).toHaveURL(/\/editor$/);
  await expect(
    page.getByRole("button", { name: "返回项目主页" }),
  ).toBeVisible();
});

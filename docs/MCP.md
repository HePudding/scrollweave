# ScrollWeave 0.2 · MCP

编辑器运行后，Streamable HTTP 地址默认为 `http://127.0.0.1:4100/mcp`。实际作品目录与端口通过界面的“Agent 接入”、`workspace_info` 和作品内 `SCROLLWEAVE.md` 查询。它不是云服务；编辑器未运行时不可用。

## Codex 接入

```sh
codex mcp add scrollweave --url http://127.0.0.1:4100/mcp
```

本机 `codex mcp add --help` 已核对该语法。目录内 `.mcp.json` 是通用客户端配置示例；Codex 不会仅因它存在就自动接通。也可按客户端配置 `[mcp_servers.scrollweave]` 的 `url`。本轮没有擅自修改用户的全局 Codex 配置。

不能使用 HTTP 的客户端可运行 stdio 桥：

```json
{
  "mcpServers": {
    "scrollweave": {
      "command": "node",
      "args": ["E:/web-animation-editor/dist/stdio.mjs"],
      "env": { "SCROLLWEAVE_URL": "http://127.0.0.1:4100" }
    }
  }
}
```

先构建，并保持同一 HTTP 编辑器服务运行。桥只转发操作，不持有另一份项目。

## 实测连接

`tests/editor.spec.ts` 用 MCP SDK 的 `Client` 与 `StreamableHTTPClientTransport` 连接服务，执行 `listTools`，再实际等待 SVG 入库、插入片段、打关键帧、截图和校验。结果保存在 [mcp-verification.json](mcp-verification.json)。

`scripts/example.ts` 在真实运行的作品目录写素材并通过 MCP 从空作品创建新示例；[新示例验收记录](../examples/signal-and-motion/acceptance.json)包含实际工具清单。不是只检查配置文件。

## 工作流程

1. `workspace_info` 读取目录、assets 路径、MCP URL 与监听状态。
2. 通过 Agent 自己的写文件能力生成素材。仅写 assets，推荐 .tmp → rename。
3. `wait_for_asset({path:"assets/arrow.svg"})` 等待完成。已有素材更新时用 `inspect_asset` 比较前后 hash，避免把更新前的 ready 当成新文件已完成。
4. `read_project` 取得结构、轨道 ID 和 revision；默认省略媒体字节。
5. 用高层工具或 `edit_project` 原子事务编辑。每次修改带最新 expectedRevision。
6. `set_preview` 定位秒数、`get_preview_screenshot` 看结果；人工随后可以继续在同一界面编辑。
7. `save_project` 保存和打包，`export_html` 导出交付。

## 工具

| 工具                        | 参数与结果                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------- |
| workspace_info              | directory、assetDirectory、projectFile、mcpUrl、watcherReady、pendingImports、revision |
| new_project / open_project  | directory；新建另带 name。切换编辑器与 Agent 共用会话                                  |
| read_project                | includeMedia 默认 false；返回完整结构、选择、预览、revision，省略 base64               |
| list_assets                 | query、kind 可选；元信息、状态、hash、引用                                             |
| inspect_asset               | assetId；元信息与每个 composition/clip 引用                                            |
| wait_for_asset              | path（assets 相对路径）或 name；timeoutMs 默认 10000，最多 30000                       |
| insert_asset                | expectedRevision、compositionId、assetId、trackId、at；可选 duration、sourceIn、mode   |
| move_clips                  | compositionId、elementIds、delta、trackOffset、expectedRevision                        |
| trim_clip                   | compositionId、elementId、start、end、expectedRevision                                 |
| split_clip                  | compositionId、elementId、at、expectedRevision；自动生成后段 ID                        |
| delete_clips                | compositionId、elementIds、ripple、linked、expectedRevision                            |
| set_keyframe                | compositionId、elementId、property、at、value、easing、expectedRevision                |
| create_compound             | compositionId、elementIds、name、expectedRevision                                      |
| edit_project                | commands、label、expectedRevision；最多500命令，一次撤销                               |
| set_selection               | compositionId、elementIds                                                              |
| set_preview                 | compositionId、progress（**秒**）、sectionId 可选                                      |
| get_preview_screenshot      | compositionId、progress（秒）可选；PNG + 使用的 revision、位置、运行错误               |
| undo / redo                 | expectedRevision；不回写外部文件                                                       |
| list_presets / apply_preset | 预制 ID、目标 composition/element、options                                             |
| validate_project            | 引用/嵌套/曲线合法性，另返回未就绪素材 issues                                          |
| archive_asset               | assetId、expectedRevision；拒绝已引用素材，保留原文件                                  |
| save_project                | filename、expectedRevision；保存根项目并返回完整 ZIP 下载                              |
| export_html                 | filename、expectedRevision；明确返回单 HTML 或 HTML+assets ZIP 的 format               |

编辑工具返回修改摘要与 revision，不反复返回媒体。需要新片段 ID 时重新读取结构，或在低层 `clip.insert` 指定 newId。冲突返回 `REVISION_CONFLICT` 和 actualRevision；先读最新状态、核对用户变更再重做意图，不盲目重试覆盖。

## “第二轨第 3 秒，显示 2 秒并淡入上移”

先创建文件并等待入库，然后读取 revision 和真实 assetId。可以一次事务完成轨道、片段和关键帧：

```json
{
  "expectedRevision": 7,
  "label": "加入箭头并制作淡入上移",
  "commands": [
    {
      "type": "track.add",
      "compositionId": "main",
      "track": { "id": "arrows", "name": "箭头" }
    },
    {
      "type": "clip.insert",
      "compositionId": "main",
      "assetId": "实际素材ID",
      "trackId": "arrows",
      "at": 3,
      "duration": 2,
      "newId": "arrow_clip"
    },
    {
      "type": "element.update",
      "compositionId": "main",
      "elementId": "arrow_clip",
      "patch": { "x": 800, "y": 500 }
    },
    {
      "type": "keyframe.set",
      "compositionId": "main",
      "elementId": "arrow_clip",
      "property": "opacity",
      "keyframe": { "id": "fade0", "at": 0, "value": 0, "easing": "easeOut" }
    },
    {
      "type": "keyframe.set",
      "compositionId": "main",
      "elementId": "arrow_clip",
      "property": "opacity",
      "keyframe": { "id": "fade1", "at": 0.6, "value": 1, "easing": "easeOut" }
    },
    {
      "type": "keyframe.set",
      "compositionId": "main",
      "elementId": "arrow_clip",
      "property": "y",
      "keyframe": { "id": "rise0", "at": 0, "value": 560, "easing": "easeOut" }
    },
    {
      "type": "keyframe.set",
      "compositionId": "main",
      "elementId": "arrow_clip",
      "property": "y",
      "keyframe": {
        "id": "rise1",
        "at": 0.6,
        "value": 500,
        "easing": "easeOut"
      }
    }
  ]
}
```

at=3 是片段在父时间线的位置；关键帧 at=0 是该片段的源时钟起点。当前源秒数公式：

```text
source = sourceIn + (parentTime - start) * speed
```

左裁边会调整 sourceIn，移动不会，分割后段会继续原源时钟。嵌套时 parentTime 是外层片段传入的源时钟。**不要把 v1 的 0–1 当成秒**。

低层命令还包含 `track.add/update/delete`、`clips.paste`、`clip.speed`、`compound.independent`、`composition.add/update`、`project.import` 等。完整 schema 见 [command.schema.json](../schema/command.schema.json) 和 [project-v2.schema.json](../schema/project-v2.schema.json)。

## 文件与安全边界

外部 SVG 修改更新素材引用，不改变片段；时间线撤销不还原旧文件。删除源文件保留缺失项和引用。重新关联在源预览中查看影响后选择新文件，或通过同一 `/api/import` 二进制接口带 X-Replace-Id。

HTTP `POST /api/import` 使用 application/octet-stream 和 URL 编码 X-File-Name；默认只入库。项目包使用 `POST /api/import-project`，`?asCompound=true` 可导入为复合素材。避免直接改自动保存 JSON。

截图使用真实 Chromium，等待图片解码与视频 seek，超时明确报错。滚动渲染视频静音。工具不能保证任意编码或实时逐帧解码；具体测试范围见 [验收记录](ACCEPTANCE.md)。

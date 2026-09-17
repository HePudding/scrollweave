# MCP 接入与 Agent 使用

先启动 `npm run dev` 或构建后 `npm start`。一个服务进程对应一个当前项目；MCP 和可视界面共享内存状态、命令、校验、撤销栈以及工作区文件。截图需要本机 Chromium，说明见 README。

## Streamable HTTP

地址：`http://127.0.0.1:4100/mcp`。官方 SDK 实现的无会话 Streamable HTTP，POST 传输；不使用旧式 `/sse` MCP 端点。`/api/events` 是编辑器自己的 SSE 状态订阅。

常见客户端 JSON 配置：

```json
{
  "mcpServers": {
    "scrollweave": {
      "type": "http",
      "url": "http://127.0.0.1:4100/mcp"
    }
  }
}
```

Codex `config.toml` 的 HTTP 配置：

```toml
[mcp_servers.scrollweave]
url = "http://127.0.0.1:4100/mcp"
```

客户端配置文件位置由客户端决定。本项目不会自动修改用户的全局 Agent 配置。

## stdio 桥接

不支持 HTTP 的客户端可以运行 `dist/stdio.mjs`。先在根目录执行 `npm run build`；服务仍必须已经启动。桥接不会启动第二套项目状态。

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

将绝对路径替换成实际项目路径。开发时可在项目根目录执行 `npm run mcp`；只向 stdout 输出 MCP 数据，错误输出使用 stderr。服务不可达时工具会返回真实连接错误。

## 工具

| 工具                   | 输入要点                                                          | 返回 / 行为                                                    |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| read_project           | 无                                                                | 完整项目、revision、选中对象、播放头、撤销状态、错误           |
| edit_project           | expectedRevision、commands[]、label                               | 原子批次，一次撤销，立即推送界面                               |
| undo / redo            | expectedRevision                                                  | 对最近的人或 Agent 事务操作                                    |
| set_selection          | compositionId、elementIds                                         | 更新界面选择，不产生历史                                       |
| set_preview            | compositionId、progress；可选 sectionId                           | 0–1 连续进度，同步画布和已打开的原生预览                       |
| list_presets           | 无                                                                | 预制 ID、名称、说明与 options 示例                             |
| apply_preset           | expectedRevision、presetId、compositionId；可选 elementId/options | 调用同一扩展注册表与命令路径                                   |
| validate_project       | 无                                                                | 结构、素材和嵌套语义校验结果                                   |
| save_project           | expectedRevision；可选 filename                                   | 完整内嵌素材 JSON，返回磁盘路径、下载地址、revision            |
| export_html            | expectedRevision；可选 filename                                   | 独立 HTML，返回磁盘路径、下载地址、revision                    |
| get_preview_screenshot | 可选 compositionId/progress                                       | 1280×720 PNG 的 MCP image content，及 revision/位置/浏览器错误 |

save/export 的 filename 是不带扩展名的简单文件名，只允许中英文、数字、横线和下划线。输出统一写入工作区 exports，不能借文件名访问任意路径。文件导出采用请求开始时的不可变项目快照，并明确返回对应 revision。

## 一次实际批量编辑

先 `read_project`，取当前 revision 和目标元素 ID。完整命令 Schema 见 [command.schema.json](../schema/command.schema.json)。下面假定读到 revision 12，示例主标题 ID 为 title：

```json
{
  "expectedRevision": 12,
  "label": "Agent：调整标题与关键帧",
  "commands": [
    {
      "type": "element.update",
      "compositionId": "main",
      "elementId": "title",
      "patch": { "text": "为你的下一次灵感，留出空间。" }
    },
    {
      "type": "keyframe.set",
      "compositionId": "main",
      "elementId": "title",
      "property": "y",
      "keyframe": {
        "id": "agent_key",
        "at": 0.22,
        "value": 360,
        "easing": [0.22, 1, 0.36, 1]
      }
    }
  ]
}
```

不要直接复制示例 revision。冲突响应含 `isError: true` 和 `REVISION_CONFLICT`/actualRevision，重新读取并根据最新项目重算修改。不能自动用新版本号重发旧整份项目而覆盖他人的修改。

`keyframe.set` 按 keyframe ID 更新或插入；新 ID 与现有帧同位置会报错。删除使用 keyframe.delete。创建元素时给出 id/name/type，其他字段可以使用 schema 默认值；更新仅提供需要改动的 patch。素材添加使用 asset.add，与 image 元素添加放在同批命令中。

剪辑命令和底栏快捷键共用实现，均进入版本检查和撤销历史：

```json
{ "type": "element.trim", "compositionId": "main", "elementId": "title", "start": 0.1, "end": 0.4 }
{ "type": "element.split", "compositionId": "main", "elementId": "title", "at": 0.25, "newId": "title_tail" }
{ "type": "element.move", "compositionId": "main", "elementId": "title_tail", "delta": 0.1 }
```

这些时间均为父级局部进度，区间为 0–1。trim/split 不改变原动画速度；split 会复制分组后代并继续引用同一个子合成定义；move 同步平移所有局部动画。`element.update` 可设 `trim:null` 恢复未裁剪显示窗口。新增静态素材建议明确传 `start/end/outside:"hide"`；UI 默认从播放头起占 20%。底层 element.add 仍保留旧默认值，以兼容已有 Agent 项目。

子合成可以通过 composition.add 创建，再由 element.add 引用。project.import 为导入项目的合成和素材 ID 加 prefix，不改变父页面结构；在同一批次加入 composition 元素即可实例化导入项目的根合成。再次引用同一个定义可创建多个实例，循环引用会回滚整批操作。

## 可执行 Agent 示例

```sh
npx tsx scripts/mcp-demo.ts
```

示例通过官方 MCP Client 连接真实服务，读取状态、提交一个修改、验证、撤销、请求截图。截图写到 `.scrollweave/mcp-demo.png`。它会短暂修改当前项目名称并撤销，因此运行期间请避免同时编辑。端到端测试同样使用官方 SDK 连接 HTTP 与 stdio，并非直接调用假工具。

只有本机访问：Host 与 Origin 检查防止浏览器跨站写入。没有账号和远程身份验证，不要将服务端口直接暴露到公网。本机 Agent 获得的权限是当前项目编辑与工作区导出。

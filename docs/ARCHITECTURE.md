# 项目格式与运行架构

## 数据格式 v1

项目扩展名是 `.scrollweave.json`。JSON 顶层含 `format: "scrollweave"`、`version: 1`、项目 ID/名称、canvas、scroll、compositions、assets、sections。完整结构见 [JSON Schema](../schema/project-v1.schema.json) 和 [model.ts](../src/core/model.ts)。未知版本直接报错，不猜测迁移。

`canvas` 是 1920×1080 的设计规格；`contain` 保留完整画布，`cover` 填满并居中裁切。它不是整张长网页的比例。图层位置、宽高、字体和裁切使用设计坐标。`layout.anchor/responsive` 为后续布局系统预留；本版只执行固定坐标与全局 contain/cover，不将预留字段当作完整约束布局。

每个 composition 是可重用定义，元素按数组顺序从底到顶绘制。`parentId` 只能指向同合成中的 group。引用子合成的元素使用 `type: "composition"` 和 `compositionId`。实例拥有自己的变换、区间、轨道；编辑定义会有意更新所有引用，进度和 DOM 实例互相独立。不能循环嵌套；展开后单个合成最多 5000 层、单定义最多 500 元素、最多 100 个合成。

每个元素的 `start/end` 位于父进度 0–1 内。轨道关键帧使用元素自身的局部进度：

```text
local = clamp((parentProgress - timeOffset - start) / (end - start), 0, 1)
```

分组继续向孩子传局部进度；子合成实例把局部进度交给子定义。时间线视图将父组区间组合为当前合成坐标后显示；属性面板的关键帧位置明确使用本地进度。区间外可选择保持首尾状态或隐藏。

兼容 v1 的可选字段 `timeOffset`（默认 0）平移素材及其全部关键帧；`trim`（默认 null）是独立的父局部坐标显示窗口 `{start,end}`。非空 trim 覆盖原 outside 可见性规则，只裁内容，不重映射曲线或子合成进度。右边界为半开区间，唯独 end=1 时包含父进度 1，避免分割切点双重显示。没有新字段的旧项目保持原行为。

`element.trim` 只改显示窗口；`element.move` 同步平移窗口与 timeOffset；`element.split` 克隆实例/分组子树并分配互斥显示窗口，保留曲线和图层相对绘制顺序。UI 和 MCP 都走这些命令。没有显式 trim 时，时间线根据 opacity 非零支持区间收起首尾空白；这只是保守的显示范围推导，不重写轨道，不猜测静态水印何时退场。动画映射区间仍可在属性面板高级选项中调整，此操作明确会变速。

关键帧支持 x、y、scaleX、scaleY、rotation、opacity。轨道按 at 排序、禁止重复位置与重复 ID。每一帧的 easing 控制该帧到下一帧，可为 linear/easeIn/easeOut/easeInOut 或四个贝塞尔参数。Motion 插值器按轨道缓存；无时间推进式动画状态，所以回放、倒放和随机跳转一致。

素材采用 `data:image/...;base64,...`，支持静态 PNG/JPEG/WebP，拒绝路径和外链。动画图片不在确定性渲染范围内，APNG 与动画 WebP 会被拒绝；GIF 不支持。可以在不同电脑间单文件分享项目，不需要另一个 assets 文件夹或原绝对路径。

## 原生滚动

sections 定义文档中的纵向排列顺序，同一合成可以用在不同 section。

- `pin`：包装高度为 `scrollDistance + viewportHeight`；内部 viewport 使用 `position: sticky; top: 0`，原生 scrollY 在 scrollDistance 内映射到 0–1，随后 sticky 自然退出。
- `flow`：内容高度为 scrollDistance，属于普通文档流。局部进度在内容从顶部进入到其底部到达视口底部之间映射；范围是 `max(1, scrollDistance - viewportHeight)`。高度不超过视口时进度区间很短，适合静态收尾。
- 精确模式直接显示目标进度。
- 平滑模式只由每个 viewport 持有实际进度：`actual += (target-actual) * (1-exp(-dt/tau))`。新目标从实际进度继续，反向也不会重置。系统减少动态效果偏好会启用精确模式。

运行时不接管 wheel、不阻止键盘和浏览器滚动条。使用 rAF 采样原生 scrollY。页面预览是一份嵌入 iframe 的同源 HTML，消息把实际显示进度与编辑器播放头同步；来源 ID 防止 SSE 回声把平滑进度反复重置。

## 命令与持久化

`src/core/commands.ts` 的 `applyCommands` 在隔离副本上应用整批命令，再整体校验，失败不提交。`ProjectStore` 只有一个 revision，提交、撤销、重做都会递增。默认最多 80 个撤销事务；新修改清空重做。默认值只在创建对象时补入，更新对象不会给未提供字段补默认值。

`EditorService` 同时服务 HTTP UI 与 MCP。`edit_project`、`undo`、`redo`、`apply_preset` 必须携带当前 expectedRevision。文本、数值和拖动手势捕获编辑开始时的版本，因此其他 Agent 在编辑期间提交会引发明确冲突。选中与播放头是临时会话状态，不占项目撤销历史。多窗口和多个 MCP 客户端共用同一个会话选择；这不是多人协同系统。

每次项目提交同步写临时工作区文件，再通过 rename 替换。文件写入错误会作为错误返回；没有云备份。save_project 另外生成可分享项目包；恢复加载的项目仍通过相同验证。服务进程锁阻止两份服务各维护一份相同工作区。

## 渲染与导出

`runtime/render.ts` 的 mountStage 构建持续存在的 DOM 树，draw 只更新变换/透明度/可见性，不随章节进度卸载重建元素；隐藏状态向后代传播。每个实例的 DOM 路径包含所有父实例 ID。只在项目结构发生编辑时重建画布。

`mountPage` 编排原生滚动、sticky 和 viewport 缩放。编辑器原生预览与 HTML 导出都调用同一个 runtime entry。esbuild 把这份代码打包为内联 IIFE，连同 CSS、JSON 和所有素材写入 HTML；项目 JSON 中的 `<` 被转义，文字使用 textContent。链接只允许 http(s)、mailto 和锚点。运行时许可证全文附在 HTML 注释中。没有外部脚本、CDN 或外部字体。

MCP 截图在真实 Chromium 里装载同一导出运行时，在指定合成和进度截 PNG，同时返回 revision 与浏览器错误；失败不会返回模拟图像。默认截图是合成视图，而不是整个编辑器桌面。

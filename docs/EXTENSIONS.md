# 社区扩展接口

没有插件市场，也不从项目 JSON 中执行任意代码。扩展作为经审阅的源码模块构建进编辑器、服务和导出运行时。普通预制和项目包不需要写插件。

入口是 `src/extensions/registry.ts`。自带预制用的就是 registerPreset，自带 badge 元素用的就是 registerElement；没有隐藏的“官方特权”路径。

## 预制

一个预制把参数转换为同一套 Command[]，不直接操作 store 或 DOM，也不另建状态系统：

```ts
import { registerPreset } from "./registry";
import { createElement } from "../core/model";

registerPreset({
  id: "community-banner",
  name: "社区标题",
  description: "一个可继续编辑的标题。",
  build({ compositionId, options }) {
    return [
      {
        type: "track.add",
        compositionId,
        track: { id: "banner_track", name: "社区标题" },
      },
      {
        type: "element.add",
        compositionId,
        element: createElement({
          type: "text",
          name: "社区标题",
          text: String(options.text ?? "你好，滚动。"),
          trackId: "banner_track",
          start: 0,
          end: 5,
          x: 180,
          y: 240,
          width: 1500,
          height: 160,
          tracks: {
            opacity: [
              { id: "begin", at: 0, value: 0, easing: "easeOut" },
              { id: "end", at: 1, value: 1, easing: "easeOut" },
            ],
          },
        }),
      },
    ];
  },
});
```

在 `builtins.ts` 导入社区模块即可供 MCP list_presets/apply_preset 发现。新模块应有唯一 ID，只使用声明式参数；schema 校验失败会回滚整批动作。组件真正输出可编辑图层与关键帧，不能只把效果烘焙为截图。

## 自定义元素

`registerElement({ id, create(element, document), update?(node, element, progress) })` 创建 DOM 并响应确定性的片段源时钟秒数（迁移的旧自定义元素保留原规范化时钟）。数据放在元素 `customData`；type 为 custom，customType 为注册 ID。

入口范例见 `builtin-elements.ts`。自定义元素模块必须从该运行时入口导入，因此它同时进入画布和独立 HTML。create/update 不应访问服务、使用随机数、启动自有播放时钟或依赖远程素材。文字使用 textContent。使用系统之外的素材必须添加到项目 assets。

安装同一扩展源码后可以继续可视化编辑其通用变换与关键帧。本版没有自定义元素专属属性面板生成器；customData 可由 MCP 编辑。缺少扩展定义的项目会报错，不会静默渲染占位内容。

## 导出适配

`registerExporter({ id, name, extension, export(project): Promise<string> })` 是代码级适配入口。当前 html 适配器在 server/export.ts 注册。其他适配器应先验证项目并复用 evaluate/runtime 或明确提供有一致性验证的后端。

本版只开放网页导出：图片/SVG 单 HTML，视频 HTML+assets ZIP。Astro/React 工程导出需要独立适配器、素材布局和验收，不假装已经完成。未来接入时可扩展 export 工具的 adapter ID，同时保留旧项目格式。

0.2 中 start/end/sourceIn/关键帧 at 均为秒。示例中的0→1表示一秒淡入，不是整段百分比。示例轨道ID应在实际扩展中用uid生成，避免重复应用冲突。若输出可复用子合成，同时建立kind=composition的asset.add并为实例设置assetId。素材处理应调用AssetManager，不要绕过SVG和媒体校验直接执行外部代码。

# 贡献指南

欢迎修复问题、改进可访问性、提交可编辑预制和小型组件。先阅读 README、docs/ARCHITECTURE.md、docs/EXTENSIONS.md。避免叠加第二套动画状态或独立 MCP 项目副本。

1. Node.js 22.12+ 与 PATH 中的 FFmpeg/FFprobe，执行 `npm ci`、`npm run dev`。
2. 修改核心逻辑时，在 tests/core.test.ts 加入行为回归用例。修改交互时添加必要的 Playwright 场景。
3. 运行 `npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run build`。
4. 新依赖必须核验许可证与关键传递依赖，精确锁版，并运行 `npm run licenses`。未知许可证会使脚本失败；需要补充官方证据，而不是扩大允许列表绕过检查。
5. 改动格式时引入明确迁移，更新 `version`、JSON Schema 与保存恢复测试。用 `npx tsx scripts/schema.ts` 重新生成 Schema。
6. 所有时间线用户/Agent 变更必须走 Command → validation → ProjectStore；外部素材用 AssetManager → syncAsset，覆盖历史中的媒体记录而不回写磁盘。预制返回同一 Command[]。不通过 DOM 回读作为项目持久化数据。

PR 请写明具体问题、修改后的行为、测试和已知限制。截图可辅助说明，但不能代替滚动/寻址/保存/导出的行为测试。提交源码与必要示例；不要提交 node_modules、个人工作区、浏览器文件或敏感凭据。

本项目贡献采用 MIT；第三方代码继续保留其原始许可证和版权声明。不要引入付费 SDK、模型 Key 或 CDN 作为核心路径前提。维护者应审阅新增源码扩展，自定义元素不是沙箱。

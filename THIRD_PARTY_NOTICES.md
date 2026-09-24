# 第三方声明

本项目原创代码采用 MIT。依赖保留各自许可证。核验以锁定安装包、上游许可证原文和官方仓库为依据，不仅依据 npm 摘要。

## 核心依赖

| 组件                         | 锁定版本       | 许可证 / 使用方式                                                                                                   |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| React / React DOM            | 19.3.0         | MIT；编辑器 UI                                                                                                      |
| react-moveable               | 0.56.0         | MIT；画布手势；Daybrush / @scena / @egjs 相关关键传递包均为 MIT                                                     |
| Chokidar                     | 5.0.0          | MIT；只监听作品 assets 目录                                                                                         |
| DOMPurify                    | 3.4.15         | MPL-2.0 OR Apache-2.0；保留完整双许可证文本，使用未修改的包                                                         |
| JSDOM                        | 30.1.0         | MIT；服务端 SVG 清理所需 DOM，其传递依赖许可证列入合集                                                              |
| fflate                       | 0.8.3          | MIT；项目与网页 ZIP                                                                                                 |
| react-bezier-curve-editor    | 2.1.0          | 上游 LICENSE 与同版本源码 package.json 为 MIT；npm 元数据 ISC。包含上游 MIT 原文与来源，不把差异隐藏为单一 npm 字段 |
| Motion                       | 13.4.0         | MIT；framer-motion 13.4.0、motion-dom 与 motion-utils 13.3.0 均 MIT                                                 |
| MCP TypeScript SDK           | 1.30.0         | MIT；关键传递 Hono、Zod、Ajv 等保留各自声明                                                                         |
| Pi Agent Core / Pi AI        | 0.87.1         | MIT；内置助手执行循环与模型协议，固定上游全文见 docs/licenses/pi-MIT.txt                                            |
| Express                      | 5.2.1          | MIT；qs / fast-uri 等 BSD 依赖亦已记录                                                                              |
| Zod                          | 4.6.5          | MIT；项目与命令校验                                                                                                 |
| Lucide React                 | 1.47.0         | ISC，分发其完整 LICENSE（包含图标来源声明）                                                                         |
| Playwright / Playwright Test | 1.63.0         | Apache-2.0；本地 Chromium 截图与验收。浏览器本身按其发行许可证使用，仓库不分发 Chrome                               |
| Vite / esbuild               | 8.3.0 / 0.28.2 | MIT；开发与构建工具                                                                                                 |
| TypeScript                   | 7.0.2          | Apache-2.0；类型检查                                                                                                |

`npm run licenses` 检查 package-lock 中 **608** 个含平台可选包的记录；当前 Windows 安装了 **539** 个依赖包。完整机器可读列表见 [docs/dependency-licenses.json](docs/dependency-licenses.json)。更新依赖后数字以重新生成的报告为准。

原始许可证合集：[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)。独立 HTML 实际依赖通过 esbuild metafile 自动发现，其所需许可证与本项目 MIT 附在 [THIRD_PARTY_RUNTIME.txt](THIRD_PARTY_RUNTIME.txt)，导出时完整内嵌。导出不包含 React、Moveable、DOMPurify 或 MCP 服务代码。

## 特别记录

- [react-bezier-curve-editor 官方 MIT](https://raw.githubusercontent.com/LiamMartens/react-bezier-curve-editor/master/LICENSE) 与 [同版本 package.json](https://raw.githubusercontent.com/LiamMartens/react-bezier-curve-editor/master/package.json)。本地副本在 docs/licenses/。使用未修改的公开包与受控 API。
- @cfcs/core、css-styled、keycon 的 npm 包未附完整许可证文件，从 [CFCS](https://github.com/naver/cfcs)、[css-styled](https://github.com/daybrush/css-styled)、[keycon](https://github.com/daybrush/keycon) 官方来源补入 MIT 原文。平台 esbuild/rolldown binding 使用所属项目的同版本 MIT 文本。
- Vite 工具链的 Lightning CSS 1.33.0 是 **MPL-2.0**，属于文件级 copyleft，而非 MIT。它是未修改的开发构建依赖，既未复制其源文件到本项目，也不进入导出运行时。许可证原文在合集，源代码见 [Lightning CSS](https://github.com/parcel-bundler/lightningcss)。若重新分发或修改此依赖，需保留该依赖的 MPL 通知并满足对应源码提供义务。[Mozilla 官方说明](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- 未引入 GSAP、Remotion、Theatre Studio 或商业编辑器 SDK，不依靠它们的许可证进行分发。
- 新示例使用项目原创文字、SVG、FFmpeg 生成的图片和视频；字体由操作系统提供，没有打包商业字体。FFmpeg 由用户本机安装，本仓库不捆绑其二进制；本次使用的 GPL 构建仅作为独立媒体处理进程运行。使用者自己导入的素材仍需自行拥有适当使用权。

当前依赖树没有未识别许可证。生成脚本遇到新的未审阅许可证或缺失许可证文本会失败。该审阅针对当前锁定依赖，不代表未来任意升级自动适用。

当前完整性检查仍未通过：`chromium-pickle-js`、`cross-dirname`、`lazy-val`、`node-api-version`、`proxy-agent-negotiate`、`temp-file`、`tmp-promise` 的安装包及核验的上游来源未提供完整许可证文本。它们的元数据与缺失状态保留在机器报告中，`npm run licenses` 继续返回非零状态；发行核验仍需补齐这些文本。Pi 及可取得的新增依赖原文已补入合集。

- saxes 6.0.0 的安装包没有附完整许可证，从官方版本标签 https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE 补入 docs/licenses/saxes-ISC.txt。新增传递依赖中的 MIT-0、BlueOak-1.0.0、CC0-1.0 已按安装包原文收录。

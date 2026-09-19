# 0.2 数据模型与实现

## 保留与替换

保留 React/Vite、Zod、Motion 插值、Moveable 画布手柄、贝塞尔曲线组件、MCP SDK、原子命令、revision 冲突、SSE、共享 DOM 渲染与独立导出。新增 Chokidar 文件监听、DOMPurify+JSDOM SVG 清理、FFmpeg/FFprobe 媒体处理、fflate 打包。

替换固定 0–1 时间、透明度推断色块边界、导入直接创建元素和图层式主入口。移除未再使用的 vis-timeline/vis-data：它们的通用 range/group 表达不再承担本版源取用、显式轨道与片段碰撞语义。时间线用浏览器 Pointer Events 和秒到像素映射；复用成熟插值、媒体解码、画布变换、曲线、文件监听与协议实现。标尺只渲染可见刻度，避免长视频生成几十万个节点。

## Project v2

- Asset：稳定 ID、kind、原始相对 path、清理缓存 cachePath、thumbnail、尺寸、真实 duration、codec/audioCodec、hash、状态与警告。复合素材引用 compositionId。
- Element / Clip：一次使用，拥有 assetId 或 compositionId、trackId、start/end、sourceIn、speed、独立画布属性与关键帧。保留 Element 命名以兼容命令/扩展层。
- Composition：明确 duration、由下到上的 tracks、片段 elements。新增内容把 duration 扩展到根片段最大 end，删除不会自动缩短整个作品。
- Section：时间线 ID、start/end 秒、scrollDistance、pin/flow。end=null 跟随完整时长；页面映射不改片段。

`element.tracks` 是动画属性通道；`composition.tracks` 是视觉叠放轨道，两者含义不同。

源时钟为 `sourceIn+(parentTime-start)*speed`，关键帧 at 位于该时钟。移动只改变 start/end。左裁边同步加 sourceIn，右裁边不改；分割复制独立属性通道、推进后段 sourceIn。不裁掉“范围外”关键帧，避免插值节奏改变。只有明确变速会重定时。

同轨放入和移动拒绝碰撞，insert 分割并后移，overwrite 保留覆盖范围两侧，普通 delete 留空。波纹合并删除区间后平移后续片段；跨轨联动遇到穿越的未选片段会拒绝。锁定轨道/片段拒绝编辑。

复合片段把选中的顶层子树移入新 Composition，减去共同起点，保留源时钟、曲线、相对位置与叠放。若中间穿插其他未选内容，拒绝会改变层序的封装。共享素材可重复引用，独立副本递归克隆合成图；禁止循环，最多16层/展开5000节点。

## 文件管理

只监听工作目录 assets；忽略临时/隐藏文件，900ms稳定窗口，不跟随符号链接，读取前再做 realpath 边界检查。路径标识现有素材，SHA-256去重事件；同名上传自动加序号。未完成/无效文件只成为错误素材，不破坏整个项目。

SVG 用 DOMPurify 和 XML 解析清理，保留原始 source，渲染清理缓存。移除脚本、事件、外链、foreignObject、嵌入 image、style 和 SVG 内置动画；保留本地渐变/路径引用。通过 img 显示矢量，不栅格化。

图片/视频由独立 FFmpeg 进程处理，参数数组、无 shell、30秒超时。FFprobe读取真实尺寸/时长与编码；生成首个解码帧缩略图。缓存内容寻址，不覆写已使用的缓存 URL。源丢失标记 missing，重关联保留 assetId；源变短保留剪辑并提示超出部分保持末帧。

素材更新通过 ProjectStore.syncAsset 覆盖当前和历史快照中的同一素材记录，因此 undo/redo 不会回滚 Agent 的新文件或缓存版本。原文件本身从不被时间线命令写入。

## 渲染与声音

编辑预览和网页共用 sampleElement、mountStage。普通播放用 requestAnimationFrame 推进秒数；视频依据源时钟 seek/play，允许音量0–1与静音，容器变换由同一个样本驱动。嵌套实例各有独立 DOM/video，内容共享但播放状态不共享。

滚动把像素距离映射到区间秒数，始终静音；快速拖动时合并视频定位请求，seeked 后处理最新目标。媒体帧加载有延迟，不承诺跨所有编码逐帧零延迟。精确/平滑改变驱动器，不改变求值；平滑状态属于页面区段，不属于素材。

iframe 用恢复位置握手避免刷新时把默认0秒反向同步到编辑器。播放与滚动位置会同步给服务和 MCP。页面运行错误、媒体失败可在 UI / MCP 截图结果观察。

## 持久化与迁移

命令在克隆草稿中执行，整批校验后提交；写临时文件再原子 rename，失败恢复内存与历史。expectedRevision 过期拒绝写入。项目包导入前保存原始输入和原项目；导入期间若结构被他人编辑，拒绝覆盖新内容，已经入库的文件保留。

v1 原文件保留并产生 .v1-时间戳.bak。旧普通预览12秒，因此每个旧局部0–1时钟映射为12秒；旧动画起止转换为 rate/sourceIn，旧 offset、trim、hold、键值、曲线和嵌套不直接改成秒。旧分组保留，sourceDuration 负责旧版端点保持。给旧兄弟元素独立轨道以保持叠放。201个采样位置逐属性与旧求值器比对；极端超限/非法项目会明确拒绝，原文件仍在。

正常源保存是相对 assets 路径。项目 ZIP 含可编辑结构与有效媒体，冷启动重新生成缓存；有引用的缺失/失败素材阻止打包并报错，未使用的无效素材只在打包警告中列出。HTML 导出只保留页面可达内容需要的素材；纯图片/SVG内嵌，含视频时外置到同包 assets。运行时代码不包含 React、编辑器、MCP 或素材处理服务。

# 产品重构执行清单

更新：2026-10-14。此文件是本轮重构的唯一执行清单；“已发布”须有远端 main 提交，“实现中”不代表可验收。按下列依赖推进，独立模块可并行。

## 1. 原生执行与旧能力拆除 — 已发布并通过 CI

- 新工作经 Pi Durable 1.2.0 的 Conversation / Task / SQLite / native submission 执行；关闭与取消分开，工具默认 unsafe replay，保留权限检查。
- 旧会话只读；继续旧工作建立关联的新原生会话，不伪造检查点。
- 已移除旧 MCP、Skill、托管环境的实现、资源、安装链、配置和界面。
- 发布：[原生执行与拆除](https://github.com/rongxinzy/zhiyuan/commit/be55fd2bf10b57039cb84e0009a176818943ae12)、[测试收口](https://github.com/rongxinzy/zhiyuan/commit/bdc18f8986cdb73940a73a2017e216b8cec9a27b)、[连接测试时间一致性修复](https://github.com/rongxinzy/zhiyuan/commit/d7b911cb2997299cbb38799bc54307140b96b596)。
- 验证：本地 renderer/shared 277 套、1865 项通过；原生执行 36 项通过；双类型检查、lint、格式、renderer 构建通过。远端 CI 曾发现时间戳差 1ms，已修复实际数据路径并加时钟递增回归，[修复后 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38509322389)。
- 尚未验证：实际 Electron 重启、真实 GPU、全部离线链路；不承诺外部副作用 exactly-once。

## 2. 删除 IM / cc-connect，Cron 使用 Durable Task — 已发布并通过 CI

依赖：1。

- 删除外部消息渠道、授权/安装/配置/界面及打包依赖，保留应用内 Cowork 与 Coding。
- 宿主仅计算触发时间；每次计划执行映射独立原生工作，稳定 requestId 复用同次提交。
- 保留用户开关、下次执行、单次运行结果；重启不无限补跑；停止执行调用原生 abort。
- 验证要求：时间触发/时区/停机恢复、同次幂等、取消释放等待、无人值守不自动批准写操作、UI 与打包无旧入口。
- 当前：IM 前后端与打包已移除并发布；原生计划执行与取消 11 项测试通过；调度与原生共 161 项通过，重启投影 5 项通过，完整双类型检查通过。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 3. Engram 替换为单项工作 Document — 已发布并通过 CI

依赖：1；可与 2 并行。

- 停止旧 Engram 服务、全局记忆读取/注入及专用投影表创建，不删除用户现存数据库或文件。
- 工作档案 UI、IPC 和原生事务已贯通，直接来自原生 Document，提供目标、约定、决策、进度的可见编辑与变更订阅。
- 原生事务原子写入、revision 冲突检查；不从聊天文本猜测档案，不保留跨工作长期记忆。
- 验证：原生读写、SQLite 重开、原子回滚、并发修订、跨会话隔离、旧历史只读、UI 读写回归通过；旧用户表未删除。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 4. 单一主题的浅色 / 深色 — 已发布并通过 CI

依赖：2、3 的主要 UI 删除完成后收口。

- 保留当前默认一套主题的浅色 / 深色，删除多主题选择、主题包和多主题引擎；可保留组件 recipe。
- 本项是用户最新明确方向，覆盖旧 AGENTS 的保留全部主题要求。
- 验证：24 项主题回归、静态生成检查与样式审计通过；CSS 由约 2.98 MB 降至 0.80 MB。实际桌面视觉检查尚未执行。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 5. Magpie 本地 Coding Agent 管理 — 已发布并通过 CI

依赖：2；现有 Coding 正常功能保留。

- [上游 Magpie](https://github.com/yetone/magpie/blob/main/README.zh-CN.md) 固定源码版本，Go 代码原样编译为随包独立二进制，不修改或重写上游 Go 引擎。
- 前端可移植；保留 MIT 许可与归属。管理本地 agent、版本与模型配置的具体范围按核实后的上游能力实施。
- 已固定上游 f074996d93b87b17ea682c4b5951d52794bb28cb，Go 1.26.8 原样交叉编译六个平台；MIT、源码归档与产物哈希随构建留存。默认不启动，启用须用户明确确认本机 CLI 配置同步。
- 验证：Linux 真实二进制发现临时 Codex 配置、官方 API 更改模型、停止进程通过；Main/Preload/哈希 Worker 构建及 Worker 实际校验通过；18 项打包测试通过、1 项 Windows 专属测试跳过。其余平台只有交叉编译结果，未冒充实机运行。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/145102b1fffa9e5aa649a14f2b2a9a34f37ab685)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38518213887)。

## 6. 新 Python Runtime — 已发布，Linux / Windows CI 通过

依赖：1、2；不恢复旧 managedPython / Skill 环境。

- python-build-standalone，固定 Python 3.12.x 并按兼容矩阵升级；uv；不使用 Git Bash。
- workspace 独立 venv；Main Process 调度独立 Runner；Windows Job Object 管理进程树。
- 提供 python.execute / python.install，运行时版本化及环境重建。
- 实际工作入口已注册 Python 工具，复用原生审批；通过 Main 的惰性服务启动独立 Runner。模型协议使用 python_execute / python_install，避免工具名中的点被 provider 拒绝。
- Linux 已验证固定 3.12.15、uv 安装 packaging 与 NumPy 原生 wheel、工作区隔离、失败保留原环境、冻结依赖重建、取消和超时清理进程树；实际会话入口回归证明批准前不执行。双类型检查和 lint 通过。
- Windows x64：实际 MSVC 编译 Job Object helper，父/孙进程终止与 Unicode 参数 2 项通过；固定 PBS Python / uv / packaging / NumPy、工作区隔离、回滚重建、超时取消 4 项通过。Windows 跳过 1 项 POSIX 专属强杀测试，该边界由真实 Job Object 父进程死亡测试覆盖。
- Linux x64：独立监督进程修复后，实际 Runner 的执行、安装、NumPy、超时取消、强杀 Runner 共 5 项集成通过。Windows ARM64 无当前固定 3.12 资产，明确不支持；macOS 与 Linux ARM64 资产已固定，尚未执行运行矩阵。
- 发布：[原生工具与 Runner](https://github.com/rongxinzy/zhiyuan/commit/c81695767fd50e6d2fe2d80c0970214a9b632663)、[强杀清理修复](https://github.com/rongxinzy/zhiyuan/commit/f3b88fa8249a039a73efacec497f53699bc957e7)、[Windows 路径别名精确验证](https://github.com/rongxinzy/zhiyuan/commit/9abb41682d1949b9296e0daffc1f8d2a5183ddc2)。

第二批远端验证：[IM / Cron / Document / 单主题 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38517317459)。

## 7. 移除重复 Workbench 审计 — 已发布并通过 CI

- 删除另一套任务 / 运行 / 审批记录 / 交付验收引擎、SQLite 新表初始化、IPC、轨迹审计与验收界面，以及 Coding 的重复运行绑定。
- 保留原生 Durable 执行、工作档案、普通会话产物、Coding 自身事件 / diff / 文件内容。通用工具审批分类和有界内容 Worker 迁为独立模块。
- 旧用户审计数据原地保留；新增数据库不再创建旧表。本地完整 renderer/shared 1803 项、原生与保留工具等 76 项、Coding 206 项通过；双类型检查、lint、格式和 Main / Preload / 内容 Worker 构建通过。[已发布](https://github.com/rongxinzy/zhiyuan/commit/54e7fbe6255f5185fbe904e8bf4cd49d046cb0fd)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38524922618)。

## 8. Magpie 统一模型设置 — 已发布并通过 CI

- 用户已确认：Magpie 统一管理 provider、凭据、模型目录与路由；Pi 负责执行、恢复与 Document。
- 知远只提供企业托管模型与本地 GPU 的薄适配，本地 GPU 模型也注册到同一目录；不修改上游 Go 代码。
- 原生 Pi 只经 Magpie 目录与网关运行，精确模型 ID、协议、上下文及能力由统一目录投影；目录无默认首项或旧 provider 回落。企业 token 保留在宿主 loopback 代理内；llama.cpp 与 Ollama 仅注册实时运行模型，停止或失效撤销目录。
- 旧 provider 编辑器、独立 OAuth / token 刷新 / 兼容代理 / 目录发现链已移除。普通设置 IPC 白名单不再返回历史凭据；原有磁盘配置不主动清除，也不自动迁移密钥。
- 首次启用须明确操作，启用偏好持久化，之后实际任务 / Cron 可惰性启动；关闭应用不清除偏好，用户停用才关闭。订阅账户发现独立默认关闭，确认后才允许官方流程读取本机登录；关闭不删除登录文件。真实浏览器账户登录尚未验收。
- 旧可选 AI 轻重歧义分类退出，保留规则分级。该可选功能此前默认关闭，本次不声称其与规则完全等价，也不增加聊天分类请求。
- [已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/566a687f6751c56fdcc55fdab4f1887df3b7172e)，[统一模型 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38530377018)。本地 renderer/shared 1397 项、原生执行与模型 101 项通过，后者含 4 项真实固定 Go 二进制纵切；双类型、lint、格式、Main / Preload / catalogWorker 与 renderer 构建通过。
- 真实 Pi Harness → Magpie → loopback SSE 验证精确模型、生成输出与重复提交仅一次请求；未使用真实账号或付费模型。正常退出先关闭原生工作、保存检查点，再关闭模型网关与企业代理；保留既有 15 秒应用退出上限，10 项关闭 / 重开及接线回归通过。

## 9. 原生历史与统一检索存储 — 已发布并通过 CI

- 用户已确认：Pi 原生历史与 Coding 自身事件各自保存真实记录，提供统一目录、cursor 分页、可重建 FTS5 检索、附件管理及一致备份恢复。
- 不再重建另一套任务执行真相，不主动清除用户历史数据。
- 首批只读目录 / cursor 分页 / 可重建 FTS5 / 原会话定位已经接入侧栏与实际 IPC；19 项组合测试、双类型检查与 Main / Preload 构建通过。[已发布](https://github.com/rongxinzy/zhiyuan/commit/fa7e594aea37a2fb06d567fa8cd28f0957f0ca40)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38527096618)。
- 备份 / 恢复采用用户明确确认后的维护重启，在所有数据库与原生执行器打开前执行；本地已接真实原生目录选择、备份确认与重启入口，受管附件哈希快照、白名单历史导出、WAL 一致快照、校验及失败回滚已通过测试。配置、凭据与旧外部文件引用不随包导出。
- 后批已发布 [0a1159d](https://github.com/rongxinzy/zhiyuan/commit/0a1159d06df79cb4d98c56352a44811a05f11fa0)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38528553874)。包含启动顺序修复、可直接再次恢复的回退包、持久还原检查点自动恢复隔离；本地最终历史 / 调度 34 项与 UI / 原生读取回归通过，CI 使用真实 SQLite 维护测试。尚未做 Electron 桌面完整重启手工验收。
- 搜索按 source revision 增量更新，原生库以 entry 水位补偿跨库失效；显式重建才全量扫描；中文两字检索使用派生文本子串后备，不宣称倒排加速。预览 / 元数据 / 页面分别有字节上限，图像 base64 不传至历史列表；单条特别大的原生 entry 解析成本仍继承 Pi 官方存储实现。
- 新历史浏览与检索读取原生 entries；运行界面仍保留 CoworkStore 展示镜像缓存，旧历史兼容读取。备份保存原生检查点以及显示缓存 / 旧历史表，未增加第三套 transcript，也未声称旧镜像存储已经全部消失。

## 10. 工作简报与统一工作现场 — 已发布并通过 CI

- 用户本轮选定首页工作简报与单项工作页面两项 UI 改造；不扩展模型搜索或历史筛选。
- 首页每栏有界分页浏览全部已载入记录，真实运行进展、结果、失败摘要及原工作定位；输入固定可达，分页不清草稿。尚无原生待恢复有界目录，不扫描全部会话或把旧记录冒充待办。
- 单项工作固定成果 / 对话 / 工作档案入口；保存回复、产物与真实 Document 目标进度前置，空工作直接输入；恢复和审批动作明确可达，标签保持草稿与运行订阅。最近输出不宣称工作已完成。
- [本轮代码已发布](https://github.com/rongxinzy/zhiyuan/commit/c0e9dc59c6227b7dcfc9c5853a582aa97cee5ec8)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38535425566)。最终本地 renderer/shared 255 套 / 1411 项与聚焦 41 项通过，双类型、格式、lint / 主题检查及 renderer + Electron 构建通过；云 Chromium 启动被系统 socket 权限阻止，未完成截图或 Electron 实机视觉验收。

## 11. 执行状态与 Coding 工作台 — 已发布并通过 CI

- 用户选择 UI 第三、第四项：真实执行状态与明确动作，项目 / 当前任务 / 差异 / 运行结果优先的 Coding 工作台。
- 状态由原生任务与输入回执投影，区分运行、待回复、待执行、暂停、停止、失败、本轮完成和未知；只对当前可见未完成工作有界刷新。闭库状态 / 档案读取不创建模型配置，恢复需用户明确检查后继续。
- Stop 等待原生取消，重复点击共享请求；早期输入 admission 取消、迟到失败与切会话有回归。失败后的再试仅打开输入供修改，不自动重放外部操作；取消不撤销已经发生的外部效果。
- Coding 固定项目与任务上下文，差异 / 文件 / 运行输出常显，最近结果有界展示并区分上一轮 / 失败 / 取消；管理工具保持辅助位置，保留 ACP、终端及草稿。
- [本轮代码已发布](https://github.com/rongxinzy/zhiyuan/commit/2e2c17f18e9c02d6316f1c01559b28c01a811745)，[现行轻量 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38543782985)：renderer/shared 259 套 / 1424 项、原生执行与档案 55 项、历史维护 22 项、侧车与打包契约 78 项通过；5 项平台 / 显式启用测试跳过。Coding 181 项包含在 renderer 测试内，不重复计数。双类型、lint / 格式及完整 renderer + Electron 本地构建通过。
- Vite 的旧 Photon WASM 复制路径已改为当前官方依赖，构建实际产物与源字节一致，缺件将阻断构建。额外本地 historyArchive 测试出现 Node 原生断言退出，在未修改 e8199fb 基线同样复现；远端 CI 的完整 22 项历史维护测试通过，不将本地异常计为通过。
- 额外执行的旧 `runtimePackagingConfig` 在未修改基线 e8199fb 上同样有 8 项失败，涉及已停用的签名 / 发行 workflow 与此前 Python 资源策略；本轮保留断言，不复活旧发行链，不声称这些旧测试已通过。新 Photon 回归独立纳入现行轻量 CI。云浏览器已有 socket 策略阻断未绕过，Electron 视觉验收仍未完成。

## 12. 模型 / 历史入口与统一交互验收 — 已发布，CI 通过，视觉验收受限

- 用户选择 UI 第五、六项。模型目录搜索与真实能力摘要、已保存默认 / 待保存选择分开；历史来源 / 时间只读筛选和原会话定位，备份恢复收入设置。
- 时间筛选在 SQL 分页之前应用，游标绑定全部查询条件；列表按会话更新时间，搜索按消息时间。读取不启动任务或隐式续跑。
- 核心页面巡检包括首页、工作现场、Coding；已确认并修复 Coding 展开结果无法键盘聚焦滚动的问题。设置窄窗口导航避免固定侧栏挤压；保留单浅深主题及 reduced-motion。
- 验收清单：共享控件 / 单浅深 token 归属、无新增动画、键盘操作、查询竞态、空 / 加载 / 错误状态的组件回归通过；未改 token / recipe，重新生成主题不适用。真实 light / dark 尺寸、窄窗像素溢出、portal 和滚动视觉仍未验收，不以结构检查代替。
- 本地 renderer/shared 261 套 / 1436 项通过；后续本地日历边界在 UTC / 纽约夏令时场景验证，历史 SQL 筛选 10 项通过。双类型、lint / 主题审计、格式、build:vite 的 renderer + Electron 产物构建与包预算通过。[代码已发布](https://github.com/rongxinzy/zhiyuan/commit/000275d514837bfc513dacd94713f00ea1d3efae)，[现行 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38546535752)：最终 renderer/shared 262 套 / 1438 项、原生 55 项、历史 25 项、侧车与打包契约 78 项通过，5 项平台 / opt-in 跳过。本轮官方云浏览器可用，但 0.0.0.0 devserver 接口枚举 EPERM，127.0.0.1 服务页面 ERR_CONNECTION_REFUSED；未绕过限制，实际页面截图 / 视觉验收仍未完成。第 11 项列明的 8 项旧打包基线失败仍保留。

- 额外架构审查已复现总 build 的后置门禁失败：check:electron-runtime-dependencies 的生产依赖 allowlist 未纳入已实际使用的 @earendil-works/chord / pi-durable。本轮仅 build:vite 产物与轻量 CI 构建通过，不代表总 build、安装包或发行通过；该问题已在第 13 项修复并由总 build 与生产依赖独立安装验证，不以删除真实依赖绕过。

## 13. 原生迁移后的恢复链与构建收口 — 已发布并通过 CI

- 用户已批准按只读审查清理：恢复入口迁到现有原生 UI 恢复，保留请求水位与长消息内容投影；删除无生产者的旧 RunSnapshot 协议，不删除活跃会话消息缓存。
- 构建保持严格部署清单，明确保留真实 Durable / chord 运行依赖；移除无消费者 AnyDoc。门禁同时检查主入口与 Worker 外部依赖，并验证部署根目录解析，不以开发依赖兜底。
- 删除 Office 截图孤岛 / 专属交付策略 / 旧 WSL 脚本，保留正常 DOCX / XLSX 产物预览；内置 Coding plan / elicitation 能力按实际实现收口，外部 ACP 协议保留。
- 本地 renderer/shared 260 套 / 1444 项、原生执行 / 内容投影 / 保留 Coding 合同 144 项、恢复专项 26 项、依赖 / 清理契约 14 项通过；计数包含重叠，不合计为总数。双类型、lint / 格式、清洁总 build、严格运行依赖解析和 bundle budget 通过，干净产物没有旧 Office 截图入口。
- 首批[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/e8f8a96115cd237aebd4bd52a7c9b5ea45a8a69c)。二次扫描追加删除无生产消费者的 ToolActivityTracker、七组旧运行选项 / 历史 DTO 和已移除包的测试转译配置；不删除仍使用的共享工具状态契约。
- 二次扫描[已发布](https://github.com/rongxinzy/zhiyuan/commit/e59fba1a1017b022798996338342c67ff40ad7fc)。本项两个代码批次合计删除 22 个文件，净减少 2337 行（含实现、契约、测试与文档），保留正常工具卡、ACP 与历史内容。
- [首批 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38548949644)，包括清洁总 build、严格依赖门禁、预算及独立 production-only 安装与运行依赖解析；本地安装回执不确定已由此独立验证补足。[最终代码 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38549446447)；未运行安装包 / 签名 / 发行，不清除用户历史。


### 保留的旧事件迁移边界

以下是已核实的调用关系与待验证行为，不计为本轮已完成的功能迁移，也不恢复独立 tracker：

- 工具活动增强：旧 `toolActivity` 监听经 Main 分别进入 Coding 事件记录 / 投影，以及 Cowork slice / TurnBlock 的参数生成与活动行；当前原生 host 不生产该旧事件。正常 `tool_use` / `tool_result` 经原生消息投影仍产生工具卡与结果，外部 ACP 另有独立工具更新。仅确认旧瞬时增强链断开，尚未实机验证参数流式进度是否存在视觉缺口；共享 ACP / 历史字段保留。
- 重试提示：旧 `retryNotice` 经 Main、RuntimeNotice IPC 与 renderer 服务显示顶部提示，不持久化，也无 ACP 消费者。原生 generation retry / auto-retry 事实尚未映射到此提示链；最终错误与任务终态仍正常投影。这是旧提示通路未接，不代表重试执行失效，实际失败重试体验尚未验收。
- 中断原因：旧 `sessionInterrupted` 在 Cowork 清审批与置闲，在 Coding 写取消事件 / NeedsReview；历史消息也读取旧中断原因。当前原生取消回执、停止、完成、错误与暂停状态仍有投影，但审批拒绝走原生工具错误 / terminate，没有旧 cause / recoverable 元数据。正常停止保留；拒绝后 Coding 是否需要 NeedsReview 须专项行为验证，不能凭旧字段直接改终态。

## 六阶段基线验证与剩余验收

六阶段代码均已发布。六阶段代码版本：[9abb416](https://github.com/rongxinzy/zhiyuan/commit/9abb41682d1949b9296e0daffc1f8d2a5183ddc2)。后续用户追加需求单独列项；上述版本的验证证据仍保留。

- [全库轻量 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38520513595)：双类型检查、renderer/shared 1831 项、原生执行与档案 53 项、侧车与打包契约 23 项、renderer 构建。侧车 2 项 opt-in / 平台测试跳过；Linux 原样 Go 进程纵切已另行实际执行。
- [Python Linux / Windows 专项 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38520513522)：使用真实下载校验后的运行时和真实系统进程，不以 mock 代替安装或进程清理。
- 尚未做：Electron 桌面视觉与完整重启手工验收；最终安装包、签名、公证与发行；macOS / ARM64 Python 运行矩阵；真实 GPU 工作负载；全链路离线验收。
- 能力边界：进程与依赖隔离不是文件系统 / 网络沙箱；外部工具副作用不保证 exactly-once；不承诺跨工作长期记忆；Magpie 非 Linux 平台目前只有原样交叉编译与哈希校验。

## 发布与验收规则

- 分批直接推 main，发布前检查远端并用 expected SHA，禁止覆盖他人提交。
- CI 后台运行，不阻塞继续实现；本次引入的失败修复并追踪终态，不删除有效断言掩盖问题。
- 每个批次更新本清单的真实状态、验证与远端提交链接。签名、发行、部署和个人文件清理不包含在代码推送中。

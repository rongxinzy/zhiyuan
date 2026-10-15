# 产品重构执行清单

更新：2026-10-15。此文件是本轮重构的唯一执行清单；“已发布”须有远端 main 提交，“实现中”不代表可验收。按下列依赖推进，独立模块可并行。

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

以下记录第 13 项结束时的调用关系与待验证行为；后续迁移与专项验证见第 14 项，不恢复独立 tracker：

- 工具活动增强：旧 `toolActivity` 监听经 Main 分别进入 Coding 事件记录 / 投影，以及 Cowork slice / TurnBlock 的参数生成与活动行；当前原生 host 不生产该旧事件。正常 `tool_use` / `tool_result` 经原生消息投影仍产生工具卡与结果，外部 ACP 另有独立工具更新。仅确认旧瞬时增强链断开，尚未实机验证参数流式进度是否存在视觉缺口；共享 ACP / 历史字段保留。
- 重试提示：旧 `retryNotice` 经 Main、RuntimeNotice IPC 与 renderer 服务显示顶部提示，不持久化，也无 ACP 消费者。原生 generation retry / auto-retry 事实尚未映射到此提示链；最终错误与任务终态仍正常投影。这是旧提示通路未接，不代表重试执行失效，实际失败重试体验尚未验收。
- 中断原因：旧 `sessionInterrupted` 在 Cowork 清审批与置闲，在 Coding 写取消事件 / NeedsReview；历史消息也读取旧中断原因。当前原生取消回执、停止、完成、错误与暂停状态仍有投影，但审批拒绝走原生工具错误 / terminate，没有旧 cause / recoverable 元数据。正常停止保留；拒绝后 Coding 是否需要 NeedsReview 须专项行为验证，不能凭旧字段直接改终态。

## 14. 原生事件投影与当前打包契约 — 已发布并通过 CI

- 用户批准继续迁移第 13 项三条旧事件链，并修复 8 条过时打包断言。正常工具、ACP、历史显示与用户数据保留。
- 原生工具消息负责参数 / 结果更新，重试提示来自原生 live view；终态来自原生回执。审批拒绝必须取消执行，不能因工具 terminate 被计作成功；普通工具错误仍可由模型处理，真正运行失败保持失败。
- Coding 使用同一消息身份投影工具修订，取消原因直接来自原生停止回执；迟到审批不得使结束的任务重新显示运行中。Cowork 内容帧保留有界工具参数预览，并覆盖帧先于消息到达的恢复场景。
- 旧打包检查迁到当前固定 Magpie、PBS / uv / Job Object、轻量 CI、总 build 与 production-only 部署合同；保留 ACP / npm、图标、更新元数据及签名配置的有效约束，不恢复归档发布工作流。
- 实际修复审批拒绝曾经产生原生成功回执的问题：拒绝文本先提交到原生工具记录，再执行原生 abort；Cron 不再报告成功。真实 SQLite 验证重复拒绝 / 迟到批准 / 后续 Stop 隔离、关闭后重读、暂停后显式恢复、普通工具错误后模型继续与真正模型失败。旧 Stop 异步读取期间新输入开始的竞态有反证与回归。
- 删除无消费者的旧异步 admission 失败补偿模块；启动 / 继续等待原生 admission 并通过 IPC 返回失败，原生运行错误仍进入持久消息与状态通路。
- 本地完整 renderer/shared 260 套 / 1439 项通过；综合原生 / 内容回放 / Coding / 当前打包契约 22 套 / 194 项通过。双类型、lint / 格式、清洁总 build、生产-only 目录解析与包预算通过。原 8 项过时打包失败已迁为 14 项当前合同并通过，纳入现行 CI；不再作为未解决失败保留。
- [代码已发布](https://github.com/rongxinzy/zhiyuan/commit/bcf948b7e4870c786ebd0394ec1d535d6db29b3b)，[本批 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38553560618)：renderer/shared 1439 项、原生执行 67 项、内容回放 / Coding 113 项、历史 25 项、侧车与当前打包契约 106 项通过，5 项平台 / opt-in 跳过；总 build、包预算与隔离 production-only 安装解析通过。云端缺少真实 Magpie 平台产物、Windows Job helper 和 Electron 可执行文件，未进行完整安装包解包 / 启动验收；已有安全限制不绕过，视觉 / 安装包手工验收仍未完成。

## 15. Windows x64 可验收安装包 — 已生成，实际安装与自动验收通过

- [验收代码 c71f42c2](https://github.com/rongxinzy/zhiyuan/commit/c71f42c2aadc68d0ac0681f5d235f8380700896a) 的[完整 Windows CI](https://github.com/rongxinzy/zhiyuan/actions/runs/38586504578)与[源码 CI](https://github.com/rongxinzy/zhiyuan/actions/runs/38586504365)均成功。独立按需流水线不使用签名秘密、不发布 Release；只有实际安装后全链通过才上传 exe。
- [验收 artifact](https://github.com/rongxinzy/zhiyuan/actions/runs/38586504578/artifacts/11906239721) 是 ZIP，内含 `ZhiYuan-Agent-Acceptance-2026.7.16-x64.exe`、源提交、校验清单、日志与真实窗口截图；保留至 2026-10-28 15:25:20 UTC。实际下载并重新计算 exe SHA-256：`5f839757d03e2b7ad938be86f235f1c773ba57363b708fe40cb25530bbc61374`，与构建 manifest 一致。
- 清洁总 build、隔离 production-only 依赖解析、固定原样 Magpie / MIT / 哈希、包内 Runner / Job Object / SQLite / WASM 检查通过。实际 NSIS 安装 exit 0；安装后的 Electron 首页可加载及交互，无记录的主进程 / 渲染崩溃。真实截图保存在 artifact 的 evidence 中，不能据此宣称所有页面 / 窄窗 / 深色均已视觉验收。
- 安装产物原位调用 Magpie 正常启停；Python Runner 使用真实 Windows Job Object，首次联网下载并校验固定 PBS 3.12.15 / uv，在独立 venv 执行得到 42。首次 Python 使用需要网络，不宣称离线预装。
- Windows Agent 使用 Pi 1.2 原生 PowerShell 工具，优先 pwsh、回退系统 Windows PowerShell；Unix 保持 Bash。安装后在无系统 Git PATH 的环境分别通过 PowerShell 7.6 / 5.1 的 Unicode、引号、空格工作目录、非零退出、审批拒绝不执行、主动停止杀子进程、Git worktree 检查。Git 精确解析到安装包管理的 PortableGit；完整 Git 发行包含的 Bash 文件不是 Windows Agent 默认工具要求。
- 修复了真实 Windows 集成阻断：ASAR 路径分隔符、大小写文件名碰撞、Git 归档 CRLF 导致固定哈希差异、NSIS 可选回调、旧七组件硬编码、模块路径下哈希调用与首次浏览反复跳设置。PATHEXT 缺失属于验收隔离环境缺项，已补标准值；不误称生产 Git 缺陷。
- 此 CI 机器系统 5.1 的四次独立 profile / 交叉对照启动约 25.4–27.0 秒，和 Electron 环境标志无相关差异。因此仅系统 5.1 验收普通命令预算调整为 60 秒；生产工具超时及 pwsh 预算不变，取消后的子进程退出仍须 10 秒内验证。该机器性能不代表所有用户机器。
- 安装包无签名，可能显示系统信誉 / 未验证发布者提示。没有真实账户登录、付费模型调用或用户桌面操作；签名 / 发行认证、用户实机手工验收、完整视觉矩阵与真实 GPU 工作负载仍未完成。

## 16. 安装包原生残留清理与防回归 — 已发布，缩减后的安装包全链验收通过

- 用户批准清理实际安装包中确认无运行用途的 P0 残留：原生编译中间文件 / 调试数据库 / 静态库与工程文件、SQLite 测试扩展，以及不属于目标 OS / 架构的预编译文件。开发依赖与原始源码安装不改，目标运行库 / loader / 许可证和完整 Git 运行发行保留。
- 按依赖包精确设置打包过滤，禁止全局删除 build 或 src；最终 app.asar 与 unpacked 的实际清单必须通过独立门禁，同时验证目标 SQLite / PTY / 平台运行库仍存在。脏 fixture 必须证明门禁拒绝，不能仅检查配置字符串。
- [包代码 87debca8](https://github.com/rongxinzy/zhiyuan/commit/87debca850334cd8d9682cee4b00fe9a9921347f) 的[源码 CI](https://github.com/rongxinzy/zhiyuan/actions/runs/38598564026)及[Windows 全链 CI](https://github.com/rongxinzy/zhiyuan/actions/runs/38598564154)均成功。实际下载的 exe 为 211,794,861 字节，相比旧合格包 c71f42c2 的 222,502,610 字节减少 10,707,749 字节（10.71 MB，约 4.81%）；这是实际压缩后安装器比较。
- 最终 app.asar 为 95,658,312 字节，unpacked 为 24,262,866 字节，合计 119,921,178 字节；旧包相应合计 176,209,448 字节，实际减少 56,288,270 字节。许可证保留导致部分 ASAR 字节增加，不能把过滤候选的理论体积直接当最终节省。实际清单检查 8838 项，禁止残留为 0，必需目标原生运行模块均存在。
- 同时修复 electron-builder 平台仅负向 files 规则被归一化为额外默认 matcher、自动补 **/* 导致根目录误入包的问题：平台规则显式保留正向入口；真实归一化 / FileMatcher 回归证明旧配置会纳入源码，新配置拒绝源码、测试缓存和工具链。最终 ASAR / unpacked 另有根目录白名单，Windows x64 两者各 128 MiB 预算；真实脏包、缺件、错误架构、物理游离文件、同路径重打包缓存及超预算反例均有门禁测试。
- 新包实际 NSIS 安装 exit 0（约 49.1 秒）；安装后 UI、Magpie、Python 执行 42、PowerShell 7.6 / 5.1 的全部专项检查均通过，报告 passed 为 true、errors 为空；SQLite / Durable / PTY / Photon 包内运行检查通过。与第 15 项相同，仍为无签名测试包，首次 Python 使用需要联网；未扩大为所有平台 / 视觉 / 真实账号验收。
- [缩减后的验收 artifact](https://github.com/rongxinzy/zhiyuan/actions/runs/38598564154/artifacts/11913438818) 为 ZIP，包含同名 exe、构建 manifest、SHA 清单和 evidence；保留至 2026-10-28 16:47:48 UTC。exe SHA-256 实测为 `7a998e6445df97cfd063a94ec408397a40559e73d3eba78ef223b99c2d6a7a33`，与 manifest 一致。包固定对应 87debca8，后续文档提交不改变包来源；旧合格 artifact 保留。

## 17. Windows 安装向导终点与交互验收 — 底层修复已推送，正式安装壳接入中

- 用户实机截图暴露第 15 / 16 项只覆盖静默安装，没有覆盖交互向导：首屏隐藏原生 Next 后未恢复，自定义完成页漏掉 MUI 标准 `SetAutoClose true`，安装节结束仍停在无可用动作的进度页。旧进度位图直接附在向导顶层，离页只清句柄，实际不会随内部页面销毁，可能遮挡完成页。
- 底层 NSIS 改为系统原生向导：单一标题、可选择并换行的安装位置、必要许可、原生进度与详情、明确“关闭”与“启动”。移除拼贴位图 / 重复字标 / 假进度动画和旧本地推理安装选项；首批仅修复底层 NSIS，未作为最终界面交付。字体与布局按 DESIGN.md 原生安装规范，使用系统微软雅黑及随 DPI 缩放的 dialog units。
- 成功推进使用 NSIS 原生节完成机制，禁止从“安装完成”状态文本提前跳页；安装失败不进入成功页。关闭不启动应用，显式启动检查返回值，失败保留可重试完成页；静默安装不启动应用。修复旧进程匹配把单引号当路径分隔符的错误，按安装根边界匹配，不按进程名广杀。
- 新增真实 Windows HWND 交互验收：从许可禁用状态点击安装，必须自动抵达完成页并保存真实各页截图；关闭退出、不自动启动；已有安装打开后取消不改运行进程 / app bytes / 注册；真实文件共享锁造成可恢复错误，释放锁后重试安装、显式启动并确认安装目录内的应用窗口。交互报告绑定同一 exe SHA-256 / commit / run，最终交付门禁必须同时满足交互验收与原有静默安装、UI、Magpie、Python、原生执行和包体门禁。
- 本地已通过：30 项 NSIS 回归、NSIS 3.0.4.1 Unicode 安装 / 卸载预览严格编译、lint、格式、清洁总 build 与生产依赖解析。首轮 Windows run 38674560505 已实测中文首屏 → 进度 → 完成（约 44 秒，96 DPI）及关闭不启动；后续升级取消检查因驱动把 electron-builder 的 InstallLocation 查错注册表位置而失败，并被重复 taskkill 清理遮盖。驱动修复后需重跑全链，不能以局部通过交付。未实际覆盖的高 DPI 不宣称验收。
- 原样 Magpie、Pi Durable、Python 架构、现有用户数据与包体防回归门禁不变；仍只生成无签名验收包，不发行签名版或覆盖旧合格包。

## 18. 既有 WebView2 单文件安装壳接入 — 实现与验收进行中

- 用户指出主仓库已有新版界面，核实 [RongxinAI PR #943](https://github.com/rongxinzy/RongxinAI/pull/943) 已合入 860×560 WebView2 壳，zhiyuan 也已继承同份实现；缺口在实际打包流水线仍只生成 NSIS，不能称为壳未迁入。按既有版式接入 build-shell → pack-setup → 真实 win-unpacked / windows-components，NSIS保留底层及更新用途。
- 普通 `dist:win` / `dist:win:offline` / `dist:win:lite` 统一走 `dist:win:setup`，先生成更新用途的 `dist:win:nsis`，再 build-shell / pack-setup，避免下次普通构建漏壳。`dist:win:signed` 与 enterprise 原流程未扩展，仍为原 NSIS 路径，不能声称所有签名 / 企业发行入口已支持新壳。
- 最终交付对象改为包含真实载荷的单文件壳 exe，记录其自身 SHA-256、载荷边界与包体预算；原有 ASAR / unpacked 禁残留、必要原生模块和 NSIS 预算继续执行。旧合格包保留，新的壳未完成真实 Windows 验收前不标为可交付。
- 保留数据同时覆盖壳与生产 NSIS（deleteAppDataOnUninstall=false）；任意杀进程前先校验目标安装目录归属。旧版清理只接受事务明确记录的精确备份，不扫描 `.old*`，保留其他手工备份与历史数据，未知组件恢复状态明确拒绝且保留记录。
- 清除壳中的 localInference 旧契约及 CPU / CUDA 选项，保留实际许可确认；加入明确的失败 / 重试与启动失败保留页面，长路径换行。引擎同步检查真实解压退出码、当前组件哨兵、事务回滚、取消及数据保留，避免错误宣称成功；WebView2 缺失提供明确支持提示，不暗中下载。
- 新增最终壳真实 Windows 可见点击、安装 / 完成 / 启动 / 关闭 / 取消 / 锁冲突恢复与截图门禁，并将后续完整应用专项验收绑定同一壳安装结果。设计预览与模拟事件只用于本地 UI 回归，不能冒充 Windows 验收；DPI 只报告实际测得或明确标出的测试范围。
- 本地验证：安装壳 / SFX / 交互交付 / 共享脚本相关 73 项通过，44 项 Windows / .NET 依赖项在常规云端环境跳过；完整 lint、格式、清洁 build 与生产依赖解析通过。官方 .NET 8 的常规 CLI 受云沙箱 NuGet 命名互斥锁限制；改用该 SDK 已有 Roslyn 直接编译实际引擎与行为 harness，编译 / 运行 exit 0，验证中断升级恢复、首次失败清理、已提交事务保护、用户数据保留、非法路径拒绝和 SFX host 拷贝。完整 WinForms / WebView2 仍必须由 Windows CI 编译验证。
- 壳接入已推送 [28113494](https://github.com/rongxinzy/zhiyuan/commit/28113494cd63aece05ba350940ea3e36abbd21f7)。[Windows 验收 run 38680167144](https://github.com/rongxinzy/zhiyuan/actions/runs/38680167144) 正在运行；同批 source CI 的双类型、renderer / 历史 / 原生测试已通过，包装契约测试仍假定 dist:win:offline 是内联 NSIS 命令而失败。现将断言改为验证完整首装组装链及 NSIS / signed / enterprise 实际叶子命令的 --publish never，签名 / Magpie 防护不删减，继续重跑。
- [9eb46182 源码 CI](https://github.com/rongxinzy/zhiyuan/actions/runs/38680668486) 已全部通过。首轮 Windows 前置回归 235 项通过、4 项失败，实际 .NET 引擎行为 11 项已通过；尚未进入最终壳打包。失败定位为 PowerShell 冷启动诊断预算过短、注册表及清理 marker 的 8.3 / 长路径比较不对称，以及 Windows PowerShell Junction Target 将方括号路径当通配符。修复保留原断言，增加真实短路径与含特殊字符路径回归；junction 通过固定系统命令和子进程环境传递字面路径，取消延迟展开。
- [3dd10f84 Windows run 38681273694](https://github.com/rongxinzy/zhiyuan/actions/runs/38681273694) 已通过全部前置回归、实际 NSIS 构建、包体 / 资源 / SQLite / WASM 门禁，并再次完成中文首屏 → 进度 → 完成和关闭。其后取消校验错误地把任意已有 .old 目录当作本次取消产生的改动，未记录取消前基线；原应用存活、EXE / ASAR 哈希与注册表检查均已通过。改为记录前后精确备份差分并核对当前目录身份，不能把此结果当作 WebView2 取消缺陷（该步骤尚未执行）。
- 另修复底层 NSIS 使用 ANSI FileWrite 保存中文备份路径的问题，改用 UTF-16LE BOM 并补真实中文 marker 清理回归；精确清理原则不变。诊断收集只增加真实 native CI 安装目录的精确白名单，避免失败证据被原静默路径限制拒绝。正式壳编译 / 真实 SFX 组装提前到 native UI 验收前，以更早暴露最终壳构建问题，所有 UI、静默、应用专项与 artifact 成功门禁保留。
- [e1c161cf Windows run 38683704850](https://github.com/rongxinzy/zhiyuan/actions/runs/38683704850) 已实际完成正式 .NET 8 / WebView2 单文件壳编译与真实载荷组装，所有前置回归、包体及原生探针通过。NSIS 首次安装与取消后的目录 File ID / 应用进程 / 字节 / 注册表保护也通过；真实锁冲突重装暴露 StopAppProcesses 内嵌 PowerShell 多余右括号，导致停止进程命令解析失败，现修复并增加从生产宏提取的真实 Windows parser / 进程终止及外目录进程保留回归。该问题属于底层 NSIS，不能归因到尚未运行的 WebView2 UI。
- 后续将实际壳 UI 与应用 smoke 的运行条件绑定各自上游成功，即便 NSIS 专项失败也可收集独立壳证据；各自使用隔离安装目录。失败状态仍保留，最终交付与 artifact 上传仍要求所有必需门禁成功，禁止 continue-on-error。
- 数据边界追加审查发现 NSIS 原来仅检查路径长度，不能阻止误选个人或系统目录。现改共享只读目录归属校验，覆盖安装 / 卸载每次停止进程前、重试重命名前，以及 electron-builder 早于 customUnInit 的 stock hook；非空目录必须有物理应用及 ASAR 身份，拒绝系统树 / 个人根 / 用户数据与缓存重叠及目录链接。WebView2 同步完整身份和系统树拒绝边界，合法 Program Files 子目录继续允许。
- 共享卸载清理只回收当前 portable-git 契约中有匹配完成记录的精确版本，保留未知组件、历史手工备份与 retired runtime-packs；先无跟随解除应用树链接，失败不允许 NSIS 模板继续递归删除。注册表仅清理当前 hive / view 中安装位置精确匹配的记录；删除本仓历史 --delete-app-data 真实用户目录删除实现。
- [e8526586 前置回归](https://github.com/rongxinzy/zhiyuan/actions/runs/38685807388) 260 项通过，新增进程测试把 PowerShell 首次模块初始化的 CLIXML progress 当 stderr 错误而失败，已修测试区分；不删除实际 parser、停止进程及外目录保留断言。安全追加批次需再次完整 Windows 验收，不沿用此前部分成功标记为 ready。
- [e9136d82 Windows 前置回归](https://github.com/rongxinzy/zhiyuan/actions/runs/38687927249) 275 项通过，新增目录归属 / C# 恢复边界实际测试已通过；剩余两个 fixture 问题为 PowerShell 5.1 Start-Process 返回对象的 ExitCode 未可靠保留，以及“外部 resources”夹具实际放在应用树内部。分别改用直接 Process 句柄取得真实退出码、将目标放在真实外部同级目录并加位置前置断言；保留进程与外部链接保护原断言。
- [412b425c Windows run 38688890115](https://github.com/rongxinzy/zhiyuan/actions/runs/38688890115) 全部前置安全回归通过；正式 NSIS 卸载器编译发现新增安全提示定义被 installer-only customHeader 条件排除，触发 Slovak 语言表警告并被 -WX 正确阻断。共享提示移至公共字符串表，新增直接包含完整生产 NSIS、使用 electron-builder 真实 26 语言生成器的安装 / 卸载双编译前置回归；本地真实双 pass -WX 已通过，不关闭警告或缩减语言。
- 1807cdfc 的新编译前置在 Windows 发现探针将绝对路径统一转为正斜杠，NSIS include 未找到文件；其余 277 项通过。探针改用平台原生 path.join，并补 Windows / POSIX 渲染单测及 Linux 实际 26 语言双 pass -WX；生产安全逻辑未变。
- [6921d9bc Windows run 38692363285](https://github.com/rongxinzy/zhiyuan/actions/runs/38692363285) 前置安全回归、26 语言安装 / 卸载编译、包体检查及最终 WebView2 单文件壳组装通过；真实 NSIS 首次安装、取消保护、锁冲突提示与重试至完成已通过。剩余点击驱动将原生单一 OK 固定为 ID 1，而真实弹窗为 ID 2，导致启动失败恢复与缺 WebView2 提示确认停住；现按同一 PID / HWND、标题、正文和唯一可见启用的语义确认按钮匹配，NSIS 额外验证模态 owner，并增加真实 Win32 双 ID / 错误窗口拒绝回归，不放宽退出与恢复要求。
- 2249ad4e 的 Windows 前置回归 280 项通过；新真实对话框 fixture 已识别并点击关闭两种控件 ID，但错误要求 MessageBox 返回值等于改写后的控件 ID。改为验证 MB_OK 的语义返回 IDOK，保留真实控件 ID 1 / 2、模态归属及拒绝错误窗口全部断言。
- [ccbf22ca Windows run 38696398617](https://github.com/rongxinzy/zhiyuan/actions/runs/38696398617) 所有前置检查、NSIS 完整交互和静默回归通过。最终 WebView2 壳真实首屏 / 进度已截图，缺运行时提示与失败退出通过；首次安装完成应用解包、组件展开 / 激活 / 连接与运行时检查后，在注册 / 快捷方式收尾出现 ArgumentException。尚无堆栈，不能归因中文路径；补无源路径方法栈 / HRESULT 和分步 COM 诊断，以及实际 MTA 临时中文目录快捷方式创建 / 回读前置测试，失败页另行截图且不覆盖原异常。
- [3265d413 Windows run 38699564913](https://github.com/rongxinzy/zhiyuan/actions/runs/38699564913) 前置真实 MTA 调用已精确复现 WScript.Shortcut.TargetPath 赋值抛出 ArgumentException / 0x80070057，取得 COM 方法栈。改用显式 Unicode IShellLinkW 和 IPersistFile 保存，保留中文目录 / 中文应用名；前置仍实际创建快捷方式，并用独立 COM 对象重新加载、核验目标 / 工作目录 / 图标，错误继续回滚，不跳过快捷方式。
- [c988f17c Windows run 38700864300](https://github.com/rongxinzy/zhiyuan/actions/runs/38700864300) Unicode 快捷方式真实创建 / 回读、安全前置、NSIS 交互与静默全部通过；最终壳首次安装已实际完成并截图清晰的关闭 / 启动按钮。实际点击关闭后未退出，现有证据只证明指针命中和输入响应，不足判断 DOM / 宿主回调；补每会话被动点击 / JS 异常与宿主关闭生命周期元数据，未更改退出标准或猜测修复。
- [673416c4 Windows run 38704698602](https://github.com/rongxinzy/zhiyuan/actions/runs/38704698602) 被动日志确认完成页真实 trusted click、引擎 operation-finished，但宿主没有收到 web-message；改为初始化成功后直接订阅 CoreWebView2 原生消息源并显式启用消息，保留原 JSON / 生命周期逻辑。另实际浏览器发现 HostObjectAsyncProxy 不支持直接 catch 的异常，改原生 Promise 接管并用仅 then 的代理回归。NSIS 本轮完成页偶发未退出，同一正确按钮仍启用可见；补可验证的对话框激活前置后只投递一次 BM_CLICK，不放宽 60 秒退出要求。
- [1934ca4f Windows run 38708753872](https://github.com/rongxinzy/zhiyuan/actions/runs/38708753872) 前置、NSIS 交互与静默通过，HostObject Promise 异常消失；最终壳完成页真实 trusted click 后仍没有宿主消息，原生 Core 事件订阅未解决关闭，不能宣称内部平台根因已证实。关闭控制改走已实际驱动安装的 HostObject 桥 RequestClose，异步投递到原 Close / FormClosing，保留安装中取消并等待回滚；启动仍仅成功后请求关闭，预览不变，退出继续以真实进程为准。
- [e244a75d Windows run 38712483618](https://github.com/rongxinzy/zhiyuan/actions/runs/38712483618) 最终壳首次安装 / 完成 / 关闭退出 0 且不误启动已通过；已有运行安装取消、升级早期取消保数据也通过。后续 post-detach 取消取证等到迟到阶段日志时升级已正常完成：26,840 条载荷进度经过 UI 双重排队，证据显示引擎 done 时页面仍准备安装包 74%。直接以真实 journal / GUID 旧备份 / 新解包输出触发取消，并对实际进度洪泛做源头限频与 UI 投递顺序修复，保留真实回滚断言。
- [614eb339 Windows run 38716875077](https://github.com/rongxinzy/zhiyuan/actions/runs/38716875077) 前置、NSIS 交互 / 静默及最终壳首次安装 → 完成 → 关闭通过；源头限频后首次安装事件降至 140 条，已有运行安装取消保护仍通过。升级开始后 10ms 的真实取消点击未取消操作，引擎正常完成，早取消门禁正确失败；继续修复安装启动与取消的顺序，后续 post-detach / 最终启动尚未执行，不能沿用上一轮早取消成功作为本轮结果。对应源码 CI 已全部通过。
- 早取消已定位为跨线程 Start 先排队、随后更换 CTS，而 Cancel 直接取消旧 CTS。改为宿主短同步接纳后返回，页面立即保留取消意图、接纳后发送取消；接纳不等待安装完成。每次操作捕获独立 token，完成后准备下一 token，取消在 UI 串行且仅作用活动操作；旧页面接纳请求不跨重试。增加延迟 then-only 接纳 / 拒绝 / 重试回归，真实取消后出现 DONE 或非取消错误立即使驱动失败，不再等满超时。
- 接纳契约独立复核另发现：错误已显示但上次引擎仍在 finally 清理解包载荷时，快速重试被 active guard 静默忽略，页面会停在进度页。改为明确拒绝本次接纳并提示稍候重试，保留上次操作及回滚直至真正结束；实际 C# 回归验证重复启动拒绝不影响原任务取消，页面已有拒绝后重试覆盖。
- [0b0cb270 Windows run 38724238943](https://github.com/rongxinzy/zhiyuan/actions/runs/38724238943) 实际早取消已通过：宿主接纳 → 取消 → 回滚结束，应用 / 注册 / 用户数据保持；新版壳首次安装 → 完成 → 关闭也再次通过。post-detach 用例在首次重命名前报告目录占用、running=0，未到目标取消窗口；同轮 NSIS 锁冲突释放后点击 Retry 已新建第二个错误弹窗，并非首次点击丢失。当前诊断未保留原重命名错误码，不能断言实际锁持有者。源码确认停止进程没有等待异步终止完全结束，补精确已匹配进程句柄的有界退出等待及原始异常诊断，保留真实运行应用升级用例，不由驱动提前杀掉应用绕过。
- 同步主仓实际发现的共用驱动缺陷：页面尚在加载、document.body 尚未生成时读取快照抛异常。快照改空文档返回未就绪，仍等待真实宿主 / 首屏 / 安装位置就绪；增加空文档 → 实际 DOM 生成回归，不模拟安装事件或点击。
- [462dc1ba Windows run 38730293432](https://github.com/rongxinzy/zhiyuan/actions/runs/38730293432) 317 项真实前置全部通过；最终 WebView2 壳交互报告 passed=true、14 项检查全过，首次安装 / 关闭、已有运行安装取消、早取消、真正 detach 后取消回滚、锁失败重试、启动失败恢复及正确应用窗口出现均已实际验证，保留数据及手工备份。独立壳安装后完整应用报告亦 passed=true、errors=[]，原有 Magpie / Python / 原生专项通过。实际截图与报告位于该 run 的 diagnostics artifact 11971233157。
- 同轮 NSIS 首次安装 / 完成 / 关闭和已有安装取消通过，锁恢复步骤的驱动枚举窗口抛异常；GetWindowRect P/Invoke 未声明 SetLastError，日志中的 1008 不是可靠的本次错误证据。修复枚举快照对已消失窗口的处理，并保留真实目标点击 / 截图严格校验。总门禁继续阻止最终 artifact，不能用已通过的 WebView2 / 应用专项替代剩余 NSIS 交互和静默检查。
- 当前状态：最终新版壳及其安装后应用已通过真实 Windows 验收；底层 NSIS 全链重跑完成前仍无 ready artifact。保持无签名验收包属性，正式签名 / 发行不在本次范围内。

## 六阶段基线验证与剩余验收

六阶段代码均已发布。六阶段代码版本：[9abb416](https://github.com/rongxinzy/zhiyuan/commit/9abb41682d1949b9296e0daffc1f8d2a5183ddc2)。后续用户追加需求单独列项；上述版本的验证证据仍保留。

- [全库轻量 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38520513595)：双类型检查、renderer/shared 1831 项、原生执行与档案 53 项、侧车与打包契约 23 项、renderer 构建。侧车 2 项 opt-in / 平台测试跳过；Linux 原样 Go 进程纵切已另行实际执行。
- [Python Linux / Windows 专项 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38520513522)：使用真实下载校验后的运行时和真实系统进程，不以 mock 代替安装或进程清理。
- 尚未做：完整 Electron 视觉矩阵与重启手工验收、签名 / 公证 / 正式发行、macOS / ARM64 Python 运行矩阵、真实 GPU 工作负载、全链路离线验收。Windows x64 实际安装及自动化原位运行已在第 15 项通过。
- 能力边界：进程与依赖隔离不是文件系统 / 网络沙箱；外部工具副作用不保证 exactly-once；不承诺跨工作长期记忆；Magpie Windows x64 已在第 15 项实际安装启停，其余非 Linux 平台仍只有原样交叉编译与哈希校验。

## 发布与验收规则

- 分批直接推 main，发布前检查远端并用 expected SHA，禁止覆盖他人提交。
- CI 后台运行，不阻塞继续实现；本次引入的失败修复并追踪终态，不删除有效断言掩盖问题。
- 每个批次更新本清单的真实状态、验证与远端提交链接。签名、发行、部署和个人文件清理不包含在代码推送中。

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

## 8. Magpie 统一模型设置 — 实施中

- 用户已确认：Magpie 统一管理 provider、凭据、模型目录与路由；Pi 负责执行、恢复与 Document。
- 知远只提供企业托管模型与本地 GPU 的薄适配，本地 GPU 模型也注册到同一目录；不修改上游 Go 代码。
- 待交付：原生 provider 薄适配、统一模型设置 UI、企业 / 本地注册与错误处理回归。

## 9. 原生历史与统一检索存储 — 实施中

- 用户已确认：Pi 原生历史与 Coding 自身事件各自保存真实记录，提供统一目录、cursor 分页、可重建 FTS5 检索、附件管理及一致备份恢复。
- 不再重建另一套任务执行真相，不主动清除用户历史数据。
- 首批只读目录 / cursor 分页 / 可重建 FTS5 / 原会话定位已经接入侧栏与实际 IPC；19 项组合测试、双类型检查与 Main / Preload 构建通过。[已发布](https://github.com/rongxinzy/zhiyuan/commit/fa7e594aea37a2fb06d567fa8cd28f0957f0ca40)，[CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38527096618)。
- 备份 / 恢复采用用户明确确认后的维护重启，在所有数据库与原生执行器打开前执行；本地已接真实原生目录选择、备份确认与重启入口，受管附件哈希快照、白名单历史导出、WAL 一致快照、校验及失败回滚已通过测试。配置、凭据与旧外部文件引用不随包导出。
- 后批本地 36 项历史 / 维护 / UI / 原生读取测试、双类型检查及 Main / Preload / archiveWorker 构建通过；CI 加入真实 SQLite 历史维护测试。尚未做 Electron 桌面完整重启手工验收。
- 搜索按 source revision 增量更新，原生库以 entry 水位补偿跨库失效；显式重建才全量扫描。预览 / 元数据 / 页面分别有字节上限，图像 base64 不传至历史列表；单条特别大的原生 entry 解析成本仍继承 Pi 官方存储实现。
- 新历史浏览与检索读取原生 entries；运行界面仍保留 CoworkStore 展示镜像缓存，旧历史兼容读取。备份保存原生检查点以及显示缓存 / 旧历史表，未增加第三套 transcript，也未声称旧镜像存储已经全部消失。

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

# 产品重构执行清单

更新：2026-10-14。此文件是本轮重构的唯一执行清单；“已发布”须有远端 main 提交，“实现中”不代表可验收。按下列依赖推进，独立模块可并行。

## 1. 原生执行与旧能力拆除 — 已发布并通过 CI

- 新工作经 Pi Durable 1.2.0 的 Conversation / Task / SQLite / native submission 执行；关闭与取消分开，工具默认 unsafe replay，保留权限检查。
- 旧会话只读；继续旧工作建立关联的新原生会话，不伪造检查点。
- 已移除旧 MCP、Skill、托管环境的实现、资源、安装链、配置和界面。
- 发布：[原生执行与拆除](https://github.com/rongxinzy/zhiyuan/commit/be55fd2bf10b57039cb84e0009a176818943ae12)、[测试收口](https://github.com/rongxinzy/zhiyuan/commit/bdc18f8986cdb73940a73a2017e216b8cec9a27b)、[连接测试时间一致性修复](https://github.com/rongxinzy/zhiyuan/commit/d7b911cb2997299cbb38799bc54307140b96b596)。
- 验证：本地 renderer/shared 277 套、1865 项通过；原生执行 36 项通过；双类型检查、lint、格式、renderer 构建通过。远端 CI 曾发现时间戳差 1ms，已修复实际数据路径并加时钟递增回归，[修复后 CI 全部通过](https://github.com/rongxinzy/zhiyuan/actions/runs/38509322389)。
- 尚未验证：实际 Electron 重启、真实 GPU、全部离线链路；不承诺外部副作用 exactly-once。

## 2. 删除 IM / cc-connect，Cron 使用 Durable Task — 已发布，CI 验证中

依赖：1。

- 删除外部消息渠道、授权/安装/配置/界面及打包依赖，保留应用内 Cowork 与 Coding。
- 宿主仅计算触发时间；每次计划执行映射独立原生工作，稳定 requestId 复用同次提交。
- 保留用户开关、下次执行、单次运行结果；重启不无限补跑；停止执行调用原生 abort。
- 验证要求：时间触发/时区/停机恢复、同次幂等、取消释放等待、无人值守不自动批准写操作、UI 与打包无旧入口。
- 当前：IM 前后端与打包已在本地整合；原生计划执行与取消 11 项测试通过；调度与原生共 161 项通过，重启投影 5 项通过，完整双类型检查通过。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 3. Engram 替换为单项工作 Document — 已发布，CI 验证中

依赖：1；可与 2 并行。

- 停止旧 Engram 服务、全局记忆读取/注入及专用投影表创建，不删除用户现存数据库或文件。
- 工作档案 UI、IPC 和原生事务已贯通，直接来自原生 Document，提供目标、约定、决策、进度的可见编辑与变更订阅。
- 原生事务原子写入、revision 冲突检查；不从聊天文本猜测档案，不保留跨工作长期记忆。
- 验证：原生读写、SQLite 重开、原子回滚、并发修订、跨会话隔离、旧历史只读、UI 读写回归通过；旧用户表未删除。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 4. 单一主题的浅色 / 深色 — 已发布，CI 验证中

依赖：2、3 的主要 UI 删除完成后收口。

- 保留当前默认一套主题的浅色 / 深色，删除多主题选择、主题包和多主题引擎；可保留组件 recipe。
- 本项是用户最新明确方向，覆盖旧 AGENTS 的保留全部主题要求。
- 验证：24 项主题回归、静态生成检查与样式审计通过；CSS 由约 2.98 MB 降至 0.80 MB。实际桌面视觉检查尚未执行。[已发布到 main](https://github.com/rongxinzy/zhiyuan/commit/ff6e9dd370f5293c42122c8ac9278ae2dba8d30e)。

## 5. Magpie 本地 Coding Agent 管理 — 原样构建与接入中

依赖：2；现有 Coding 正常功能保留。

- [上游 Magpie](https://github.com/yetone/magpie/blob/main/README.zh-CN.md) 固定源码版本，Go 代码原样编译为随包独立二进制，不修改或重写上游 Go 引擎。
- 前端可移植；保留 MIT 许可与归属。管理本地 agent、版本与模型配置的具体范围按核实后的上游能力实施。
- 验证要求：固定版本/校验、构建与生命周期、进程退出、安装包资源、IPC 安全边界、原有 Coding 回归。未发布。

## 6. 新 Python Runtime — 实现中

依赖：1、2；不恢复旧 managedPython / Skill 环境。

- python-build-standalone，固定 Python 3.12.x 并按兼容矩阵升级；uv；不使用 Git Bash。
- workspace 独立 venv；Main Process 调度独立 Runner；Windows Job Object 管理进程树。
- 提供 python.execute / python.install，运行时版本化及环境重建。
- 验证要求：平台兼容矩阵、依赖安装权限、取消/超时/退出进程清理、工作区隔离、重建与版本升级、实际 Windows 验证。未发布。

## 发布与验收规则

- 分批直接推 main，发布前检查远端并用 expected SHA，禁止覆盖他人提交。
- CI 后台运行，不阻塞继续实现；本次引入的失败修复并追踪终态，不删除有效断言掩盖问题。
- 每个批次更新本清单的真实状态、验证与远端提交链接。签名、发行、部署和个人文件清理不包含在代码推送中。

# 轻量 DevOps 规范

本仓采用知远跨仓协作规范。完整说明：[统一 DevOps 规范](https://github.com/rongxinzy/zhiyuan-docs/blob/main/guides/devops.md)。本文件提供离线可用的最小规则；本仓已有安全、设计、契约和发布检查继续执行。

- 变更通过 PR 合入默认分支，一份 PR 聚焦一个问题。
- 标题使用 `type(scope): summary`，scope 可省；英文、小写动词开头，尽量不超过 72 字符。类型使用 feat/fix/docs/refactor/test/perf/build/ci/chore/revert；破坏兼容用 `!` 并说明影响。
- PR 说明必填：改了什么、为什么、实际验证及结果。通常三段即可，中文或英文均可；未运行或阻塞项明确写出。
- bug fix 说明触发条件、原行为、原因和修复后行为；可重复行为缺陷优先加回归测试，不能合理自动化时说明原因与手工验证。小修复不强制开 issue。
- 所有 PR（含文档）默认需一次正式 GitHub approval，新增提交使旧 approval 失效；仅管理员可通过 PR 绕过 review。独立 AI 可辅助审查，但评审报告或作者自审不替代正式 approval；高影响变更由维护者确认。
- AI review 在 PR 记录 reviewer、提交 SHA、结论和未解决事项；权限/密钥、不可逆迁移或删除、生产发布策略等高影响变更需维护者确认。
- CI、门禁脚本及触发配置变更需维护者检查 diff 与适用工作流是否一致；绿色 CI 不能替代这项 review。
- 合并前相关检查及现有必需 CI 通过、阻断意见已处理、说明与最终 diff 一致；默认 squash，已有合并策略优先。新增实质修改后复核相关变化。
- 跨仓变更链接依赖 PR，并在需要时说明兼容和发布顺序。合并、构建、部署、业务验收分别记录，不能相互代替。
- 紧急生产修复保留 PR、最小验证与回滚说明，取得 approval 且通过必需 CI 后合并；下一工作日补充完整验证，不绕过分支保护和安全/发布门。

## 当前仓库 CI（2026-10-14）

按仓库所有者要求，继承的 CI、签名、安装器、发布和定时工作流已移至
`.github/archived-workflows/`，不再触发。原 `ci-gate` 不再运行。
`Lightweight CI` 使用 Node 24、Bun 1.4.0，检查 renderer/shared 与主进程类型、原生恢复 / 档案 / 历史与 Coding 契约，执行清洁总 build、严格生产依赖门禁及 renderer 包预算。另在临时目录只安装 production 依赖，验证所有生成 bundle 的外部模块解析及原生执行导出，防止开发依赖掩盖遗漏。

现有 `Python runtime process containment` 保留针对 Python 相关路径的 Windows / Linux 专项测试。上述两个工作流均不使用发布 secrets，不签名、不发布；轻量源码构建不下载 Electron 二进制，Python 专项会验证固定的官方 Python / uv 运行时。触发范围同步于 `.github/devops-ci.json`。

本次调整不修改 GitHub 分支保护或 rulesets，也不把新检查设置为必需门禁。
是否允许直接推送以所有者对具体工作的授权及服务器实际规则为准；禁止强推和删除。
恢复旧工作流前须重新审查触发器、权限及发布目标，不能直接假定旧凭据可用。

## Windows x64 验收构建

按所有者明确要求新增 `Windows x64 unsigned acceptance`：手动或仅验收 workflow / 脚本路径变更触发。它安装官方 Electron、构建固定原样 Magpie 和 Windows Job Object helper，使用独立无签名 overlay，`--publish never`，不读取签名秘密、不创建公开 Release。安装后真实 UI / Magpie / Python smoke 全部通过才上传 exe 与证据，失败只保留诊断；CI artifact 保留 14 天。Python 首次使用仍需网络下载并校验固定官方 PBS / uv。验收构建不属于 PR 必需检查，清单记录为 optional。

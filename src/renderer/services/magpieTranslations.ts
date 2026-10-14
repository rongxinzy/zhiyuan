export const magpieTranslations = {
  zh: {
    magpieTitle: '本机 CLI 模型管理',
    magpieManagerDescription: '通过独立的 Magpie 管理本机 Agent 模型配置。',
    magpieActivationNotice:
      '启用后，Magpie 会读取并自动同步本机 Agent 配置。刷新管理状态也可能同步配置；选择模型后需点击“应用到 CLI”写入。',
    magpiePrivacyNotice:
      '默认不启动。自动订阅发现、遥测与局域网访问关闭。停止服务不会撤销已经写入的 Agent 配置。',
    magpieEnable: '启用本机 CLI 管理',
    magpieCheckStatus: '检查服务状态',
    magpieRefreshManagement: '刷新管理状态',
    magpieOpenManagement: '打开官方管理界面',
    magpieStop: '停止服务',
    magpieApplyModel: '应用到 CLI',
    magpieSelectModel: '选择模型',
    magpieApplyNotice:
      '应用会通过官方 Magpie 接口修改对应 Agent 的模型配置。请在该 Agent 中开启新会话以使用新配置。',
    magpieNotLoaded: '点击“刷新管理状态”读取本机 Agent；此操作可能同步配置。',
    magpieDiscoveryPending: '部分 CLI 版本仍在查询中，可稍后刷新。',
    magpieNoAgents: '尚未发现本机 Agent。这里不会自动安装 CLI。',
    magpieCliMissing: '未发现 CLI',
    magpieAgentDetected: '已发现',
    magpieVersionUnknown: '版本未知',
    magpieConfigured: '已配置网关',
    magpieModelUnset: '未设置',
    magpieNoModelField: '上游未提供可编辑的模型字段，请查看官方管理界面。',
    magpieUnavailable: '当前应用未提供模型管理接口。',
    magpieActionFailed: '模型管理操作未完成。请检查运行时是否可用，或稍后重试。',
    magpieState_stopped: '未启动',
    magpieState_starting: '启动中',
    magpieState_running: '运行中',
    magpieState_stopping: '停止中',
    magpieState_failed: '启动失败',
  },
  en: {
    magpieTitle: 'Local CLI model management',
    magpieManagerDescription:
      'Manage local Agent model configuration through the standalone Magpie runtime.',
    magpieActivationNotice:
      'Enabling Magpie reads and automatically synchronizes local Agent configuration. Refreshing management state may also synchronize configuration. A model selection made here is submitted when you click Apply to CLI.',
    magpiePrivacyNotice:
      'Off by default. Automatic subscription discovery, telemetry, and LAN access are disabled. Stopping does not undo Agent configuration already written.',
    magpieEnable: 'Enable local CLI management',
    magpieCheckStatus: 'Check service status',
    magpieRefreshManagement: 'Refresh management state',
    magpieOpenManagement: 'Open official management UI',
    magpieStop: 'Stop service',
    magpieApplyModel: 'Apply to CLI',
    magpieSelectModel: 'Choose a model',
    magpieApplyNotice:
      'Applying uses the official Magpie API to change this Agent’s model configuration. Start a new session in that Agent to use it.',
    magpieNotLoaded:
      'Refresh management state to read local Agents. This may synchronize configuration.',
    magpieDiscoveryPending: 'Some CLI versions are still being checked. Refresh again later.',
    magpieNoAgents: 'No local Agents detected. CLIs are not installed automatically.',
    magpieCliMissing: 'CLI not found',
    magpieAgentDetected: 'Detected',
    magpieVersionUnknown: 'Version unknown',
    magpieConfigured: 'Gateway configured',
    magpieModelUnset: 'Not set',
    magpieNoModelField:
      'Upstream provides no editable model field. Use its official management UI.',
    magpieUnavailable: 'Model management is unavailable in this application build.',
    magpieActionFailed:
      'Model management did not complete. Check runtime availability or try again later.',
    magpieState_stopped: 'Stopped',
    magpieState_starting: 'Starting',
    magpieState_running: 'Running',
    magpieState_stopping: 'Stopping',
    magpieState_failed: 'Failed',
  },
};

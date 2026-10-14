export const ToolApprovalMode = { Ask: 'ask', Auto: 'auto', AllowAll: 'allowAll' } as const;
export type ToolApprovalMode = (typeof ToolApprovalMode)[keyof typeof ToolApprovalMode];
export const ToolRiskLevel = {
  ReadOnly: 'read_only',
  Reversible: 'reversible',
  Irreversible: 'irreversible',
  Unknown: 'unknown',
} as const;
export type ToolRiskLevel = (typeof ToolRiskLevel)[keyof typeof ToolRiskLevel];

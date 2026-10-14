export const ContentWorkerLimit = {
  Workers: 2,
  Queue: 16,
  TimeoutMs: 30_000,
  WorkspaceContentBytes: 512 * 1024,
} as const;

export const ContentWorkerTask = {
  TransformText: 'transform-text',
  InspectWorkspaceContent: 'inspect-workspace-content',
} as const;
export type ContentWorkerTask = (typeof ContentWorkerTask)[keyof typeof ContentWorkerTask];

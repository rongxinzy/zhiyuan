import type { TextWorkerInput } from './textWorkerOperations';
import { ContentWorkerTask } from './contentWorkerConstants';

export interface WorkspaceContentInspection {
  sha256: string;
  text: string;
  binary: boolean;
}

export type ContentWorkerInput =
  | { kind: typeof ContentWorkerTask.TransformText; input: TextWorkerInput }
  | { kind: typeof ContentWorkerTask.InspectWorkspaceContent; input: { bytes: ArrayBuffer } };

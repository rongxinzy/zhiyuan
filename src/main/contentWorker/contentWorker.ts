import { runTextWorkerOperation } from './textWorkerOperations';
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { ContentWorkerLimit, ContentWorkerTask } from './contentWorkerConstants';
import type { ContentWorkerInput } from './contentWorkerTypes';

parentPort?.on('message', (job: ContentWorkerInput) => {
  const startedAt = performance.now();
  try {
    if (job.kind === ContentWorkerTask.TransformText) {
      parentPort?.postMessage({
        text: runTextWorkerOperation(job.input),
        runMs: performance.now() - startedAt,
      });
    } else if (job.kind === ContentWorkerTask.InspectWorkspaceContent) {
      if (
        !(job.input.bytes instanceof ArrayBuffer) ||
        job.input.bytes.byteLength > ContentWorkerLimit.WorkspaceContentBytes
      ) {
        throw new Error('Workspace content input limit exceeded.');
      }
      const bytes = Buffer.from(job.input.bytes);
      parentPort?.postMessage({
        content: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          text: bytes.toString('utf8'),
          binary: bytes.includes(0),
        },
        runMs: performance.now() - startedAt,
      });
    }
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    });
  }
});

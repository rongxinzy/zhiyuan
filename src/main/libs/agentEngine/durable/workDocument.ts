import {
  defineDoc,
  defineTool,
  section,
  type Extension,
  type Tx,
  type ConversationId,
} from '@earendil-works/pi-durable';
import { Type } from 'typebox';
import type { WorkDocument, WorkDocumentPatch } from '../../../../shared/durable/workDocument';

export const WorkDocumentDoc = defineDoc<WorkDocument>({
  kind: 'zhiyuan.work-document',
  version: 1,
  scope: 'conversation',
  history: 'rewindable',
  fork: 'asOf',
  initial: () => ({
    goal: '',
    agreements: [],
    decisions: [],
    progress: [],
    revision: 0,
    updatedAt: 0,
  }),
});
const lines = Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 100 });
export const WorkDocumentPatchSchema = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 0 }),
    goal: Type.Optional(Type.String({ maxLength: 8000 })),
    agreements: Type.Optional(lines),
    decisions: Type.Optional(lines),
    progress: Type.Optional(lines),
  },
  { additionalProperties: false },
);

export function validateWorkDocumentPatch(value: unknown): WorkDocumentPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid work document update.');
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0)
    throw new Error('A document revision is required.');
  for (const key of Object.keys(v)) {
    if (!['expectedRevision', 'goal', 'agreements', 'decisions', 'progress'].includes(key))
      throw new Error('Unknown work document field.');
    if (key === 'goal' && (typeof v[key] !== 'string' || v[key].length > 8000))
      throw new Error('Invalid work goal.');
    if (
      ['agreements', 'decisions', 'progress'].includes(key) &&
      (!Array.isArray(v[key]) ||
        v[key].length > 100 ||
        v[key].some(item => typeof item !== 'string' || item.length > 4000))
    )
      throw new Error('Invalid work document items.');
  }
  return v as WorkDocumentPatch;
}

export async function commitWorkDocument(
  tx: Tx,
  id: ConversationId,
  patch: WorkDocumentPatch,
): Promise<WorkDocument> {
  const valid = validateWorkDocumentPatch(patch);
  const doc = await tx.doc(WorkDocumentDoc, id);
  if (doc.revision !== valid.expectedRevision)
    throw new Error('The work document changed. Refresh it before saving.');
  if (valid.goal !== undefined) doc.goal = valid.goal;
  for (const key of ['agreements', 'decisions', 'progress'] as const)
    if (valid[key] !== undefined) doc[key] = [...valid[key]];
  doc.revision += 1;
  doc.updatedAt = Date.now();
  return {
    goal: doc.goal,
    agreements: [...doc.agreements],
    decisions: [...doc.decisions],
    progress: [...doc.progress],
    revision: doc.revision,
    updatedAt: doc.updatedAt,
  };
}

export const WorkDocumentExtension: Extension = {
  name: 'zhiyuan-work-document',
  tools: [
    defineTool({
      name: 'update_work_document',
      description:
        'Update this work’s visible goal, agreements, decisions, or progress. Read the current document revision in the work_document section. Preserve unchanged items. Record only supported facts and explicit agreements; this is not cross-work memory.',
      parameters: WorkDocumentPatchSchema,
      // A revision-checked replacement is safe to retry: a committed mutation cannot be applied twice.
      replay: 'safe',
      async execute(args, api, context) {
        try {
          const document = await api.commit(
            tx => commitWorkDocument(tx, api.conversationId, args),
            context,
          );
          return { output: [{ type: 'text', text: JSON.stringify(document) }] };
        } catch (error) {
          return {
            isError: true,
            output: [
              { type: 'text', text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      },
    }),
  ],
  sections: [
    section('work_document', async (input, context) => {
      const doc = await input.read.snapshot(WorkDocumentDoc, input.conversationId, context);
      return `Current work archive (user-visible; update with update_work_document):\n${JSON.stringify(doc ?? WorkDocumentDoc.definition.initial())}`;
    }),
  ],
};

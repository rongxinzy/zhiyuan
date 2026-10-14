import type { CodingConversationTurn } from './codingEventProjection';
import { CodingConversationTurnStatus } from './constants';

/** Read the existing ACP/native projection, without inferring test or task success. */
export function selectCodingTaskOverview(turns: readonly CodingConversationTurn[]) {
  const current = turns.at(-1);
  const settled = [...turns].reverse().find(turn => turn.status !== null);
  const answer =
    settled?.status === CodingConversationTurnStatus.Complete
      ? [...settled.assistantMessages]
          .reverse()
          .find(message => message.isFinalAnswer && message.content.trim())
      : undefined;
  return {
    request: current?.userMessage?.content.trim() ?? '',
    settledStatus: settled?.status ?? null,
    result: answer?.content.trim() ?? '',
    detail: settled?.statusDetail ?? '',
    previousTurn: Boolean(settled && current && settled.id !== current.id),
  };
}

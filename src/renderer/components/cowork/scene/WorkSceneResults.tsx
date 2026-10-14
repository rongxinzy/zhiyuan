import { Button } from '@shared/components/ui/button';
import { useState } from 'react';
import type { WorkDocument } from '../../../../shared/durable/workDocument';
import type { CoworkMessage } from '../../../types/cowork';
import type { Artifact } from '../../../types/artifact';
import { i18nService } from '../../../services/i18n';
import MarkdownContent from '../../MarkdownContent';

export type WorkSceneSection = 'results' | 'conversation' | 'document';
export function latestSavedReply(messages: readonly CoworkMessage[]): CoworkMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (
      message.type === 'assistant' &&
      message.content.trim() &&
      !message.metadata?.isThinking &&
      !message.metadata?.isStreaming &&
      !message.metadata?.isError &&
      !message.metadata?.error
    )
      return message;
  }
}
export function WorkSceneResults({
  messages,
  artifacts,
  document,
  running,
  failed = false,
  onConversation,
  onDocument,
  onArtifact,
  onStop,
}: {
  messages: readonly CoworkMessage[];
  artifacts: readonly Artifact[];
  document: WorkDocument | null;
  running: boolean;
  failed?: boolean;
  onConversation(): void;
  onDocument(): void;
  onArtifact(artifact: Artifact): void;
  onStop(): void;
}) {
  const [limit, setLimit] = useState(6);
  const reply = latestSavedReply(messages);
  const t = (key: string) => i18nService.t(key);
  return (
    <div className="space-y-6">
      {failed && !running && (
        <p role="alert" className="text-sm text-destructive">
          {t('workSceneFailed')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onConversation}>
          {t(running ? 'workSceneCorrect' : 'workSceneOpenConversation')}
        </Button>
        {running && (
          <Button variant="outline" onClick={onStop}>
            {t('workSceneStop')}
          </Button>
        )}
        {running && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('workSceneRunning')}
          </p>
        )}
      </div>
      <section
        className="space-y-2 border-t border-border-subtle pt-4"
        aria-label={t('workSceneGoal')}
      >
        <h2 className="text-sm font-medium">{t('workSceneGoal')}</h2>
        <p className="whitespace-pre-wrap break-words text-sm">
          {document
            ? document.goal.slice(0, 1000) || t('workSceneNoGoal')
            : t('workSceneDocumentUnavailable')}
        </p>
        <h3 className="text-sm font-medium">{t('workSceneProgress')}</h3>
        {document?.progress.length ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {document.progress.slice(-3).map((text, index) => (
              <li key={index} className="break-words">
                {text.slice(0, 500)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(document ? 'workSceneNoProgress' : 'workSceneDocumentUnavailable')}
          </p>
        )}
        <Button variant="link" onClick={onDocument}>
          {t('workSceneDocument')}
        </Button>
      </section>
      <section className="min-w-0 space-y-2" aria-label={t('workSceneLatest')}>
        <h2 className="text-sm font-medium">{t('workSceneLatest')}</h2>
        <p className="text-xs text-muted-foreground">{t('workSceneLatestHint')}</p>
        {reply ? (
          <div
            className="max-h-80 min-w-0 overflow-auto break-words"
            tabIndex={0}
            aria-label={t('workSceneLatest')}
          >
            <MarkdownContent content={reply.content.slice(0, 8000)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('workSceneNoOutput')}</p>
        )}
        {reply && reply.content.length > 8000 && (
          <Button variant="link" onClick={onConversation}>
            {t('workSceneFullReply')}
          </Button>
        )}
      </section>
      <section
        className="space-y-2 border-t border-border-subtle pt-4"
        aria-label={t('workSceneArtifacts')}
      >
        <h2 className="text-sm font-medium">
          {t('workSceneArtifacts')} ({artifacts.length})
        </h2>
        {artifacts.length ? (
          <ul className="space-y-1">
            {artifacts.slice(0, limit).map(artifact => (
              <li key={artifact.id}>
                <Button
                  variant="ghost"
                  className="h-auto max-w-full justify-start whitespace-normal break-all text-left"
                  onClick={() => onArtifact(artifact)}
                >
                  {artifact.title || artifact.fileName || artifact.id}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('workSceneNoArtifacts')}</p>
        )}
        {artifacts.length > limit && (
          <Button variant="outline" onClick={() => setLimit(value => value + 6)}>
            {t('workSceneMore')}
          </Button>
        )}
      </section>
    </div>
  );
}

import { useState } from 'react';
import type { HistoryMessage } from '@shared/history';
import { Message, MessageContent, MessageResponse } from '@shared/components/ai-elements/message';
import {
  Attachment,
  AttachmentInfo,
  Attachments,
} from '@shared/components/ai-elements/attachments';
import { Button } from '@shared/components/ui/button';
import { i18nService } from '../../services/i18n';
import { historyAttachments } from './historyBrowserModel';
import { CONTENT_PREVIEW_LENGTH, HistoryRole } from './constants';

export function HistoryMessageView({
  message,
  highlighted,
}: {
  message: HistoryMessage;
  highlighted: boolean;
}) {
  const t = i18nService.t.bind(i18nService);
  const [expanded, setExpanded] = useState(false);
  const attachments = historyAttachments(message);
  const isUser = message.type === HistoryRole.User;
  const isConversation = isUser || message.type === HistoryRole.Assistant;
  const role = isUser
    ? t('user')
    : message.type === HistoryRole.Assistant
      ? t('historyAssistant')
      : message.type === HistoryRole.System
        ? t('historySystem')
        : t('historyTool');
  const timestamp = new Date(message.timestamp);
  const hasTimestamp = Number.isFinite(timestamp.getTime());
  const content = expanded ? message.content : message.content.slice(0, CONTENT_PREVIEW_LENGTH);
  return (
    <article
      aria-label={role}
      aria-current={highlighted ? 'true' : undefined}
      tabIndex={highlighted ? -1 : undefined}
    >
      <Message from={isUser ? 'user' : 'assistant'}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{role}</span>
          {hasTimestamp && (
            <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString()}</time>
          )}
          {highlighted && <span>{t('historyResults')}</span>}
        </div>
        <MessageContent>
          {isConversation ? (
            <MessageResponse>{content}</MessageResponse>
          ) : (
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-sm">
              {content}
            </pre>
          )}
          {!expanded && message.content.length > CONTENT_PREVIEW_LENGTH && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
              {t('historyShowMore')}
            </Button>
          )}
          {attachments.length > 0 && (
            <section className="flex min-w-0 flex-col gap-2" aria-label={t('historyAttachments')}>
              <Attachments variant="list">
                {attachments.map((attachment, index) => (
                  <Attachment
                    key={`${attachment.name}-${index}`}
                    data={{
                      type: 'source-document',
                      id: `${message.id}-${index}`,
                      sourceId: `${message.id}-${index}`,
                      mediaType: attachment.mimeType,
                      title: attachment.name,
                    }}
                  >
                    <AttachmentInfo showMediaType />
                  </Attachment>
                ))}
              </Attachments>
              <p className="text-xs text-muted-foreground">{t('historyAttachmentHint')}</p>
            </section>
          )}
        </MessageContent>
      </Message>
    </article>
  );
}

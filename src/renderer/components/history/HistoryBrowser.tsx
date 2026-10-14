import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import type {
  HistoryApi,
  HistoryConversation,
  HistoryLocator,
  HistorySearchHit,
} from '@shared/history';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Empty, EmptyDescription } from '@shared/components/ui/empty';
import PageHeader from '../PageHeader';
import { i18nService } from '../../services/i18n';
import { historyLocatorKey } from './historyBrowserModel';
import { HISTORY_PAGE_SIZE, HistorySource } from './constants';
import { useHistoryPage } from './useHistoryPage';
import { HistoryMessageView } from './HistoryMessages';

type HistoryRow = HistoryConversation | HistorySearchHit;
interface Selection {
  row: HistoryRow;
  anchor?: string;
}

export interface HistoryBrowserProps {
  api: HistoryApi;
  onClose: () => void;
  /** Navigation only. The caller must not start or resume a run. */
  onOpenConversation?: (
    locator: HistoryLocator,
    openTarget?: HistoryConversation['openTarget'],
  ) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function PageState({
  loading,
  failed,
  empty,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  empty?: string;
  onRetry: () => void;
}) {
  const t = i18nService.t.bind(i18nService);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    setShowLoading(false);
    if (!loading) return;
    const timer = setTimeout(() => setShowLoading(true), 200);
    return () => clearTimeout(timer);
  }, [loading]);
  if (loading)
    return showLoading ? (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    ) : null;
  if (failed)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t('historyLoadFailed')}</span>
        <Button variant="outline" onClick={onRetry}>
          {t('historyRetry')}
        </Button>
      </div>
    );
  return empty ? (
    <Empty>
      <EmptyDescription>{empty}</EmptyDescription>
    </Empty>
  ) : null;
}

export function HistoryBrowser({
  api,
  onClose,
  onOpenConversation,
  isSidebarCollapsed,
  onToggleSidebar,
}: HistoryBrowserProps) {
  useSyncExternalStore(
    listener => i18nService.subscribe(listener),
    () => i18nService.getLanguage(),
  );
  const t = i18nService.t.bind(i18nService);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const directory = useHistoryPage<HistoryRow>(query, cursor =>
    query
      ? api.search({ query, cursor, limit: HISTORY_PAGE_SIZE })
      : api.list({ cursor, limit: HISTORY_PAGE_SIZE }),
  );
  const sourceLabel = (locator: HistoryLocator) =>
    t(locator.source === HistorySource.Coding ? 'historySourceCoding' : 'historySourceCowork');

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label={t('historyTitle')}>
      <PageHeader
        title={t('historyTitle')}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        actions={
          <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
            <X className="size-4" />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="text-sm text-muted-foreground">{t('historyReadOnly')}</p>
        <form
          className="flex flex-wrap items-center gap-2"
          role="search"
          onSubmit={event => {
            event.preventDefault();
            setSelection(null);
            setQuery(draft.trim());
          }}
        >
          <Input
            className="min-w-0 flex-1"
            aria-label={t('historySearch')}
            placeholder={t('historySearch')}
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline">
            <Search className="size-4" />
            {t('historySearchAction')}
          </Button>
          {query && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft('');
                setQuery('');
                setSelection(null);
              }}
            >
              {t('historyBrowse')}
            </Button>
          )}
        </form>
        {selection ? (
          <HistoryReader
            api={api}
            selection={selection}
            onBack={() => setSelection(null)}
            onOpenConversation={onOpenConversation}
          />
        ) : (
          <div className="flex min-h-0 flex-col gap-4" aria-busy={directory.loading}>
            <PageState
              loading={directory.loading}
              failed={directory.failed}
              empty={
                directory.items.length ? undefined : t(query ? 'historyNoMatches' : 'historyEmpty')
              }
              onRetry={directory.retry}
            />
            <ul className="flex min-w-0 flex-col gap-4">
              {directory.items.map(row => {
                const hit = 'entryId' in row ? row : undefined;
                return (
                  <li
                    className="min-w-0"
                    key={`${historyLocatorKey(row.locator)}:${hit?.entryId ?? ''}`}
                  >
                    <Button
                      variant="navigation"
                      size="navigation"
                      className="gap-2"
                      onClick={() => setSelection({ row, anchor: hit?.entryId })}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {row.title || t('historyUntitled')}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {sourceLabel(row.locator)}
                      </span>
                    </Button>
                    <div className="flex min-w-0 flex-wrap gap-2 px-2 text-xs text-muted-foreground">
                      <time>
                        {new Date(
                          'updatedAt' in row ? row.updatedAt : row.timestamp,
                        ).toLocaleString()}
                      </time>
                      {'workspace' in row && row.workspace && (
                        <span className="min-w-0 truncate" title={row.workspace}>
                          {row.workspace}
                        </span>
                      )}
                    </div>
                    {hit && (
                      <p className="line-clamp-2 break-words px-2 text-sm text-muted-foreground">
                        {hit.content}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <nav className="flex flex-wrap gap-2" aria-label={t('pagination')}>
              <Button
                variant="outline"
                disabled={directory.loading || directory.cursors.length <= 1}
                onClick={directory.previous}
              >
                {t('paginationPrevious')}
              </Button>
              <Button
                variant="outline"
                disabled={directory.loading || !directory.nextCursor}
                onClick={directory.next}
              >
                {t('paginationNext')}
              </Button>
            </nav>
          </div>
        )}
      </div>
    </section>
  );
}

function HistoryReader({
  api,
  selection,
  onBack,
  onOpenConversation,
}: {
  api: HistoryApi;
  selection: Selection;
  onBack: () => void;
  onOpenConversation?: (
    locator: HistoryLocator,
    openTarget?: HistoryConversation['openTarget'],
  ) => void;
}) {
  const t = i18nService.t.bind(i18nService);
  const { row, anchor } = selection;
  const scope = JSON.stringify([row.locator, anchor]);
  const page = useHistoryPage(scope, cursor =>
    api.readPage({
      locator: row.locator,
      cursor,
      anchor: cursor ? undefined : anchor,
      limit: HISTORY_PAGE_SIZE,
    }),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (page.loading || page.failed) return;
    const match = contentRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    match?.focus({ preventScroll: true });
    match?.scrollIntoView?.({ block: 'center' });
  }, [page.items, page.loading, page.failed]);
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={page.loading}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t('historyBack')}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={row.title}>
          {row.title || t('historyUntitled')}
        </span>
        {onOpenConversation && (
          <Button variant="outline" onClick={() => onOpenConversation(row.locator, row.openTarget)}>
            {t('historyOpenConversation')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          row.locator.source === HistorySource.Coding
            ? 'historySourceCoding'
            : 'historySourceCowork',
        )}{' '}
        · {t('historyPageHint')}
      </p>
      <nav className="flex flex-wrap gap-2" aria-label={t('pagination')}>
        <Button variant="outline" disabled={page.loading || !page.nextCursor} onClick={page.next}>
          {t('historyOlder')}
        </Button>
        <Button
          variant="outline"
          disabled={page.loading || page.cursors.length <= 1}
          onClick={page.previous}
        >
          {t('historyNewer')}
        </Button>
      </nav>
      <PageState
        loading={page.loading}
        failed={page.failed}
        empty={page.items.length ? undefined : t('historyNoMessages')}
        onRetry={page.retry}
      />
      <div className="flex min-w-0 flex-col gap-6" ref={contentRef}>
        {page.items.map(message => (
          <HistoryMessageView
            key={`${scope}:${message.id}`}
            message={message}
            highlighted={message.entryId === anchor}
          />
        ))}
      </div>
    </div>
  );
}

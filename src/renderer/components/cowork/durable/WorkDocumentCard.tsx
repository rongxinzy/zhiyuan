import { Button } from '@shared/components/ui/button';
import { Textarea } from '@shared/components/ui/textarea';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkDocument } from '../../../../shared/durable/workDocument';
import { i18nService } from '../../../services/i18n';

const fields = ['goal', 'agreements', 'decisions', 'progress'] as const;
type Draft = Record<(typeof fields)[number], string>;
const toDraft = (document: WorkDocument): Draft => ({
  goal: document.goal,
  agreements: document.agreements.join('\n'),
  decisions: document.decisions.join('\n'),
  progress: document.progress.join('\n'),
});
const lines = (value: string) =>
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

export function WorkDocumentCard({
  sessionId,
  expanded = false,
  onSnapshot,
}: {
  sessionId: string;
  expanded?: boolean;
  onSnapshot?: (document: WorkDocument | null) => void;
}) {
  const [document, setDocument] = useState<WorkDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const epoch = useRef(0);
  const locked = useRef(false);
  const editingRef = useRef(false);
  const documentRef = useRef<WorkDocument | null>(null);

  const accept = useCallback((next: WorkDocument) => {
    if (documentRef.current && next.revision < documentRef.current.revision) return;
    if (editingRef.current) {
      if (next.revision > (documentRef.current?.revision ?? -1)) setChanged(true);
      return;
    }
    documentRef.current = next;
    setDocument(next);
    setDraft(toDraft(next));
  }, []);

  const refresh = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    const request = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.cowork.getWorkDocument(sessionId);
      if (request !== epoch.current) return;
      if (!result.success) throw new Error(result.error);
      accept(result.data);
    } catch {
      if (request === epoch.current) setError(i18nService.t('workDocumentLoadFailed'));
    } finally {
      if (request === epoch.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }, [sessionId, accept]);

  useEffect(() => {
    epoch.current += 1;
    locked.current = false;
    editingRef.current = false;
    documentRef.current = null;
    setDocument(null);
    setDraft(null);
    setEditing(false);
    setChanged(false);
    void refresh();
    const unsubscribe = window.electron.cowork.onWorkDocumentChanged(event => {
      if (event.sessionId === sessionId) accept(event.document);
    });
    return () => {
      epoch.current += 1;
      unsubscribe();
    };
  }, [sessionId, refresh, accept]);

  useEffect(() => {
    onSnapshot?.(document);
  }, [document, onSnapshot]);

  const save = async () => {
    if (locked.current || !document || !draft || changed) return;
    locked.current = true;
    const request = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron.cowork.updateWorkDocument(sessionId, {
        expectedRevision: document.revision,
        goal: draft.goal.trim(),
        agreements: lines(draft.agreements),
        decisions: lines(draft.decisions),
        progress: lines(draft.progress),
      });
      if (request !== epoch.current) return;
      if (!result.success) throw new Error(result.error);
      editingRef.current = false;
      setEditing(false);
      setChanged(false);
      accept(result.data);
    } catch {
      if (request === epoch.current) {
        setChanged(true);
        setError(i18nService.t('workDocumentSaveFailed'));
      }
    } finally {
      if (request === epoch.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <details
      open={expanded || undefined}
      className="mt-3 border-t border-border-subtle py-3"
      key={sessionId}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {i18nService.t('workDocumentTitle')}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{i18nService.t('workDocumentScope')}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {changed && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {i18nService.t('workDocumentChanged')}
        </p>
      )}
      <div className="mt-3 space-y-3">
        {fields.map(field => (
          <div key={field}>
            <label className="text-xs font-medium" htmlFor={`work-document-${sessionId}-${field}`}>
              {i18nService.t(`workDocumentField_${field}`)}
            </label>
            {editing && draft ? (
              <Textarea
                id={`work-document-${sessionId}-${field}`}
                rows={3}
                value={draft[field]}
                disabled={busy}
                onChange={event => setDraft({ ...draft, [field]: event.target.value })}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {document ? toDraft(document)[field] || i18nService.t('workDocumentEmpty') : '—'}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="sm" disabled={busy || changed} onClick={() => void save()}>
              {i18nService.t('save')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                editingRef.current = false;
                setEditing(false);
                setChanged(false);
                void refresh();
              }}
            >
              {i18nService.t('cancel')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !document}
            onClick={() => {
              editingRef.current = true;
              setEditing(true);
            }}
          >
            {i18nService.t('edit')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy || editing} onClick={() => void refresh()}>
          {i18nService.t('refresh')}
        </Button>
      </div>
    </details>
  );
}

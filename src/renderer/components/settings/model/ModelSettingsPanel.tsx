import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useEffect, useRef, useState } from 'react';
import type { MagpieModelCatalog } from '../../../../shared/magpie/types';
import {
  applyMagpieCatalog,
  refreshMagpieModels,
  selectMagpieDefaultModel,
} from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import { MagpieSubscriptionControl } from './MagpieSubscriptionControl';

export default function ModelSettingsPanel() {
  const [catalog, setCatalog] = useState<MagpieModelCatalog | null>(null);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(false);
  const locked = useRef(false);
  const actionVersion = useRef(0);
  const apply = (next: MagpieModelCatalog) => {
    if (!mounted.current) return;
    setCatalog(next);
    setSelection(next.defaultModelId ?? '');
  };
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    actionVersion.current += 1;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      if (mounted.current) setError(true);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void run(async () => apply(await refreshMagpieModels()));
    const timer = window.setInterval(() => {
      if (locked.current) return;
      const version = actionVersion.current;
      void window.electron.magpie
        .status()
        .then(status => {
          if (
            !mounted.current ||
            locked.current ||
            version !== actionVersion.current ||
            status.state === 'running'
          )
            return;
          const next = { status, models: [], defaultModelId: null };
          applyMagpieCatalog(next);
          apply(next);
        })
        .catch(() => {
          if (mounted.current) setError(true);
        });
    }, 3000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);
  const running = catalog?.status.state === 'running';
  const models = running ? catalog.models : [];
  const selected = models.find(model => model.id === selection);
  return (
    <section className="max-w-2xl space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{i18nService.t('magpieCatalogTitle')}</h2>
        {(catalog || starting) && (
          <Badge variant="outline">
            {i18nService.t(`magpieState_${starting ? 'starting' : catalog?.status.state}`)}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogHint')}</p>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogConsent')}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {i18nService.t('magpieActionFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!running && (
          <Button
            type="button"
            disabled={
              busy || catalog?.status.state === 'starting' || catalog?.status.state === 'stopping'
            }
            onClick={() =>
              void run(async () => {
                setStarting(true);
                try {
                  const status = await window.electron.magpie.start();
                  const next = { status, models: [], defaultModelId: null };
                  applyMagpieCatalog(next);
                  apply(next);
                  if (status.state !== 'running') throw new Error('Not running');
                  apply(await refreshMagpieModels());
                } finally {
                  if (mounted.current) setStarting(false);
                }
              })
            }
          >
            {i18nService.t('magpieCatalogEnable')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void run(async () => apply(await refreshMagpieModels()))}
        >
          {i18nService.t('magpieCatalogRefresh')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !running}
          onClick={() => void run(() => window.electron.magpie.openManagement())}
        >
          {i18nService.t('magpieOpenManagement')}
        </Button>
      </div>
      {running && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">{i18nService.t('magpieDefaultModel')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selected?.id ?? null}
                onValueChange={value => setSelection(value ?? '')}
                disabled={busy || !models.length}
              >
                <SelectTrigger
                  className="min-w-0 flex-1"
                  aria-label={i18nService.t('magpieDefaultModel')}
                >
                  <SelectValue placeholder={i18nService.t('magpieModelUnset')} />
                </SelectTrigger>
                <SelectContent>
                  {models.map(model => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.display_name || model.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                disabled={busy || !selected || selection === catalog.defaultModelId}
                onClick={() =>
                  void run(async () => apply(await selectMagpieDefaultModel(selection)))
                }
              >
                {i18nService.t('magpieSetDefault')}
              </Button>
            </div>
          </div>
          {!models.length && (
            <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogEmpty')}</p>
          )}
          <ul className="divide-y divide-border">
            {models.map(model => (
              <li key={model.id} className="space-y-1 py-3">
                <p className="break-words text-sm font-medium">{model.display_name || model.id}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {model.id}
                  {model.owned_by ? ` · ${model.owned_by}` : ''}
                </p>
                {!!model.native_endpoints?.length && (
                  <p className="text-xs text-muted-foreground">
                    {model.native_endpoints.join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {catalog && (
        <MagpieSubscriptionControl
          status={catalog.status}
          disabled={busy || !running}
          onBusyChange={value => {
            locked.current = value;
            actionVersion.current += 1;
            setBusy(value);
          }}
          onStatusChange={async status => {
            const next = { status, models: [], defaultModelId: null };
            applyMagpieCatalog(next);
            apply(next);
            if (status.state === 'running') apply(await refreshMagpieModels());
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">Magpie · MIT · © 2026 yetone</p>
    </section>
  );
}

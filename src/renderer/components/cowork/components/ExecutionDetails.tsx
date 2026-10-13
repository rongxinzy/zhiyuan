import { Reasoning, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import { CollapsibleContent } from '@shared/components/ui/collapsible';
import type { ReactNode } from 'react';

import { i18nService } from '../../../services/i18n';
import { usePersistentToggle } from '../hooks/usePersistentToggle';

/** Keep the user's expansion choice through virtualization and image export. */
export const ExecutionDetails = ({
  turnId,
  forceExpand,
  children,
}: {
  turnId: string;
  forceExpand: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = usePersistentToggle(`execution-${turnId}`, false);
  return (
    <Reasoning open={forceExpand || open} onOpenChange={setOpen} autoClose={false}>
      <ReasoningTrigger getThinkingMessage={() => i18nService.t('coworkExecutionDetails')} />
      <CollapsibleContent>
        <div className="flex min-w-0 flex-col gap-3 pt-3">{children}</div>
      </CollapsibleContent>
    </Reasoning>
  );
};

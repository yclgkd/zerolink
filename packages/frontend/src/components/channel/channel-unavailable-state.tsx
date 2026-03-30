import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface ChannelUnavailableStateProps {
  body: string;
  testId: string;
}

export function ChannelUnavailableState({
  body,
  testId,
}: ChannelUnavailableStateProps): ReactElement {
  const { t } = useTranslation();

  return (
    <section className="max-w-[46rem] space-y-2" data-testid={testId}>
      <h3 className="text-base font-semibold text-foreground">{t('channel.unavailableTitle')}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </section>
  );
}

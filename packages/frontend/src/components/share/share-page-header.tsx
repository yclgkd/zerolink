import { CHANNEL_STATE, type ChannelState } from '@zerolink/shared';
import { useTranslation } from 'react-i18next';

import { PageCardDescription, PageCardHeader, PageCardTitle, RoleBadge } from '../layout';

interface SharePageHeaderProps {
  channelState: ChannelState;
  isPublicStatusLoading: boolean;
  isUnavailable: boolean;
}

export function SharePageHeader({
  channelState,
  isPublicStatusLoading,
  isUnavailable,
}: SharePageHeaderProps) {
  const { t } = useTranslation();

  let title: string;
  let description: string;

  if (isUnavailable) {
    title = t('share.headerUnavailableTitle');
    description = t('share.headerUnavailableDescription');
  } else if (isPublicStatusLoading) {
    title = t('share.headerDefaultTitle');
    description = t('share.headerDefaultDescription');
  } else if (channelState === CHANNEL_STATE.LOCKED) {
    title = t('share.headerLockedTitle');
    description = t('share.headerLockedDescription');
  } else if (channelState === CHANNEL_STATE.DELIVERED) {
    title = t('share.headerDeliveredTitle');
    description = t('share.headerDeliveredDescription');
  } else {
    title = t('share.headerWaitingTitle');
    description = t('share.headerWaitingDescription');
  }

  return (
    <PageCardHeader>
      <div className="flex items-center justify-between gap-3">
        <PageCardTitle asChild className="text-primary">
          <h2>{title}</h2>
        </PageCardTitle>
        <RoleBadge party="receiver" />
      </div>
      <PageCardDescription>{description}</PageCardDescription>
    </PageCardHeader>
  );
}

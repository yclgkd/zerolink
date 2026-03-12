import { CHANNEL_STATE, type ChannelState } from '@zerolink/shared';

import { PageCardDescription, PageCardHeader, PageCardTitle, RoleBadge } from '../layout';

interface SharePageHeaderCopy {
  title: string;
  description: string;
}

interface SharePageHeaderProps {
  channelState: ChannelState;
  isPublicStatusLoading: boolean;
  isUnavailable: boolean;
}

const DEFAULT_HEADER_COPY: SharePageHeaderCopy = {
  title: 'Receiver Channel',
  description:
    'Open this receiver link on the device that will lock the channel and later decrypt the delivered secret locally.',
};

const WAITING_HEADER_COPY: SharePageHeaderCopy = {
  title: 'Receiver Setup',
  description:
    'The sender already created this channel. Set your own passphrase here to generate your receiver key and lock the channel on this device.',
};

const LOCKED_HEADER_COPY: SharePageHeaderCopy = {
  title: 'Receiver Channel',
  description:
    'This receiver channel is locked. This page updates automatically, but only the device that created the lock can verify the Safety Code shown below.',
};

const DELIVERED_HEADER_COPY: SharePageHeaderCopy = {
  title: 'Decrypt Delivered Secret',
  description:
    'If this device created the receiver lock, enter that passphrase to decrypt the secret locally.',
};

const UNAVAILABLE_HEADER_COPY: SharePageHeaderCopy = {
  title: 'Receiver Channel',
  description: 'This receiver link is unavailable or no longer active.',
};

function getSharePageHeaderCopy({
  channelState,
  isPublicStatusLoading,
  isUnavailable,
}: SharePageHeaderProps): SharePageHeaderCopy {
  if (isUnavailable) return UNAVAILABLE_HEADER_COPY;
  if (isPublicStatusLoading) return DEFAULT_HEADER_COPY;
  if (channelState === CHANNEL_STATE.LOCKED) return LOCKED_HEADER_COPY;
  if (channelState === CHANNEL_STATE.DELIVERED) return DELIVERED_HEADER_COPY;
  return WAITING_HEADER_COPY;
}

export function SharePageHeader(props: SharePageHeaderProps) {
  const copy = getSharePageHeaderCopy(props);

  return (
    <PageCardHeader>
      <div className="flex items-center justify-between gap-3">
        <PageCardTitle asChild className="text-primary">
          <h2>{copy.title}</h2>
        </PageCardTitle>
        <RoleBadge party="receiver" />
      </div>
      <PageCardDescription>{copy.description}</PageCardDescription>
    </PageCardHeader>
  );
}

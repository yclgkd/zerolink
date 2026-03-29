import { CHANNEL_TTL_MS, type ChannelTtlMs } from '@zerolink/shared';

export interface CreatedLinks {
  shareUrlWithFragment: string;
  manageUrl: string;
  isPasswordMode: boolean;
  ttl: ChannelTtlMs;
}

export const CHANNEL_TTL_OPTIONS = [
  { value: CHANNEL_TTL_MS.ONE_HOUR, testId: 'create-ttl-one-hour' },
  { value: CHANNEL_TTL_MS.ONE_DAY, testId: 'create-ttl-one-day' },
  { value: CHANNEL_TTL_MS.SEVEN_DAYS, testId: 'create-ttl-seven-days' },
] as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled channel TTL: ${String(value)}`);
}

export function getChannelTtlLabel(t: (key: string) => string, ttl: ChannelTtlMs): string {
  switch (ttl) {
    case CHANNEL_TTL_MS.ONE_HOUR:
      return t('create.ttlOneHour');
    case CHANNEL_TTL_MS.ONE_DAY:
      return t('create.ttlOneDay');
    case CHANNEL_TTL_MS.SEVEN_DAYS:
      return t('create.ttlSevenDays');
  }

  return assertNever(ttl);
}

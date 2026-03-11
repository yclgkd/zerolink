import { useEffect, useRef, useState } from 'react';
import {
  type ChannelClosedReason,
  type ChannelStateUpdate,
  ChannelSync,
  type ConnectionMode,
} from './channel-sync.ts';

export interface UseChannelSyncOptions {
  readonly onStateChange: (update: ChannelStateUpdate) => void;
  readonly onChannelClosed: (reason: ChannelClosedReason) => void;
}

export interface UseChannelSyncResult {
  readonly connectionMode: ConnectionMode;
}

/**
 * React hook that manages real-time channel synchronization.
 * Automatically connects on mount, handles visibility changes,
 * and cleans up on unmount.
 */
export function useChannelSync(
  uuid: string | undefined,
  options: UseChannelSyncOptions
): UseChannelSyncResult {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('offline');
  const syncRef = useRef<ChannelSync | null>(null);

  // Stable refs for callbacks to avoid re-creating ChannelSync on every render
  const onStateChangeRef = useRef(options.onStateChange);
  onStateChangeRef.current = options.onStateChange;
  const onChannelClosedRef = useRef(options.onChannelClosed);
  onChannelClosedRef.current = options.onChannelClosed;

  useEffect(() => {
    if (!uuid) {
      setConnectionMode('offline');
      return;
    }

    const sync = new ChannelSync(uuid, {
      onStateChange: (update) => onStateChangeRef.current(update),
      onChannelClosed: (reason) => onChannelClosedRef.current(reason),
      onConnectionChange: setConnectionMode,
    });

    syncRef.current = sync;
    sync.connect();

    // Visibility change handler
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void sync.handleVisibilityVisible();
      } else {
        sync.handleVisibilityHidden();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      sync.disconnect();
      syncRef.current = null;
    };
  }, [uuid]);

  return { connectionMode };
}

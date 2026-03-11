import { z } from 'zod';

import {
  AdminModeSchema,
  ChannelStateSchema,
  HexStringSchema,
  SecurityProfileSchema,
  UUIDSchema,
} from './schemas.ts';

// ─── Server → Client Messages ────────────────────────────────────────────────

const WsStateChangedSchema = z.object({
  type: z.literal('state_changed'),
  state: ChannelStateSchema,
  version: z.number().int().nonnegative(),
  adminMode: AdminModeSchema,
  securityProfile: SecurityProfileSchema,
  receiverPubFpr: HexStringSchema.optional(),
});

const WsChannelClosedSchema = z.object({
  type: z.literal('channel_closed'),
  reason: z.enum(['deleted', 'expired']),
});

const WsPongSchema = z.object({
  type: z.literal('pong'),
});

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsStateChangedSchema,
  WsChannelClosedSchema,
  WsPongSchema,
]);

export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

// ─── Client → Server Messages ────────────────────────────────────────────────

const WsSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  uuid: UUIDSchema,
});

const WsPingSchema = z.object({
  type: z.literal('ping'),
});

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  WsSubscribeSchema,
  WsPingSchema,
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

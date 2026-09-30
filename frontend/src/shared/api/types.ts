/** Readable aliases for the generated contract types. Never edit schema.gen.ts by hand. */
import type { components } from '@/shared/api/schema.gen';

type Schemas = components['schemas'];

export type BackendErrorCode = Schemas['ErrorCode'];
export type ConfigOut = Schemas['ConfigOut'];
export type ReadyOut = Schemas['ReadyOut'];
export type DocumentOut = Schemas['DocumentOut'];
export type DocumentListOut = Schemas['DocumentListOut'];
export type DocumentEnvelopeOut = Schemas['DocumentEnvelopeOut'];
export type DocumentStatus = Schemas['DocumentStatus'];
export type DocumentKind = Schemas['DocumentKind'];
export type ChunkOut = Schemas['ChunkOut'];
export type NoticeOut = Schemas['NoticeOut'];
export type NoticeCode = Schemas['NoticeCode'];
export type Limits = Schemas['Limits'];

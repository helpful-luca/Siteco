/** Readable aliases for the generated contract types. Never edit schema.gen.ts by hand. */
import type { components } from '@/shared/api/schema.gen';

type Schemas = components['schemas'];

export type BackendErrorCode = Schemas['ErrorCode'];
export type ConfigOut = Schemas['ConfigOut'];
export type ReadyOut = Schemas['ReadyOut'];

import { describe, expect, it } from 'vitest';
import contract from '../../../../contracts/openapi.json';
import { ERROR_SURFACES } from './error-catalog';
import { CLIENT_ERROR_CODES } from './errors';

type Spec = { status: number; retryable: boolean };
type Contract = { components: { schemas: { ErrorCode: { enum: string[]; 'x-error-specs': Record<string, Spec> } } } };

const backend = (contract as unknown as Contract).components.schemas.ErrorCode;

describe('error catalog', () => {
  it('places every code of the contract and nothing else', () => {
    expect(Object.keys(ERROR_SURFACES).sort()).toEqual([...backend.enum, ...CLIENT_ERROR_CODES].sort());
    expect(Object.keys(backend['x-error-specs']).sort()).toEqual([...backend.enum].sort());
  });
});

import { describe, expect, it } from 'vitest';
import contract from '../../../../contracts/openapi.json';
import de from '../../../messages/de.json';
import en from '../../../messages/en.json';
import type { ClientErrorCode } from '@/shared/api/errors';

type Contract = { components: { schemas: { ErrorCode: { enum: string[] } } } };

const backendCodes = (contract as unknown as Contract).components.schemas.ErrorCode.enum;
const clientCodes: ClientErrorCode[] = [
  'BACKEND_UNAVAILABLE',
  'FORBIDDEN_ORIGIN',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
];
const germanErrors: Record<string, string> = de.errors;
const englishErrors: Record<string, string> = en.errors;

describe('error code texts', () => {
  it.each([...backendCodes, ...clientCodes])('%s has German and English text', (code) => {
    expect(germanErrors[code]).toBeTruthy();
    expect(englishErrors[code]).toBeTruthy();
  });
});

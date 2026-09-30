import { describe, expect, it } from 'vitest';
import contract from '../../../../contracts/openapi.json';
import de from '../../../messages/de.json';
import en from '../../../messages/en.json';
import type { ClientErrorCode } from '@/shared/api/errors';

type Contract = {
  components: { schemas: { ErrorCode: { enum: string[] }; NoticeCode: { enum: string[] } } };
};

const schemas = (contract as unknown as Contract).components.schemas;
const backendCodes = schemas.ErrorCode.enum;
const noticeCodes = schemas.NoticeCode.enum;
const clientCodes: ClientErrorCode[] = [
  'BACKEND_UNAVAILABLE',
  'FORBIDDEN_ORIGIN',
  'NETWORK_ERROR',
  'STREAM_INTERRUPTED',
  'UNKNOWN_ERROR',
];
const germanErrors: Record<string, string> = de.errors;
const englishErrors: Record<string, string> = en.errors;
const germanNotices: Record<string, string> = de.notices;
const englishNotices: Record<string, string> = en.notices;

describe('error code texts', () => {
  it.each([...backendCodes, ...clientCodes])('%s has German and English text', (code) => {
    expect(germanErrors[code]).toBeTruthy();
    expect(englishErrors[code]).toBeTruthy();
  });
});

describe('notice code texts', () => {
  it.each(noticeCodes)('%s has German and English text', (code) => {
    expect(germanNotices[code]).toBeTruthy();
    expect(englishNotices[code]).toBeTruthy();
  });
});

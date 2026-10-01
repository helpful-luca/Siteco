/**
 * Where each error code shows up in the UI. Typed over every code of the contract plus the
 * client's own codes, so a new backend code does not compile until it has a place. The same
 * table generates `docs/errors.md` (see error-catalog.test.ts).
 */
import type { AnyErrorCode, ClientErrorCode } from './errors';

export type ErrorSurface =
  | 'composer' // a note above the composer, the question stays in the field
  | 'countdown' // the composer note or the upload row counts down, sending waits
  | 'answer' // inline in the answer: a card, or a line under partial text, with actions
  | 'library' // the upload row or the document row in the library
  | 'viewer' // the source panel
  | 'banner' // the global banner at the top of the page column
  | 'startup' // the startup screen before the app opens
  | 'page' // a whole view (not found, route error screen)
  | 'form' // next to the control that caused it (rename, dialogs)
  | 'silent'; // handled without a message

export const ERROR_SURFACES: Record<AnyErrorCode, readonly ErrorSurface[]> = {
  VALIDATION_ERROR: ['composer', 'form'],
  NOT_FOUND: ['page', 'viewer'],
  METHOD_NOT_ALLOWED: ['composer', 'form'],
  UNAUTHORIZED_CLIENT: ['startup', 'composer'],
  SERVICE_STARTING: ['startup'],
  INTERNAL_ERROR: ['composer', 'answer', 'library', 'page'],
  REQUEST_TOO_LARGE: ['composer', 'form'],
  RATE_LIMITED: ['countdown'],
  UPLOAD_TOO_LARGE: ['library'],
  UNSUPPORTED_TYPE: ['library'],
  FILE_CONTENT_MISMATCH: ['library'],
  EMPTY_FILE: ['library'],
  DUPLICATE_DOCUMENT: ['library'],
  STORAGE_QUOTA: ['library'],
  STORAGE_FULL: ['library'],
  UPLOAD_INCOMPLETE: ['library'],
  DOCUMENT_NOT_READY: ['viewer'],
  DOCUMENT_FILE_MISSING: ['viewer'],
  DELETE_FAILED: ['library', 'form'],
  RANGE_NOT_SATISFIABLE: ['viewer'],
  PDF_ENCRYPTED: ['library'],
  PDF_CORRUPT: ['library'],
  PDF_NO_TEXT: ['library'],
  PDF_TOO_MANY_PAGES: ['library'],
  TEXT_ENCODING_UNSUPPORTED: ['library'],
  DOCUMENT_EMPTY: ['library'],
  DOCUMENT_TOO_LONG: ['library'],
  PROCESSING_TIMEOUT: ['library'],
  PROCESSING_FAILED: ['library'],
  PROCESSING_INTERRUPTED: ['library'],
  MALWARE_DETECTED: ['library'],
  MALWARE_SCAN_FAILED: ['library'],
  CHAT_NOT_FOUND: ['page'],
  CHAT_BUSY: ['composer'],
  CHAT_LIMIT: ['composer'],
  MESSAGE_LIMIT: ['composer'],
  MESSAGE_NOT_LATEST: ['composer'],
  DUPLICATE_REQUEST: ['silent'],
  CONCURRENCY_LIMIT: ['countdown'],
  NO_DOCUMENTS: ['composer'],
  DOCUMENTS_NOT_READY: ['composer'],
  QUESTION_EMPTY: ['composer'],
  QUESTION_TOO_LONG: ['composer'],
  MODEL_NOT_ALLOWED: ['composer'],
  COMPARE_SAME_MODEL: ['answer'],
  TOKEN_BUDGET_EXCEEDED: ['banner', 'composer'],
  API_KEY_INVALID: ['form'],
  LLM_AUTH: ['banner', 'answer'],
  LLM_BILLING: ['banner', 'answer'],
  LLM_FORBIDDEN: ['answer'],
  MODEL_UNAVAILABLE: ['answer', 'composer'],
  LLM_RATE_LIMITED: ['answer'],
  LLM_OVERLOADED: ['answer'],
  LLM_UNAVAILABLE: ['answer'],
  LLM_TIMEOUT: ['answer'],
  LLM_UNREACHABLE: ['answer'],
  LLM_BAD_REQUEST: ['answer'],
  LLM_CONTEXT_TOO_LARGE: ['answer'],
  LLM_EMPTY_ANSWER: ['answer'],
  BACKEND_UNAVAILABLE: ['banner', 'startup', 'composer'],
  FORBIDDEN_ORIGIN: ['composer', 'form'],
  NETWORK_ERROR: ['banner', 'startup', 'composer', 'library'],
  STREAM_INTERRUPTED: ['answer', 'composer'],
  UNKNOWN_ERROR: ['composer', 'answer', 'library', 'page'],
};

/** The codes that never come from the backend: made by the Next.js proxy or by the browser. */
export const CLIENT_ERROR_SPECS: Record<ClientErrorCode, { status: number | null; retryable: boolean; origin: 'proxy' | 'browser' }> = {
  BACKEND_UNAVAILABLE: { status: 503, retryable: true, origin: 'proxy' },
  FORBIDDEN_ORIGIN: { status: 403, retryable: false, origin: 'proxy' },
  NETWORK_ERROR: { status: null, retryable: true, origin: 'browser' },
  STREAM_INTERRUPTED: { status: null, retryable: true, origin: 'browser' },
  UNKNOWN_ERROR: { status: null, retryable: true, origin: 'browser' },
};

/** Codes that mean `/api/config` changed: the key was rejected, a model is gone, the budget. */
export const CONFIG_CHANGING_CODES: ReadonlySet<string> = new Set([
  'LLM_AUTH',
  'MODEL_UNAVAILABLE',
  'TOKEN_BUDGET_EXCEEDED',
]);

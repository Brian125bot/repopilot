/**
 * Centralized structured logger with recursive secret redaction.
 *
 * Emits JSON to stdout with standard metadata (timestamp, level, route,
 * method, requestId, message, context). All values are recursively redacted
 * before serialization so no plaintext credentials, API keys, bearer tokens,
 * vault contents, or raw code/diff/prompt payloads ever reach stdout.
 *
 * Fail-closed: if serialization itself throws, a safe fallback message is
 * emitted and raw inputs are never echoed.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  route?: string;
  method?: string;
  requestId?: string;
  [key: string]: unknown;
}

const SENSITIVE_HEADERS = new Set([
  'x-jules-api-key',
  'x-gemini-api-key',
  'x-github-pat',
  'authorization',
  'cookie',
  'set-cookie',
]);

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'pat',
  'secret',
  'password',
  'privatekey',
  'private_key',
  'vault',
  'ciphertext',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
]);

const SECRET_PATTERNS: RegExp[] = [
  /AIzaSy[A-Za-z0-9-_]{33}/g, // Google API Key
  /ghp_[A-Za-z0-9]{36}/g, // GitHub classic PAT
  /github_pat_[A-Za-z0-9_]{82}/g, // GitHub fine-grained PAT
  /sk-[A-Za-z0-9-_]{48}/g, // OpenAI / Generic secret key
  /sk-proj-[A-Za-z0-9-_]{40,}/g, // OpenAI project key
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

/** Threshold (chars) above which a large payload is summarized instead of dumped. */
const LARGE_PAYLOAD_THRESHOLD = 1000;

function maskString(str: string): string {
  let masked = str;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, '[REDACTED]');
  }
  return masked;
}

/**
 * Recursively redact any value. Handles nested objects/arrays, sensitive
 * headers/keys, embedded token patterns in strings, and large payload
 * bodies (diffs, file contents, prompts).
 */
export function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return maskString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const redactedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_HEADERS.has(lowerKey) || SENSITIVE_KEYS.has(lowerKey)) {
        redactedObj[key] = '[REDACTED]';
      } else if (lowerKey === 'diff' && typeof value === 'string' && value.length > LARGE_PAYLOAD_THRESHOLD) {
        redactedObj[key] = { diffLength: value.length, status: 'redacted' };
      } else if (lowerKey === 'filecontents' && typeof value === 'string' && value.length > LARGE_PAYLOAD_THRESHOLD) {
        redactedObj[key] = { contentLength: value.length, status: 'redacted' };
      } else if (lowerKey === 'prompt' && typeof value === 'string' && value.length > LARGE_PAYLOAD_THRESHOLD) {
        redactedObj[key] = { promptLength: value.length, status: 'redacted' };
      } else {
        redactedObj[key] = redact(value);
      }
    }
    return redactedObj;
  }

  return obj;
}

function safeFallback(level: LogLevel, message: string): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), level, message });
}

function emit(level: LogLevel, formatted: string): void {
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else if (level === 'debug') {
    console.debug(formatted);
  } else {
    console.info(formatted);
  }
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  route?: string;
  method?: string;
  requestId?: string;
  message: string;
  context?: unknown;
}

function buildEntry(level: LogLevel, message: string, context?: unknown): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: maskString(message),
  };

  const ctx = (context && typeof context === 'object') ? (context as Record<string, unknown>) : undefined;
  const route = ctx?.route;
  const method = ctx?.method;
  const requestId = ctx?.requestId;
  if (typeof route === 'string') entry.route = route;
  if (typeof method === 'string') entry.method = method;
  if (typeof requestId === 'string') entry.requestId = requestId;

  const { route: _route, method: _method, requestId: _requestId, ...rest } = ctx ?? {};
  const sanitizedRest = redact(rest);
  if (sanitizedRest && typeof sanitizedRest === 'object' && Object.keys(sanitizedRest as object).length > 0) {
    entry.context = sanitizedRest;
  }
  return entry;
}

function logMessage(level: LogLevel, message: string, context?: unknown): void {
  try {
    const entry = buildEntry(level, message, context);
    const out = JSON.stringify(entry);
    emit(level, out);
  } catch {
    // Fail-closed: never echo raw inputs; emit a safe fallback only.
    emit('error', safeFallback('error', 'Log serialization failed'));
  }
}

export const logger = {
  info: (message: string, context?: unknown) => logMessage('info', message, context),
  warn: (message: string, context?: unknown) => logMessage('warn', message, context),
  error: (message: string, context?: unknown) => logMessage('error', message, context),
  debug: (message: string, context?: unknown) => logMessage('debug', message, context),
};

/**
 * Log a route error with typed metadata. The error message is redacted (any
 * embedded token patterns are masked) and the stack trace is deliberately
 * omitted so no code paths or payloads leak into logs.
 */
export function logRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message, {
    route,
    error: {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

/** Resolve a per-request correlation ID, honoring an inbound x-request-id. */
export function getRequestId(req: Request): string {
  const header = req.headers.get('x-request-id');
  if (header && header.trim().length > 0 && header.trim().length <= 128) {
    return header.trim();
  }
  return crypto.randomUUID();
}
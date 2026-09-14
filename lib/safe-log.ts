export const logger = {
  info: (message: string, context?: any) => logMessage('info', message, context),
  warn: (message: string, context?: any) => logMessage('warn', message, context),
  error: (message: string, context?: any) => logMessage('error', message, context),
  debug: (message: string, context?: any) => logMessage('debug', message, context),
};

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
  'token',
  'pat',
  'secret',
  'password',
  'privatekey',
  'vault',
  'ciphertext',
]);

const SECRET_PATTERNS = [
  /AIzaSy[A-Za-z0-9-_]{33}/g, // Google API Key
  /ghp_[A-Za-z0-9]{36}/g,     // GitHub PAT
  /github_pat_[A-Za-z0-9_]{82}/g, // GitHub Fine-grained PAT
  /sk-[A-Za-z0-9-_]{48}/g,    // OpenAI / Generic Secret Key
];

function maskString(str: string): string {
  let masked = str;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, '[REDACTED]');
  }
  return masked;
}

export function redact(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return maskString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }

  if (typeof obj === 'object') {
    const redactedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_HEADERS.has(lowerKey) || SENSITIVE_KEYS.has(lowerKey)) {
        redactedObj[key] = '[REDACTED]';
      } else if (lowerKey === 'diff' && typeof value === 'string' && value.length > 1000) {
        redactedObj[key] = { diffLength: value.length, status: 'redacted' };
      } else if (lowerKey === 'filecontents' && typeof value === 'string' && value.length > 1000) {
          redactedObj[key] = { contentLength: value.length, status: 'redacted' };
      } else {
        redactedObj[key] = redact(value);
      }
    }
    return redactedObj;
  }

  return obj;
}

function logMessage(level: string, message: string, context?: any) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context: redact(context) }),
    };

    const out = JSON.stringify(logEntry);
    if (level === 'error') {
      console.error(out);
    } else if (level === 'warn') {
      console.warn(out);
    } else if (level === 'debug') {
      console.debug(out);
    } else {
      console.info(out);
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Log serialization failed' }));
  }
}

/** Route logs: message only. Never pass request headers or credential values. */
export function logRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(message, { route, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
}

export function getRequestId(req: Request): string {
    return req.headers.get('x-request-id') || crypto.randomUUID();
}

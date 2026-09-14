import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nextConfig from '@/next.config';

describe('Security Headers & Empty-Env Contract (COR-36)', () => {
  it('vercel.json defines required security headers with explicit connect-src origins', () => {
    const raw = readFileSync(join(process.cwd(), 'vercel.json'), 'utf-8');
    const vercelJson = JSON.parse(raw) as {
      headers?: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };

    expect(vercelJson.headers).toBeDefined();
    const routeHeaders = vercelJson.headers?.find((h) => h.source === '/(.*)');
    expect(routeHeaders).toBeDefined();

    const headerMap = new Map(routeHeaders?.headers.map((h) => [h.key, h.value]));

    expect(headerMap.has('Content-Security-Policy')).toBe(true);
    expect(headerMap.has('Referrer-Policy')).toBe(true);
    expect(headerMap.has('X-Content-Type-Options')).toBe(true);
    expect(headerMap.has('X-Frame-Options')).toBe(true);
    expect(headerMap.has('Permissions-Policy')).toBe(true);

    const csp = headerMap.get('Content-Security-Policy') || '';
    const connectSrcMatch = csp.match(/connect-src\s+([^;]+)/);
    expect(connectSrcMatch).not.toBeNull();
    const connectSrcTokens = connectSrcMatch![1].split(/\s+/);

    expect(connectSrcTokens).toContain("'self'");
    expect(connectSrcTokens).toContain('https://api.github.com');
    expect(connectSrcTokens).toContain('https://generativelanguage.googleapis.com');
    expect(connectSrcTokens).toContain('https://jules.googleapis.com');
    expect(connectSrcTokens).not.toContain('*');

    expect(headerMap.get('Referrer-Policy')).toBe('no-referrer');
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headerMap.get('X-Frame-Options')).toBe('DENY');
  });

  it('next.config.ts exports equivalent security headers', async () => {
    const headersFn = nextConfig.headers;
    expect(typeof headersFn).toBe('function');
    if (typeof headersFn === 'function') {
      const result = await headersFn();
      expect(Array.isArray(result)).toBe(true);
      const mainRoute = result.find((r) => r.source === '/:path*');
      expect(mainRoute).toBeDefined();

      const headerMap = new Map(mainRoute?.headers.map((h) => [h.key, h.value]));
      expect(headerMap.has('Content-Security-Policy')).toBe(true);
      expect(headerMap.get('Referrer-Policy')).toBe('no-referrer');
      expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headerMap.get('X-Frame-Options')).toBe('DENY');
      expect(headerMap.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=()');

      const csp = headerMap.get('Content-Security-Policy') || '';
      expect(csp).toContain('https://api.github.com');
      expect(csp).toContain('https://generativelanguage.googleapis.com');
      expect(csp).toContain('https://jules.googleapis.com');
      expect(csp).not.toContain('connect-src *');
    }
  });

  it('.env.example documents that public Production/Preview must leave keys unset', () => {
    const content = readFileSync(join(process.cwd(), '.env.example'), 'utf-8');
    expect(content).toMatch(/Production and Preview Vercel projects MUST leave JULES_API_KEY/i);
    expect(content).toMatch(/GEMINI_API_KEY/i);
    expect(content).toMatch(/GITHUB_PAT unset/i);
    expect(content).toMatch(/security blocker/i);
  });
});

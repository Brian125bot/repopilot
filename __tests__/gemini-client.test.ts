import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGeminiClient } from '@/lib/gemini';

describe('getGeminiClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the client from the request header only', () => {
    const src = readFileSync('lib/gemini.ts', 'utf8');
    const start = src.indexOf('export function getGeminiClient');
    const end = src.indexOf('const auditEvaluationSchema');
    const fn = src.slice(start, end);
    expect(fn).not.toContain('process.env');
    expect(fn).toContain("'User-Agent': 'RepoPilot/1.0'");

    vi.stubEnv('GEMINI_API_KEY', 'server-held-gemini-key');
    expect(() => getGeminiClient()).toThrow(/x-gemini-api-key/);
    expect(() => getGeminiClient('   ')).toThrow(/x-gemini-api-key request header/);
    expect(getGeminiClient('header-key')).toBeTruthy();
  });
});

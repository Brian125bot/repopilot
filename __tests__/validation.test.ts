import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  parseRequestBody,
  parseQueryParams,
  formatZodError,
  VaultPostBodySchema,
  VaultDeleteQuerySchema,
  JulesDispatchBodySchema,
  JulesMessageBodySchema,
  AuditEvaluateBodySchema,
  RepoInspectBodySchema,
} from '@/lib/validation';
import { POST as vaultPOST, DELETE as vaultDELETE } from '@/app/api/vault/route';
import { POST as dispatchPOST } from '@/app/api/jules/dispatch/route';
import { POST as messagePOST } from '@/app/api/jules/message/route';
import { POST as evaluatePOST } from '@/app/api/audit/evaluate/route';
import { z } from 'zod';

describe('Shared Validation Module (lib/validation.ts)', () => {
  describe('parseRequestBody & formatZodError', () => {
    const TestSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      age: z.number().min(18, 'Must be at least 18'),
    });

    it('returns typed data for valid request body', async () => {
      const req = new NextRequest('http://localhost:3000/api/test', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice', age: 25 }),
      });

      const result = await parseRequestBody(TestSchema, req);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'Alice', age: 25 });
      }
    });

    it('returns 400 response with typed error shape for invalid input', async () => {
      const req = new NextRequest('http://localhost:3000/api/test', {
        method: 'POST',
        body: JSON.stringify({ name: '', age: 10 }),
      });

      const result = await parseRequestBody(TestSchema, req);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(400);
        const data = await result.response.json();
        expect(data.code).toBe('INVALID_INPUT');
        expect(data.success).toBe(false);
        expect(typeof data.error).toBe('string');
        expect(data.details).toBeInstanceOf(Array);
        expect(data.details.length).toBeGreaterThan(0);
        expect(data.details[0]).toHaveProperty('field');
        expect(data.details[0]).toHaveProperty('message');
      }
    });

    it('returns 400 for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/test', {
        method: 'POST',
        body: '{ malformed json',
      });

      const result = await parseRequestBody(TestSchema, req);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(400);
        const data = await result.response.json();
        expect(data.code).toBe('INVALID_INPUT');
        expect(data.error).toContain('Invalid JSON body');
      }
    });
  });

  describe('parseQueryParams', () => {
    const QuerySchema = z.object({
      id: z.string().min(1, 'ID is required'),
      count: z.string().optional(),
    });

    it('parses valid query parameters', () => {
      const req = new NextRequest('http://localhost:3000/api/test?id=123&count=5');
      const result = parseQueryParams(QuerySchema, req);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ id: '123', count: '5' });
      }
    });

    it('returns 400 for missing required query param', async () => {
      const req = new NextRequest('http://localhost:3000/api/test');
      const result = parseQueryParams(QuerySchema, req);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.response.status).toBe(400);
        const data = await result.response.json();
        expect(data.code).toBe('INVALID_INPUT');
      }
    });
  });

  describe('Strict Rejection (.strict()) on Security-Sensitive Schemas', () => {
    it('vault schema rejects unknown keys', () => {
      const res = VaultPostBodySchema.safeParse({
        blueprint: { blueprintId: 'bp_123' },
        unauthorizedExtraKey: 'malicious',
      });
      expect(res.success).toBe(false);
    });

    it('jules/dispatch schema rejects unknown keys', () => {
      const res = JulesDispatchBodySchema.safeParse({
        repo: 'owner/repo',
        objective: 'Objective text for dispatch',
        criteria: [{ id: '1', text: 'Criterion 1' }],
        extraMaliciousParam: 'hacked',
      });
      expect(res.success).toBe(false);
    });

    it('jules/message schema rejects unknown keys', () => {
      const res = JulesMessageBodySchema.safeParse({
        sessionId: 'sessions/123',
        prompt: 'Follow up prompt',
        unexpectedField: 'forbidden',
      });
      expect(res.success).toBe(false);
    });
  });
});

describe('Route-Level Validation Enforcement', () => {
  describe('POST /api/vault', () => {
    it('returns 400 and fails closed when extra keys are sent (strict rejection)', async () => {
      const req = new NextRequest('http://localhost:3000/api/vault', {
        method: 'POST',
        body: JSON.stringify({
          blueprint: { blueprintId: 'bp_test_123' },
          extraField: 'unexpected',
        }),
      });

      const res = await vaultPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.success).toBe(false);
      expect(data.details).toBeDefined();
    });

    it('returns 400 when blueprint or blueprintId is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/vault', {
        method: 'POST',
        body: JSON.stringify({ blueprint: {} }),
      });

      const res = await vaultPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('blueprintId is required');
    });
  });

  describe('DELETE /api/vault', () => {
    it('returns 400 when id query parameter is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/vault', {
        method: 'DELETE',
      });

      const res = await vaultDELETE(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('blueprint id query parameter is required');
    });
  });

  describe('POST /api/jules/dispatch', () => {
    it('returns 400 and fails closed on unknown payload keys', async () => {
      const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'acme/repo',
          objective: 'Test objective description',
          criteria: [{ id: '1', text: 'Criterion 1' }],
          dryRun: true,
          forbiddenAttribute: 'fail',
        }),
      });

      const res = await dispatchPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.success).toBe(false);
    });

    it('returns 400 when repo is missing or not owner/repo', async () => {
      const req = new NextRequest('http://localhost:3000/api/jules/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'invalidrepo',
          objective: 'Test objective description',
          criteria: [{ id: '1', text: 'Criterion 1' }],
        }),
      });

      const res = await dispatchPOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('Invalid repository');
    });
  });

  describe('POST /api/jules/message', () => {
    it('returns 400 and fails closed on unknown payload keys', async () => {
      const req = new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'test-key' },
        body: JSON.stringify({
          sessionId: 'sessions/123',
          prompt: 'Help me fix this',
          unexpectedParam: 'injection',
        }),
      });

      const res = await messagePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.success).toBe(false);
    });

    it('returns 400 when prompt is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/jules/message', {
        method: 'POST',
        headers: { 'x-jules-api-key': 'test-key' },
        body: JSON.stringify({
          sessionId: 'sessions/123',
          prompt: '',
        }),
      });

      const res = await messagePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('Prompt is required');
    });
  });

  describe('POST /api/audit/evaluate', () => {
    it('returns 400 when diff is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: '',
          criteria: [{ id: '1', text: 'Crit' }],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('Cannot evaluate empty diff');
    });

    it('returns 400 when criteria matrix is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/audit/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          diff: 'diff --git a/file.txt b/file.txt',
          criteria: [],
        }),
      });

      const res = await evaluatePOST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_INPUT');
      expect(data.error).toContain('Acceptance criteria matrix is required');
    });
  });
});

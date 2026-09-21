import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/gemini', () => ({
  extractGoalFromText: vi.fn().mockImplementation(async ({ rawText }: { rawText: string }) => {
    if (rawText.includes('Add a /healthz endpoint')) {
      return {
        title: 'Add /healthz endpoint and documentation',
        scope: ['api/healthz'],
        acceptanceCriteria: [
          'GET /healthz returns HTTP 200 with {status: "ok", uptime: <seconds>}',
          'Update README.md with /healthz documentation',
        ],
        assumptions: [],
        ambiguityFlags: [],
      };
    }

    if (rawText.includes('Refactor /api/audit/evaluate to stream')) {
      return {
        title: 'Refactor /api/audit/evaluate for Gemini streaming',
        scope: [
          'app/api/audit/evaluate/route.ts',
          'lib/diff-sanitizer.ts',
          'app/api/audit/evaluate/route.test.ts',
        ],
        acceptanceCriteria: [
          'Stream Gemini response in /api/audit/evaluate',
          'Update diff sanitizer to support chunked deltas',
          'Add Vitest spec verifying backpressure and partial-line JSON',
        ],
        assumptions: [],
        ambiguityFlags: [],
      };
    }

    if (rawText.trim() === 'make it better') {
      return {
        title: 'UNCLEAR',
        scope: [],
        acceptanceCriteria: [],
        assumptions: [],
        ambiguityFlags: [
          'no target system mentioned',
          'no acceptance criteria',
          'no scope boundaries',
        ],
      };
    }

    return {
      title: 'Generic Task',
      scope: ['general'],
      acceptanceCriteria: ['Do the task'],
      assumptions: [],
      ambiguityFlags: [],
    };
  }),
}));

describe('POST /api/goal/extract', () => {
  it('Fixture 1: extracts healthz endpoint goal correctly', async () => {
    const rawText =
      'Add a /healthz endpoint that returns 200 with {status:"ok",uptime:<seconds>} and document it in the README.';
    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': 'test-gemini-key',
      },
      body: JSON.stringify({ rawText }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.title).toBeTruthy();
    expect(json.title).not.toBe('UNCLEAR');
    expect(json.scope.length).toBeGreaterThanOrEqual(1);
    expect(json.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
    expect(json.ambiguityFlags).toHaveLength(0);
  });

  it('Fixture 2: extracts streaming refactor goal correctly', async () => {
    const rawText =
      'Refactor /api/audit/evaluate to stream the Gemini response; update the diff sanitizer to handle chunked deltas; add a Vitest spec for backpressure and partial-line JSON.';
    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': 'test-gemini-key',
      },
      body: JSON.stringify({ rawText }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.title).toBeTruthy();
    expect(json.scope.length).toBe(3);
    expect(json.acceptanceCriteria.length).toBe(3);
    expect(json.ambiguityFlags).toHaveLength(0);
  });

  it('Fixture 3: vague input "make it better" produces title UNCLEAR and non-empty ambiguityFlags', async () => {
    const rawText = 'make it better';
    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': 'test-gemini-key',
      },
      body: JSON.stringify({ rawText }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.title).toBe('UNCLEAR');
    expect(json.ambiguityFlags.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty rawText with status 400', async () => {
    const req = new NextRequest('http://localhost/api/goal/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawText: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Blueprint } from '@/types';
import {
  VaultStoreError,
  resolveDriver,
  toVaultSummary,
  upstashRestConfig,
} from '@/lib/blueprint-vault-driver';
import { DELETE, GET, POST } from '@/app/api/vault/route';
import { NextRequest } from 'next/server';

const briefed = (id: string): Blueprint => ({
  blueprintId: id,
  repo: 'acme/api',
  baseBranch: 'main',
  branchName: 'jules/x',
  fileBoundaries: ['src/**'],
  objective: 'Implement x in src verified by tests',
  criteria: [{ id: '1', text: 'Works in src verified by test', category: 'functional' }],
  createdAt: new Date().toISOString(),
  lastBrief: {
    verdict: 'NEEDS_REVISION',
    score: 62,
    unmetIds: ['1'],
    partialIds: [],
    metIds: [],
    unauthorizedPaths: [],
    doNotTouch: [],
    requiredFixes: ['[UNMET] Criterion 1: fix it'],
  },
});

describe('vault driver selection', () => {
  it('selects upstash-rest only when base URL and token are both present', () => {
    expect(upstashRestConfig({} as Record<string, string | undefined>)).toBeNull();
    expect(
      upstashRestConfig({ KV_REST_API_URL: 'https://x.upstash.io' } as Record<string, string | undefined>)
    ).toBeNull();
    expect(
      upstashRestConfig({
        KV_REST_API_URL: 'https://x.upstash.io/',
        KV_REST_API_TOKEN: 'tok',
      } as Record<string, string | undefined>)
    ).toEqual({ baseUrl: 'https://x.upstash.io', token: 'tok' });
  });

  it('resolveDriver prefers upstash over local file', () => {
    const fetchMock = vi.fn();
    expect(
      resolveDriver({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' } as Record<string, string | undefined>, fetchMock as unknown as typeof fetch).name
    ).toBe('upstash-rest');
    expect(resolveDriver({} as Record<string, string | undefined>, fetchMock as unknown as typeof fetch).name).toBe('local-file');
  });
});

describe('local file driver (isolated temp dir)', () => {
  let dir = '';
  let prev = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repopilot-vault-'));
    prev = process.env.REPOPILOT_VAULT_DIR || '';
    process.env.REPOPILOT_VAULT_DIR = dir;
  });

  afterEach(() => {
    if (prev) process.env.REPOPILOT_VAULT_DIR = prev;
    else delete process.env.REPOPILOT_VAULT_DIR;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips blueprints with lastBrief byte-identical', async () => {
    const driver = resolveDriver();
    expect(driver.name).toBe('local-file');
    await driver.upsert(briefed('bp_1'));
    const got = await driver.get('bp_1');
    expect(got?.lastBrief).toEqual(briefed('bp_1').lastBrief);
    const list = await driver.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ blueprintId: 'bp_1', hasLastBrief: true });
    expect(toVaultSummary(briefed('bp_1')).hasLastBrief).toBe(true);
  });

  it('remove returns false for unknown ids and true once', async () => {
    const driver = resolveDriver();
    expect(await driver.remove('nope')).toBe(false);
    await driver.upsert(briefed('bp_2'));
    expect(await driver.remove('bp_2')).toBe(true);
    expect(await driver.get('bp_2')).toBeNull();
  });

  it('rejects blueprints without identity', async () => {
    const driver = resolveDriver();
    await expect(driver.upsert({} as Blueprint)).rejects.toBeInstanceOf(VaultStoreError);
  });
});

describe('upstash REST driver (mocked fetch)', () => {
  const env = { KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 'tok' } as Record<string, string | undefined>;

  it('upserts then reads back through the REST protocol', async () => {
    const store = new Map<string, string>();
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as unknown;
      const cmds: (string | number)[][] = Array.isArray((body as unknown[])[0])
        ? ((body as unknown[]) as (string | number)[][])
        : [body as (string | number)[]];
      const results = cmds.map((cmd) => {
        if (cmd[0] === 'SADD' || cmd[0] === 'SREM' || cmd[0] === 'DEL') return 1;
        if (cmd[0] === 'SET') {
          store.set(String(cmd[1]), String(cmd[2]));
          return 'OK';
        }
        if (cmd[0] === 'GET') return store.get(String(cmd[1])) ?? null;
        if (cmd[0] === 'SMEMBERS') return ['bp_r'];
        return null;
      });
      const isPipeline = Array.isArray((body as unknown[])[0]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: isPipeline ? results : results[0] }),
      } as unknown as Response;
    });
    const driver = resolveDriver(env, fetchMock as unknown as typeof fetch);
    await driver.upsert(briefed('bp_r'));
    expect(await driver.get('bp_r')).toMatchObject({ blueprintId: 'bp_r' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
    });
  });

  it('surfaces transport failures as VaultStoreError', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('down');
    });
    const driver = resolveDriver(env, fetchMock as unknown as typeof fetch);
    await expect(driver.get('bp_x')).rejects.toBeInstanceOf(VaultStoreError);
  });
});

describe('/api/vault route validation', () => {
  it('POST requires a blueprintId with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/vault', {
      method: 'POST',
      body: JSON.stringify({ blueprint: { repo: 'a/b' } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('DELETE requires an id with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/vault', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('GET round-trips through the local driver including lastBrief', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repopilot-vault-route-'));
    const prev = process.env.REPOPILOT_VAULT_DIR;
    process.env.REPOPILOT_VAULT_DIR = dir;
    try {
      const post = await POST(
        new NextRequest('http://localhost:3000/api/vault', {
          method: 'POST',
          body: JSON.stringify({ blueprint: briefed('bp_route') }),
        })
      );
      expect(post.status).toBe(200);
      const get = await GET(
        new NextRequest('http://localhost:3000/api/vault?id=bp_route')
      );
      expect(get.status).toBe(200);
      const data = await get.json();
      expect(data.blueprint.lastBrief?.verdict).toBe('NEEDS_REVISION');
      const list = await GET(new NextRequest('http://localhost:3000/api/vault'));
      const listed = await list.json();
      expect(listed.blueprints).toHaveLength(1);
      expect(listed.blueprints[0].hasLastBrief).toBe(true);
      const del = await DELETE(new NextRequest('http://localhost:3000/api/vault?id=bp_route'));
      expect(del.status).toBe(200);
      const gone = await GET(new NextRequest('http://localhost:3000/api/vault?id=bp_route'));
      expect(gone.status).toBe(404);
    } finally {
      if (prev === undefined) delete process.env.REPOPILOT_VAULT_DIR;
      else process.env.REPOPILOT_VAULT_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

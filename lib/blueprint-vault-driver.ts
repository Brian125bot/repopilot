import type { Blueprint, VaultBlueprintSummary } from '@/types';

/**
 * Dual-runtime blueprint vault (server side — never touches localStorage).
 *
 * - Local driver (default / local dev): `.repopilot/vault.json` via
 *   node:fs/promises. Directory is created on first write.
 * - Vercel/Upstash driver: zero-dependency REST client used when
 *   `KV_REST_API_URL` (or `UPSTASH_REDIS_REST_URL`) plus a token env var is
 *   present. Blueprints live under `repopilot:blueprint:{id}` with membership
 *   tracked in the `repopilot:blueprints` set.
 *
 * Client code keeps localStorage as its graceful fallback when the server
 * store is unreachable (see callers — the driver itself never degrades
 * silently; it throws VaultStoreError).
 */

export class VaultStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultStoreError';
  }
}

export type VaultDriverName = 'local-file' | 'upstash-rest';

export interface VaultDriver {
  readonly name: VaultDriverName;
  list(): Promise<VaultBlueprintSummary[]>;
  get(id: string): Promise<Blueprint | null>;
  upsert(blueprint: Blueprint): Promise<void>;
  remove(id: string): Promise<boolean>;
}

export function toVaultSummary(blueprint: Blueprint, updatedAt?: string): VaultBlueprintSummary {
  return {
    blueprintId: blueprint.blueprintId,
    repo: blueprint.repo,
    branchName: blueprint.branchName,
    baseBranch: blueprint.baseBranch,
    objective: blueprint.objective,
    createdAt: blueprint.createdAt,
    updatedAt,
    hasLastBrief: Boolean(blueprint.lastBrief),
  };
}

function isValidBlueprint(value: unknown): value is Blueprint {
  if (!value || typeof value !== 'object') return false;
  const bp = value as Record<string, unknown>;
  return (
    typeof bp.blueprintId === 'string' &&
    bp.blueprintId.length > 0 &&
    Array.isArray(bp.criteria) &&
    Array.isArray(bp.fileBoundaries)
  );
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------

export function upstashRestConfig(env: Record<string, string | undefined> = process.env): {
  baseUrl: string;
  token: string;
} | null {
  const baseUrl = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function vaultDir(env: Record<string, string | undefined> = process.env): string {
  return env.REPOPILOT_VAULT_DIR?.trim() || '.repopilot';
}

// ---------------------------------------------------------------------------
// Local file driver
// ---------------------------------------------------------------------------

interface LocalVaultFile {
  version: 1;
  blueprints: Record<string, { blueprint: Blueprint; updatedAt: string }>;
}

async function readLocalFile(dir: string): Promise<LocalVaultFile> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try {
    const raw = await readFile(join(process.cwd(), dir, 'vault.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LocalVaultFile>;
    if (parsed && typeof parsed === 'object' && parsed.blueprints && typeof parsed.blueprints === 'object') {
      return { version: 1, blueprints: parsed.blueprints as LocalVaultFile['blueprints'] };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw new VaultStoreError(
        `Local vault unreadable: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  }
  return { version: 1, blueprints: {} };
}

async function writeLocalFile(dir: string, data: LocalVaultFile): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try {
    await mkdir(join(process.cwd(), dir), { recursive: true });
    await writeFile(join(process.cwd(), dir, 'vault.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    throw new VaultStoreError(
      `Local vault unwritable: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  }
}

function localFileDriver(dir: string): VaultDriver {
  return {
    name: 'local-file',
    async list() {
      const data = await readLocalFile(dir);
      return Object.entries(data.blueprints)
        .filter(([, entry]) => isValidBlueprint(entry?.blueprint))
        .map(([, entry]) => toVaultSummary(entry.blueprint, entry.updatedAt))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    async get(id: string) {
      if (!id.trim()) return null;
      const data = await readLocalFile(dir);
      const entry = data.blueprints[id.trim()];
      return entry && isValidBlueprint(entry.blueprint) ? entry.blueprint : null;
    },
    async upsert(blueprint: Blueprint) {
      if (!isValidBlueprint(blueprint)) {
        throw new VaultStoreError('Refusing to store blueprint without blueprintId/criteria/fileBoundaries.');
      }
      const data = await readLocalFile(dir);
      data.blueprints[blueprint.blueprintId] = {
        blueprint,
        updatedAt: new Date().toISOString(),
      };
      await writeLocalFile(dir, data);
    },
    async remove(id: string) {
      if (!id.trim()) return false;
      const data = await readLocalFile(dir);
      if (!(id.trim() in data.blueprints)) return false;
      delete data.blueprints[id.trim()];
      await writeLocalFile(dir, data);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Upstash REST driver (zero extra dependencies)
// ---------------------------------------------------------------------------

const BLUEPRINT_KEY_PREFIX = 'repopilot:blueprint:';
const BLUEPRINT_INDEX_KEY = 'repopilot:blueprints';

async function upstashCall(
  baseUrl: string,
  token: string,
  command: (string | number)[] | (string | number)[][],
  fetchFn: typeof fetch = fetch
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
    });
  } catch (err) {
    throw new VaultStoreError(
      `Upstash vault unreachable: ${err instanceof Error ? err.message : 'network error'}`
    );
  }
  if (!res.ok) {
    throw new VaultStoreError(`Upstash vault error (HTTP ${res.status}).`);
  }
  const data = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (typeof data.error === 'string' && data.error) {
    throw new VaultStoreError(`Upstash vault error: ${data.error}`);
  }
  return data.result;
}

function upstashRestDriver(baseUrl: string, token: string, fetchFn: typeof fetch = fetch): VaultDriver {
  const keyFor = (id: string) => `${BLUEPRINT_KEY_PREFIX}${id}`;
  return {
    name: 'upstash-rest',
    async list() {
      const ids = (await upstashCall(baseUrl, token, ['SMEMBERS', BLUEPRINT_INDEX_KEY], fetchFn)) as unknown;
      if (!Array.isArray(ids) || ids.length === 0) return [];
      const pipeline = (ids as unknown[]).map((id) => ['GET', keyFor(String(id))]);
      const values = (await upstashCall(baseUrl, token, pipeline, fetchFn)) as unknown;
      const raws = (Array.isArray(values) ? values : [values]).map((v) =>
        v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)
          ? (v as { result?: unknown }).result
          : v
      );
      const out: VaultBlueprintSummary[] = [];
      for (const raw of raws) {
        if (typeof raw !== 'string' || !raw) continue;
        try {
          const parsed = JSON.parse(raw) as { blueprint?: Blueprint; updatedAt?: string };
          if (isValidBlueprint(parsed?.blueprint)) {
            out.push(toVaultSummary(parsed.blueprint, parsed.updatedAt));
          }
        } catch {
          // Skip corrupt entries — never fail the whole listing.
        }
      }
      return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    async get(id: string) {
      if (!id.trim()) return null;
      const raw = (await upstashCall(baseUrl, token, ['GET', keyFor(id.trim())], fetchFn)) as unknown;
      if (typeof raw !== 'string' || !raw) return null;
      try {
        const parsed = JSON.parse(raw) as { blueprint?: Blueprint };
        return isValidBlueprint(parsed?.blueprint) ? parsed.blueprint : null;
      } catch {
        return null;
      }
    },
    async upsert(blueprint: Blueprint) {
      if (!isValidBlueprint(blueprint)) {
        throw new VaultStoreError('Refusing to store blueprint without blueprintId/criteria/fileBoundaries.');
      }
      const payload = JSON.stringify({ blueprint, updatedAt: new Date().toISOString() });
      await upstashCall(
        baseUrl,
        token,
        [
          ['SADD', BLUEPRINT_INDEX_KEY, blueprint.blueprintId],
          ['SET', keyFor(blueprint.blueprintId), payload],
        ],
        fetchFn
      );
    },
    async remove(id: string) {
      if (!id.trim()) return false;
      const removed = (await upstashCall(
        baseUrl,
        token,
        [
          ['SREM', BLUEPRINT_INDEX_KEY, id.trim()],
          ['DEL', keyFor(id.trim())],
        ],
        fetchFn
      )) as unknown;
      // Pipeline responses come back as [{result}, {result}]; single form as {result}.
      const results = Array.isArray(removed)
        ? removed.map((r) => (r && typeof r === 'object' ? (r as { result?: unknown }).result : r))
        : [removed];
      return results.some((n) => n === 1);
    },
  };
}

/** Selects the Upstash REST driver when env is present, else the local file driver. */
export function resolveDriver(
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch
): VaultDriver {
  const rest = upstashRestConfig(env);
  if (rest) return upstashRestDriver(rest.baseUrl, rest.token, fetchFn);
  return localFileDriver(vaultDir(env));
}

import { NextRequest, NextResponse } from 'next/server';
import { apiError, createRequestId } from '@/lib/api-error';
import { resolveDriver, VaultStoreError } from '@/lib/blueprint-vault-driver';
import { Blueprint } from '@/types';
import {
  parseRequestBody,
  parseQueryParams,
  VaultGetQuerySchema,
  VaultPostBodySchema,
  VaultDeleteQuerySchema,
} from '@/lib/validation';

/**
 * Isomorphic blueprint vault (server side of the dual-runtime store).
 *
 * - GET /api/vault → summary list (newest first).
 * - GET /api/vault?id={blueprintId} → full blueprint including lastBrief.
 * - POST /api/vault {blueprint} → upsert (validates blueprintId).
 * - DELETE /api/vault?id={blueprintId} → delete.
 *
 * Storage resolves per runtime: Upstash REST on Vercel (env present), local
 * `.repopilot/vault.json` otherwise. Clients keep localStorage as fallback
 * and treat any non-OK response as "server store unavailable".
 */
export async function GET(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const queryValidation = parseQueryParams(VaultGetQuerySchema, req, '/api/vault', requestId);
    if (!queryValidation.success) return queryValidation.response;

    const id = queryValidation.data.id?.trim() || '';
    const driver = resolveDriver();
    if (id) {
      const blueprint = await driver.get(id);
      if (!blueprint) {
        return apiError('/api/vault', requestId, { status: 404, code: 'NOT_FOUND', message: 'Blueprint not found.' });
      }
      return NextResponse.json({ success: true, blueprint });
    }
    const blueprints = await driver.list();
    return NextResponse.json({ success: true, blueprints, driver: driver.name });
  } catch (error) {
    return apiError('/api/vault', requestId, { status: 502, code: 'UPSTREAM_ERROR', message: error instanceof VaultStoreError ? error.message : 'Vault read failed.' });
  }
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const bodyValidation = await parseRequestBody(VaultPostBodySchema, req, '/api/vault', requestId);
    if (!bodyValidation.success) return bodyValidation.response;

    const blueprint = bodyValidation.data.blueprint as Blueprint;

    const driver = resolveDriver();
    await driver.upsert(blueprint);
    return NextResponse.json({ success: true, blueprintId: blueprint.blueprintId, driver: driver.name });
  } catch (error) {
    return apiError('/api/vault', requestId, { status: 502, code: 'UPSTREAM_ERROR', message: error instanceof VaultStoreError ? error.message : 'Vault write failed.' });
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const queryValidation = parseQueryParams(VaultDeleteQuerySchema, req, '/api/vault', requestId);
    if (!queryValidation.success) return queryValidation.response;

    const id = queryValidation.data.id.trim();
    const driver = resolveDriver();
    const removed = await driver.remove(id);
    if (!removed) {
      return apiError('/api/vault', requestId, { status: 404, code: 'NOT_FOUND', message: 'Blueprint not found.' });
    }
    return NextResponse.json({ success: true, blueprintId: id });
  } catch (error) {
    return apiError('/api/vault', requestId, { status: 502, code: 'UPSTREAM_ERROR', message: error instanceof VaultStoreError ? error.message : 'Vault delete failed.' });
  }
}

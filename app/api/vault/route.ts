import { NextRequest, NextResponse } from 'next/server';
import { resolveDriver, VaultStoreError } from '@/lib/blueprint-vault-driver';
import { Blueprint } from '@/types';
import { logRouteError, logger, getRequestId } from '@/lib/safe-log';
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
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/vault', method: 'GET', requestId });
  try {
    const queryValidation = parseQueryParams(VaultGetQuerySchema, req);
    if (!queryValidation.success) return queryValidation.response;

    const id = queryValidation.data.id?.trim() || '';
    const driver = resolveDriver();
    if (id) {
      const blueprint = await driver.get(id);
      if (!blueprint) {
        logger.info('Request complete', { route: '/api/vault', method: 'GET', requestId, status: 404, latency: performance.now() - start });
      return NextResponse.json({ success: false, error: 'Blueprint not found.' }, { status: 404 });
      }
      logger.info('Request complete', { route: '/api/vault', method: 'GET', requestId, status: 200, latency: performance.now() - start });
      return NextResponse.json({ success: true, blueprint });
    }
    const blueprints = await driver.list();
    logger.info('Request complete', { route: '/api/vault', method: 'GET', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({ success: true, blueprints, driver: driver.name });
  } catch (error) {
    logRouteError('/api/vault', error);
    const message = error instanceof VaultStoreError ? error.message : 'Vault read failed.';
    logger.info('Request complete', { route: '/api/vault', method: req.method, requestId, status: 502, latency: performance.now() - start });
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/vault', method: 'POST', requestId });
  try {
    const bodyValidation = await parseRequestBody(VaultPostBodySchema, req);
    if (!bodyValidation.success) return bodyValidation.response;

    const blueprint = bodyValidation.data.blueprint as Blueprint;

    const driver = resolveDriver();
    await driver.upsert(blueprint);
    logger.info('Request complete', { route: '/api/vault', method: 'POST', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({ success: true, blueprintId: blueprint.blueprintId, driver: driver.name });
  } catch (error) {
    logRouteError('/api/vault', error);
    const message = error instanceof VaultStoreError ? error.message : 'Vault write failed.';
    logger.info('Request complete', { route: '/api/vault', method: req.method, requestId, status: 502, latency: performance.now() - start });
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = getRequestId(req);
  const start = performance.now();
  logger.info('Request entry', { route: '/api/vault', method: 'DELETE', requestId });
  try {
    const queryValidation = parseQueryParams(VaultDeleteQuerySchema, req);
    if (!queryValidation.success) return queryValidation.response;

    const id = queryValidation.data.id.trim();
    const driver = resolveDriver();
    const removed = await driver.remove(id);
    if (!removed) {
      logger.info('Request complete', { route: '/api/vault', method: 'DELETE', requestId, status: 404, latency: performance.now() - start });
      return NextResponse.json({ success: false, error: 'Blueprint not found.' }, { status: 404 });
    }
    logger.info('Request complete', { route: '/api/vault', method: 'DELETE', requestId, status: 200, latency: performance.now() - start });
    return NextResponse.json({ success: true, blueprintId: id });
  } catch (error) {
    logRouteError('/api/vault', error);
    const message = error instanceof VaultStoreError ? error.message : 'Vault delete failed.';
    logger.info('Request complete', { route: '/api/vault', method: req.method, requestId, status: 502, latency: performance.now() - start });
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

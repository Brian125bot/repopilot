/** Route logs: message only. Never pass request headers or credential values. */
export function logRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`${route}: ${message}`);
}

export interface ManifestParseResult {
  packageManager?: string;
  testRunner?: string;
  framework?: string;
  languages: string[];
  dependencies: string[];
  scripts: Record<string, string>;
}

export function parsePackageJson(content: string): ManifestParseResult {
  const result: ManifestParseResult = {
    languages: [],
    dependencies: [],
    scripts: {},
  };

  try {
    const pkg = JSON.parse(content);
    if (typeof pkg !== 'object' || pkg === null) return result;

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const depNames = Object.keys(deps);
    result.dependencies = depNames;

    if (pkg.scripts && typeof pkg.scripts === 'object') {
      for (const [k, v] of Object.entries(pkg.scripts)) {
        if (typeof v === 'string') {
          result.scripts[k] = v;
        }
      }
    }

    const lowerDeps = depNames.map((d) => d.toLowerCase());

    // Detect framework
    if (lowerDeps.includes('next')) result.framework = 'Next.js';
    else if (lowerDeps.includes('nest') || lowerDeps.includes('@nestjs/core')) result.framework = 'NestJS';
    else if (lowerDeps.includes('fastify')) result.framework = 'Fastify';
    else if (lowerDeps.includes('express')) result.framework = 'Express';
    else if (lowerDeps.includes('react')) result.framework = 'React';
    else if (lowerDeps.includes('vue')) result.framework = 'Vue';
    else if (lowerDeps.includes('svelte')) result.framework = 'Svelte';
    else if (lowerDeps.includes('nuxt')) result.framework = 'Nuxt';
    else if (lowerDeps.includes('remix') || lowerDeps.includes('@remix-run/react')) result.framework = 'Remix';

    // Detect test runner
    if (lowerDeps.includes('vitest')) result.testRunner = 'Vitest';
    else if (lowerDeps.includes('jest')) result.testRunner = 'Jest';
    else if (lowerDeps.includes('mocha')) result.testRunner = 'Mocha';
    else if (lowerDeps.includes('playwright') || lowerDeps.includes('@playwright/test')) result.testRunner = 'Playwright';
    else if (lowerDeps.includes('cypress')) result.testRunner = 'Cypress';

    // Detect languages
    if (lowerDeps.includes('typescript') || lowerDeps.includes('ts-node')) {
      result.languages.push('TypeScript');
    }
    result.languages.push('JavaScript');

  } catch {
    // Ignore invalid JSON
  }

  return result;
}

export function detectPackageManagerFromFiles(fileList: string[]): string {
  const lowerFiles = fileList.map((f) => f.toLowerCase());
  const has = (name: string) => lowerFiles.some((f) => f === name || f.endsWith(`/${name}`));

  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (has('package-lock.json')) return 'npm';
  return 'npm';
}

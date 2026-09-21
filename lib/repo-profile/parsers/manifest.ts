export interface ParsedManifest {
  name?: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
  packageManager?: string;
  frameworks: string[];
}

const FRAMEWORKS = [
  'next',
  'react',
  'vue',
  'angular',
  'svelte',
  'nuxt',
  'express',
  'fastify',
  'nestjs'
];

export function parsePackageJson(content: string): ParsedManifest {
  try {
    const pkg = JSON.parse(content);

    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});
    const scripts = Object.keys(pkg.scripts || {});

    const frameworks = [
      ...dependencies,
      ...devDependencies
    ].filter(dep => FRAMEWORKS.includes(dep));

    return {
      name: pkg.name,
      dependencies,
      devDependencies,
      scripts,
      packageManager: pkg.packageManager,
      frameworks: [...new Set(frameworks)],
    };
  } catch (err) {
    return {
      dependencies: [],
      devDependencies: [],
      scripts: [],
      frameworks: []
    };
  }
}

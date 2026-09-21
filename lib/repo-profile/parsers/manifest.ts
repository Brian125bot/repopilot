export interface ParsedManifest {
  name?: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
  packageManager?: string;
  frameworks: string[];
  testRunner?: string;
}

const FRAMEWORKS = [
  "next",
  "react",
  "vue",
  "angular",
  "svelte",
  "nuxt",
  "express",
  "fastify",
  "nestjs"
];

const TEST_RUNNERS = ["vitest", "jest", "mocha"];

export function parsePackageJson(content: string): ParsedManifest {
  try {
    const pkg = JSON.parse(content);

    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});
    const scripts = Object.keys(pkg.scripts || {});

    const allDeps = new Set([...dependencies, ...devDependencies]);

    const frameworks = Array.from(allDeps).filter(dep => FRAMEWORKS.includes(dep));
    const testRunner = TEST_RUNNERS.find(runner => allDeps.has(runner));

    return {
      name: pkg.name,
      dependencies,
      devDependencies,
      scripts,
      packageManager: pkg.packageManager,
      frameworks,
      testRunner,
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

import { ConventionEntry } from '@/lib/types/steering';

export function parseLintAndFormatConfigs(
  files: { path: string; content?: string }[]
): ConventionEntry[] {
  const conventions: ConventionEntry[] = [];

  for (const file of files) {
    const pathLower = file.path.toLowerCase();

    // ESLint configuration
    if (
      pathLower.includes('.eslintrc') ||
      pathLower.includes('eslint.config.') ||
      pathLower.endsWith('eslint')
    ) {
      conventions.push({
        id: `conv-lint-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        title: 'ESLint Configuration',
        body: `Found ESLint config at ${file.path}. Ensures consistent linting and code quality rules.`,
        source: file.path,
      });
    }

    // Prettier configuration
    if (
      pathLower.includes('.prettierrc') ||
      pathLower.includes('prettier.config.')
    ) {
      conventions.push({
        id: `conv-format-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        title: 'Prettier Formatting',
        body: `Found Prettier config at ${file.path}. Automated code formatting rules are configured.`,
        source: file.path,
      });
    }

    // Biome / EditorConfig / Tailwind
    if (pathLower.includes('biome.json')) {
      conventions.push({
        id: 'conv-biome',
        title: 'Biome Toolchain',
        body: `Found Biome config at ${file.path} for fast formatting and linting.`,
        source: file.path,
      });
    }

    if (pathLower === '.editorconfig' || pathLower.endsWith('/.editorconfig')) {
      conventions.push({
        id: 'conv-editorconfig',
        title: 'EditorConfig Rules',
        body: `Found .editorconfig at ${file.path} specifying whitespace, line-endings, and indentation rules.`,
        source: file.path,
      });
    }
  }

  return conventions;
}

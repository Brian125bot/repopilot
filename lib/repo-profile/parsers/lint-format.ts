export interface ParsedLintFormat {
  eslint: boolean;
  prettier: boolean;
  biome: boolean;
  editorconfig: boolean;
}

export function detectLintFormat(files: string[]): ParsedLintFormat {
  const result: ParsedLintFormat = {
    eslint: false,
    prettier: false,
    biome: false,
    editorconfig: false
  };

  for (const file of files) {
    if (file.startsWith('.eslintrc') || file.startsWith('eslint.config.')) {
      result.eslint = true;
    }
    if (
      file.startsWith('.prettierrc') ||
      file === 'prettier.config.js' ||
      file === 'prettier.config.cjs' ||
      file === 'prettier.config.mjs' ||
      file === 'prettier.config.ts' ||
      file === '.prettierignore'
    ) {
      result.prettier = true;
    }
    if (file === 'biome.json' || file === 'biome.jsonc') {
      result.biome = true;
    }
    if (file === '.editorconfig') {
      result.editorconfig = true;
    }
  }

  return result;
}

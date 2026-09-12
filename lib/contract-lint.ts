import { AcceptanceCriterion, RepoInspectionResult } from '@/types';

export interface ObjectiveLint {
  ok: boolean;
  issues: string[];
  suggestions: string[];
  hasVerb: boolean;
  hasWhere: boolean;
  hasVerification: boolean;
}

const ACTION_VERBS = [
  'implement', 'add', 'create', 'fix', 'update', 'migrate', 'refactor',
  'remove', 'delete', 'enforce', 'return', 'handle', 'support', 'extend',
  'expose', 'validate', 'sanitize', 'throttle', 'limit', 'cache',
];

const VAGUE_TERMS = [
  'robust', 'clean', 'proper', 'appropriate', 'cleanly', 'nicely',
  'improve', 'improved', 'better', 'fast', 'fastly', 'quickly', 'efficiently',
  'should', 'would', 'could', 'maybe',
];

const VERIFICATION_HINTS = [
  'test', 'spec', 'http', '429', '200', '201', '400', '401', '403', '404',
  'header', 'status', 'throws', 'returns', 'verif', 'cover', 'assert',
  'rate', 'limit', 'expire', 'ttl',
];

export function lintObjective(objective: string): ObjectiveLint {
  const text = (objective || '').trim();
  const lower = text.toLowerCase();
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (text.length < 20) {
    issues.push('Objective is too short — aim for verb + object + where + how-verified (≥20 chars).');
    suggestions.push('Example: Implement IP sliding-window limiter in src/middleware/rate-limiter.ts verified by unit tests for burst + expiry.');
  }
  const hasVerb = ACTION_VERBS.some((v) => lower.startsWith(v) || lower.includes(` ${v} `) || lower.includes(v));
  if (!hasVerb) {
    issues.push('Start with an action verb (Implement, Add, Fix, Enforce, Return...).');
    suggestions.push('Start with e.g. “Implement …”, “Fix …”, “Enforce …”.');
  }
  const hasWhere = /src\/|app\/|lib\/|pkg\/|cmd\/|tests?\/|__tests__\/|middleware|route|component|service|api/i.test(text);
  if (!hasWhere) {
    issues.push('Name where the work lives (file, route, or module).');
    suggestions.push('Add e.g. “in src/middleware/rate-limiter.ts” or “on POST /api/...”.');
  }
  const hasVerification = VERIFICATION_HINTS.some((h) => lower.includes(h));
  if (!hasVerification) {
    issues.push('State how it is verified (test, HTTP code, behavior).');
    suggestions.push('Add e.g. “verified by unit tests for …” or “returns HTTP 429 with …”.');
  }
  const vagueHit = VAGUE_TERMS.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(text));
  if (vagueHit) {
    issues.push(`Avoid vague term “${vagueHit}” — Jules cannot verify it first try.`);
    suggestions.push('Replace with a measurable behavior, code path, or test name.');
  }
  return { ok: issues.length === 0, issues, suggestions, hasVerb, hasWhere, hasVerification };
}

export interface CriterionLintIssue {
  id: string;
  messages: string[];
}

export interface CriteriaLint {
  ok: boolean;
  issues: CriterionLintIssue[];
  global: string[];
  counts: Record<string, number>;
}

export function lintCriteria(criteria: AcceptanceCriterion[]): CriteriaLint {
  const issues: CriterionLintIssue[] = [];
  const global: string[] = [];
  const counts: Record<string, number> = { functional: 0, security: 0, testing: 0, constraint: 0 };

  if (!Array.isArray(criteria) || criteria.length === 0) {
    return { ok: false, issues, global: ['At least one acceptance criterion is required.'], counts };
  }
  if (criteria.length < 3) {
    global.push('Aim for 4–7 criteria: functional + testing + constraint minimum. Thin contracts cause guesswork.');
  }
  if (criteria.length > 8) {
    global.push('More than 8 criteria dilutes focus — Jules partial-completes. Split into two sessions.');
  }

  const seen = new Set<string>();
  for (const c of criteria) {
    const messages: string[] = [];
    const text = (c.text || '').trim();
    const lower = text.toLowerCase();
    const cat = (c.category || 'functional') as keyof typeof counts;
    if (cat in counts) counts[cat] += 1;

    if (text.length < 20) messages.push('Too short — name file/behavior + verification (≥20 chars).');
    const vague = VAGUE_TERMS.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(text));
    if (vague) messages.push(`Vague term “${vague}” is not falsifiable from a diff.`);
    // Constraint criteria like “Zero modifications to …” are verified by absence —
    // exempt the where/how-verified hint when the negative intent is explicit.
    const isNegativeConstraint =
      cat === 'constraint' && /zero|no .*modif|do not (touch|modify|add)|without|never/i.test(text);
    const hasVerify =
      isNegativeConstraint ||
      VERIFICATION_HINTS.some((h) => lower.includes(h)) ||
      /\d{3}/.test(text) ||
      /src\/|app\/|lib\/|tests?\/|__tests__|package\.json/i.test(text);
    if (!hasVerify) messages.push('Add where + how-verified (file, HTTP code, function, or test).');
    const key = lower.replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) messages.push('Duplicate/overlapping criterion — merge or split.');
    else seen.add(key);

    if (messages.length > 0) issues.push({ id: String(c.id || '?'), messages });
  }

  if ((counts.functional || 0) === 0) global.push('Missing functional criterion — Jules has no core behavior to build.');
  if ((counts.testing || 0) === 0) global.push('Missing testing criterion — first-pass PRs without tests fail audit.');
  if ((counts.constraint || 0) === 0) global.push('Missing constraint criterion — add “Zero modifications to …” to prevent drift.');

  return { ok: issues.length === 0 && global.length === 0, issues, global, counts };
}

export interface BoundaryCheck {
  boundary: string;
  existsInTree: boolean | null;
  matchCount: number;
}

function boundaryToPrefix(boundary: string): string {
  const b = (boundary || '').trim().replace(/^\.\//, '');
  // Take literal prefix before first wildcard for tree-existence check.
  const idx = b.search(/[*?[\]{}]/);
  const prefix = (idx === -1 ? b : b.slice(0, idx)).replace(/\/+$/, '');
  return prefix;
}

export function checkBoundariesAgainstTree(
  boundaries: string[],
  treePaths?: string[]
): BoundaryCheck[] {
  const tree = Array.isArray(treePaths) ? treePaths : [];
  return (boundaries || []).map((boundary) => {
    const b = (boundary || '').trim();
    if (!b) return { boundary: b, existsInTree: null, matchCount: 0 };
    if (tree.length === 0) return { boundary: b, existsInTree: null, matchCount: 0 };
    const prefix = boundaryToPrefix(b).toLowerCase();
    if (!prefix) return { boundary: b, existsInTree: true, matchCount: tree.length };
    const matches = tree.filter((p) => (p || '').toLowerCase().startsWith(prefix));
    // Also count exact file match.
    const exact = tree.some((p) => (p || '').toLowerCase() === prefix);
    return { boundary: b, existsInTree: matches.length > 0 || exact, matchCount: matches.length };
  });
}

export interface DispatchGate {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function preDispatchGate(input: {
  repo: string;
  objective: string;
  criteria: AcceptanceCriterion[];
  boundaries: string[];
  treePaths?: string[];
}): DispatchGate {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repo = (input.repo || '').trim();

  if (!repo.includes('/')) errors.push('Repository must be in "owner/repo" format.');
  const obj = lintObjective(input.objective || '');
  if ((input.objective || '').trim().length < 10) errors.push('Objective is required (≥10 chars).');
  else if (!obj.ok) warnings.push(...obj.issues);

  const crit = lintCriteria(input.criteria || []);
  if ((input.criteria || []).length === 0) errors.push('At least one acceptance criterion is required.');
  else {
    for (const iss of crit.issues) warnings.push(`Criterion ${iss.id}: ${iss.messages.join(' ')}`);
    warnings.push(...crit.global);
  }
  if ((input.boundaries || []).length === 0) {
    warnings.push('No file boundaries — Jules may drift. Add at least one glob like src/middleware/**.');
  } else {
    const checks = checkBoundariesAgainstTree(input.boundaries, input.treePaths);
    for (const ch of checks) {
      if (ch.existsInTree === false) {
        warnings.push(`Boundary “${ch.boundary}” matches 0 repo paths — likely a miss; verify before dispatch.`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Derives explicit DO-NOT paths present in this repo for prompt grounding. */
export function deriveDoNotTouchList(inspection?: Partial<RepoInspectionResult> | null): string[] {
  const out: string[] = [];
  const tree = (inspection?.treePreview || []).map((p) => (p || '').toLowerCase());
  const has = (name: string) => tree.some((p) => p === name.toLowerCase() || p.endsWith(`/${name.toLowerCase()}`));
  const pushIf = (cond: boolean, label: string) => {
    if (cond && !out.includes(label)) out.push(label);
  };
  pushIf(true, 'package.json');
  pushIf(has('package-lock.json') || true, 'package-lock.json');
  pushIf(true, 'yarn.lock / pnpm-lock.yaml / bun.lockb (whichever exists)');
  const keyFiles = inspection?.keyFiles;
  pushIf(!!keyFiles?.hasTsConfig || has('tsconfig.json'), 'tsconfig.json');
  pushIf(!!keyFiles?.hasDocker || has('Dockerfile'), 'Dockerfile / docker-compose.yml');
  pushIf(has('.env') || has('.env.local'), '.env* secrets');
  return out;
}

/** Picks 3–6 files Jules should read first: boundaries that exist + test/config neighbors. */
export function pickFilesToReadFirst(
  boundaries: string[],
  treePaths?: string[],
  cap = 6
): string[] {
  const tree = (Array.isArray(treePaths) ? treePaths : []).filter(Boolean);
  if (tree.length === 0) return [];
  const picks: string[] = [];
  const push = (p: string) => {
    if (picks.length >= cap || picks.includes(p)) return;
    picks.push(p);
  };
  // 1) Exact boundary files that exist.
  for (const b of boundaries || []) {
    const clean = (b || '').trim().replace(/^\.\//, '');
    if (!clean || /[*?[\]{}]/.test(clean)) continue;
    if (tree.includes(clean)) push(clean);
    if (picks.length >= cap) break;
  }
  // 2) Files under boundary prefixes (code first, tests second).
  const prefixes = (boundaries || [])
    .map(boundaryToPrefix)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  const candidates = tree.filter((p) => {
    const lp = p.toLowerCase();
    if (prefixes.length === 0) return true;
    return prefixes.some((pre) => lp.startsWith(pre));
  });
  const codeFirst = [...candidates].sort((a, b) => {
    const aTest = /(__tests__|tests?\/|spec\/|\.test\.|\.spec\.)/i.test(a) ? 1 : 0;
    const bTest = /(__tests__|tests?\/|spec\/|\.test\.|\.spec\.)/i.test(b) ? 1 : 0;
    return aTest - bTest;
  });
  for (const c of codeFirst) {
    push(c);
    if (picks.length >= cap) break;
  }
  // Fill remaining slots with sibling code-first paths so an exact-file boundary
  // still grounds Jules with neighbor context instead of a single file.
  if (picks.length < cap) {
    const rest = [...tree].sort((a, b) => {
      const aTest = /(__tests__|tests?\/|spec\/|\.test\.|\.spec\.)/i.test(a) ? 1 : 0;
      const bTest = /(__tests__|tests?\/|spec\/|\.test\.|\.spec\.)/i.test(b) ? 1 : 0;
      return aTest - bTest;
    });
    for (const c of rest) {
      push(c);
      if (picks.length >= cap) break;
    }
  }
  return picks;
}

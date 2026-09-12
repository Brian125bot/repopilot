import { AcceptanceCriterion } from '@/types';

export interface Stage1ContractFields {
  repo: string;
  objective: string;
  criteria: AcceptanceCriterion[];
  baseBranch: string;
  branchName: string;
  fileBoundaries: string;
}

/** First-run Stage 1 fields: empty until the user types or loads the sample. */
export function emptyStage1Defaults(): Stage1ContractFields {
  return {
    repo: '',
    objective: '',
    criteria: [],
    baseBranch: '',
    branchName: '',
    fileBoundaries: '',
  };
}

/** Rate-limiter sample used only by the explicit Load sample action. */
export const SAMPLE_RATE_LIMITER_CONTRACT: Stage1ContractFields = {
  repo: 'acme-corp/api-gateway',
  objective:
    'Implement an IP-based sliding window rate limiter middleware backed by Redis. Return HTTP 429 with standard RateLimit-* headers when threshold (60 req/min) is exceeded.',
  criteria: [
    {
      id: '1',
      text: 'Middleware extracts client IP correctly with support for X-Forwarded-For',
      category: 'functional',
      rationale: 'Required for reverse-proxy routing',
    },
    {
      id: '2',
      text: 'Sliding window algorithm enforces 60 requests per minute ceiling',
      category: 'functional',
      rationale: 'Prevents burst window exploitation',
    },
    {
      id: '3',
      text: 'Returns HTTP 429 Too Many Requests with RateLimit-Limit, RateLimit-Remaining, and Retry-After headers',
      category: 'functional',
      rationale: 'Standard IETF rate-limit header compliance',
    },
    {
      id: '4',
      text: 'Unit tests cover under-limit, burst limit, and window expiry states',
      category: 'testing',
      rationale: 'Ensures algorithmic reliability under concurrency',
    },
    {
      id: '5',
      text: 'Zero modifications to package.json dependencies or existing unrelated route handlers',
      category: 'constraint',
      rationale: 'Strict anti-drift boundary compliance',
    },
  ],
  baseBranch: 'main',
  branchName: 'jules/rate-limiter-redis',
  fileBoundaries:
    'src/middleware/rate-limiter.ts, src/config/redis.ts, tests/rate-limiter.test.ts',
};

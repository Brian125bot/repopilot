import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAcceptanceCriteria, evaluateDiffAgainstCriteria } from '@/lib/gemini';
import { GoogleGenAI } from '@google/genai';

vi.mock('@google/genai', async () => {
  const actual = await vi.importActual('@google/genai');
  return {
    ...actual,
    GoogleGenAI: vi.fn(),
  };
});

describe('lib/gemini.ts Business Logic', () => {
  let generateContentMock: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';

    generateContentMock = vi.fn();
    (GoogleGenAI as any).mockImplementation(function() {
      return {
        models: {
          generateContent: generateContentMock,
        },
      };
    });
  });

  describe('generateAcceptanceCriteria', () => {
    it('successfully parses valid LLM generated JSON', async () => {
      const mockResult = {
        criteria: [{ id: '1', text: 'Validate input', category: 'security', rationale: 'Secure' }],
        recommendedFileBoundaries: ['src/app/**'],
        suggestedBranchName: 'jules/feature',
        summaryRationale: 'Summary',
        detectedArchitecture: 'Next.js',
      };
      generateContentMock.mockResolvedValue({ text: JSON.stringify(mockResult) });

      const result = await generateAcceptanceCriteria({ repo: 'owner/repo', objective: 'Do it' });

      expect(result).toEqual(mockResult);
      expect(generateContentMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.8-flash' }));
    });

    it('throws error when Gemini returns empty text', async () => {
      generateContentMock.mockResolvedValue({ text: '' });

      await expect(
        generateAcceptanceCriteria({ repo: 'owner/repo', objective: 'Do it' })
      ).rejects.toThrow('Gemini API returned an empty criteria response.');
    });

    it('throws when GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;

      await expect(
        generateAcceptanceCriteria({ repo: 'owner/repo', objective: 'Do it' })
      ).rejects.toThrow('GEMINI_API_KEY is not configured');
    });
  });

  describe('evaluateDiffAgainstCriteria', () => {
    it('successfully evaluates and parses valid structured output', async () => {
      const mockReport = {
        criteriaResults: [{ id: '1', criterion: 'Check', status: 'MET', evidence: 'Yes', lineReferences: [] }],
        scopeIntegrity: { strictlyInScope: true, unauthorizedFiles: [], explanation: 'Clean' },
        blastRadius: { rating: 'LOW', explanation: 'Small' },
        mergeVerdict: { status: 'READY_TO_MERGE', overallScore: 100, keyBlockers: [], actionableFeedbackForAgent: 'None' },
      };

      generateContentMock.mockResolvedValue({ text: JSON.stringify(mockReport) });

      const result = await evaluateDiffAgainstCriteria({
        diff: 'diff --git a/a b/a',
        criteria: [{ id: '1', text: 'Check', category: 'functional' }],
        unauthorizedPaths: [],
      });

      expect(result.mergeVerdict.status).toBe('READY_TO_MERGE');
      expect(result.evaluatedAt).toBeDefined();
    });

    it('throws when Gemini returns empty text in audit response', async () => {
      generateContentMock.mockResolvedValue({ text: '' });

      await expect(
        evaluateDiffAgainstCriteria({ diff: 'a', criteria: [], unauthorizedPaths: [] })
      ).rejects.toThrow('Gemini API returned an empty evaluation response.');
    });

    it('bubbles up generic network throws from models.generateContent', async () => {
      generateContentMock.mockRejectedValue(new Error('LLM connection reset'));

      await expect(
        evaluateDiffAgainstCriteria({ diff: 'a', criteria: [], unauthorizedPaths: [] })
      ).rejects.toThrow('LLM connection reset');
    });
  });
});

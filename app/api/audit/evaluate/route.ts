import { NextRequest, NextResponse } from 'next/server';
import { evaluateDiffAgainstCriteria } from '@/lib/gemini';
import { AcceptanceCriterion } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { diff, criteria, objective, fileBoundaries, prMetadata } = body;

    if (!diff || typeof diff !== 'string' || diff.trim().length === 0) {
      return NextResponse.json(
        { error: 'Cannot evaluate empty diff. Please provide a valid sanitized diff.' },
        { status: 400 }
      );
    }

    if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
      return NextResponse.json(
        { error: 'Acceptance criteria matrix is required for audit evaluation.' },
        { status: 400 }
      );
    }

    const headerGeminiKey = req.headers.get('x-gemini-api-key');
    const customApiKey = headerGeminiKey || undefined;

    const report = await evaluateDiffAgainstCriteria({
      diff,
      criteria: criteria as AcceptanceCriterion[],
      objective,
      fileBoundaries,
      customApiKey,
    });

    // Attach PR context if available
    if (prMetadata) {
      report.prTitle = prMetadata.title;
      report.prAuthor = prMetadata.author;
      report.prNumber = prMetadata.number;
      report.prUrl = prMetadata.htmlUrl;
      report.baseBranch = prMetadata.baseBranch;
      report.headBranch = prMetadata.headBranch;
    }

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('Error in /api/audit/evaluate:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Evaluation failed. Please verify GEMINI_API_KEY.',
      },
      { status: 500 }
    );
  }
}

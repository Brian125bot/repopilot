import { NextRequest, NextResponse } from 'next/server';
import { generateAcceptanceCriteria } from '@/lib/gemini';
import { RepoInspectionResult } from '@/types';

interface CriteriaRequestBody {
  repo: string;
  objective: string;
  repoContext?: Partial<RepoInspectionResult>;
  mode?: 'standard' | 'security' | 'testing' | 'strict';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CriteriaRequestBody;
    const { repo, objective, repoContext, mode = 'standard' } = body;

    if (!repo || !repo.includes('/')) {
      return NextResponse.json(
        { error: 'Valid repository in "owner/repo" format is required.' },
        { status: 400 }
      );
    }

    if (!objective || objective.trim().length < 10) {
      return NextResponse.json(
        { error: 'Please provide a descriptive task objective (at least 10 characters) to establish criteria.' },
        { status: 400 }
      );
    }

    const customApiKey = req.headers.get('x-gemini-api-key') || undefined;

    const result = await generateAcceptanceCriteria({
      repo: repo.trim(),
      objective: objective.trim(),
      repoContext,
      mode,
      customApiKey,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    console.error('Error generating acceptance criteria:', err);
    return NextResponse.json(
      {
        error: err.message || 'Failed to generate acceptance criteria via Gemini.',
      },
      { status: 500 }
    );
  }
}

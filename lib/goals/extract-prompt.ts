import type { RepoProfile } from '../types/steering';

export function buildGoalExtractionPrompt(rawText: string, repoProfile?: RepoProfile): string {
  let contextSection = '';
  if (repoProfile) {
    const { stack, conventions } = repoProfile;
    const languagesStr = stack?.languages?.join(', ') || 'Not specified';
    const pmStr = stack?.packageManager || 'npm';
    const fwStr = stack?.framework || 'None';
    const trStr = stack?.testRunner || 'vitest / jest';

    let conventionsStr = 'None';
    if (conventions && conventions.length > 0) {
      conventionsStr = conventions.map((c) => `- ${c.title}: ${c.body}`).join('\n');
    }

    contextSection = `
REPOSITORY CONTEXT & CONVENTIONS:
- Primary Languages: ${languagesStr}
- Package Manager: ${pmStr}
- Framework: ${fwStr}
- Test Runner: ${trStr}
- Project Conventions:
${conventionsStr}
`;
  }

  return `You are an expert software engineering lead extracting structured task goals from freeform operator instructions.
Analyze the following operator task description and convert it into a structured JSON object.

${contextSection}
OPERATOR TASK DESCRIPTION:
"""
${rawText}
"""

INSTRUCTIONS:
1. Extract the primary title summary (short, descriptive, e.g. "Add empty-scan save guard").
2. Identify the expected scope of file boundaries or components to be modified (e.g. "lib/goals/storage.ts, app/api/goal/extract/route.ts").
3. Generate a list of clear, verifiable acceptance criteria. If repository context/test runner is provided above, incorporate relevant project commands or paths into criteria (e.g. "npm test lib/goals/storage.test.ts passes").
4. Identify any explicit or implied technical assumptions.
5. Highlight any ambiguities, missing details, or risks in "ambiguityFlags".
6. CRITICAL: If the task description is extremely vague, un-actionable, or empty, set title to "UNCLEAR" and explain the missing details in ambiguityFlags.

Your output MUST be a valid JSON object matching this schema:
{
  "title": string,
  "scope": string,
  "acceptanceCriteria": string[],
  "assumptions": string[],
  "ambiguityFlags": string[]
}
`;
}

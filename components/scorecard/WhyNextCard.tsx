'use client';

import * as React from 'react';
import type { AuditGrade } from '@/types';
import { nextDecisionSentence } from '@/lib/scoring';

interface WhyNextCardProps {
  grade: AuditGrade;
  auditedBranch: string;
}

export function WhyNextCard({ grade, auditedBranch }: WhyNextCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Why this grade
      </div>
      <ul className="space-y-1">
        {grade.why.map((line) => (
          <li key={line} className="text-xs text-slate-700 leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
      <p className="text-xs font-semibold text-slate-900 pt-1">
        Next: {nextDecisionSentence(grade.nextDecision, auditedBranch)}
      </p>
      {grade.diffFacts?.truncated ? (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
          Diff was truncated to {grade.diffFacts.shownChars?.toLocaleString()} chars for the
          model. Risk and missing-criteria calls may be understated — fetch the full diff
          before merging on a borderline score.
        </p>
      ) : null}
    </div>
  );
}

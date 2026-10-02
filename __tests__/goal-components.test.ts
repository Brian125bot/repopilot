import { describe, it, expect } from 'vitest';
import React from 'react';
import { GoalRawInput } from '@/components/JulesSession/GoalRawInput';
import { GoalExtractedEditor } from '@/components/JulesSession/GoalExtractedEditor';
import { StartSessionModal } from '@/components/JulesSession/StartSessionModal';
import type { GoalExtracted } from '@/lib/goals/types';

describe('Goal UI Components (Node Environment)', () => {
  it('exports valid GoalRawInput component', () => {
    expect(typeof GoalRawInput).toBe('function');
    const element = React.createElement(GoalRawInput, {
      rawText: 'Test requirement',
      setRawText: () => {},
      onExtract: () => {},
      onSkip: () => {},
      isExtracting: false,
    });
    expect(element.type).toBe(GoalRawInput);
  });

  it('exports valid GoalExtractedEditor component', () => {
    expect(typeof GoalExtractedEditor).toBe('function');
    const sampleExtracted: GoalExtracted = {
      title: 'Fix issue',
      scope: 'src/index.ts',
      acceptanceCriteria: ['Tests pass'],
      assumptions: [],
      ambiguityFlags: [],
    };
    const element = React.createElement(GoalExtractedEditor, {
      extracted: sampleExtracted,
      onChange: () => {},
      onBack: () => {},
      onConfirm: () => {},
      onSkip: () => {},
    });
    expect(element.type).toBe(GoalExtractedEditor);
  });

  it('exports valid StartSessionModal component', () => {
    expect(typeof StartSessionModal).toBe('function');
    const element = React.createElement(StartSessionModal, {
      isOpen: true,
      onClose: () => {},
      repo: 'owner/repo',
      onConfirmAndDispatch: () => {},
    });
    expect(element.type).toBe(StartSessionModal);
  });
});

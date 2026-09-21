import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { GoalRawInput } from './GoalRawInput';
import { GoalExtractedEditor } from './GoalExtractedEditor';
import { StartSessionModal } from './StartSessionModal';
import { GoalExtracted } from '@/lib/goals/types';

describe('Goal UI Components', () => {
  describe('GoalRawInput Component', () => {
    it('creates a React element with expected props', () => {
      const handleExtract = vi.fn().mockResolvedValue(undefined);
      const handleSkip = vi.fn();

      const element = React.createElement(GoalRawInput, {
        initialText: 'Add /healthz endpoint',
        onExtract: handleExtract,
        onSkip: handleSkip,
        isExtracting: false,
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(GoalRawInput);
      expect(element.props.initialText).toBe('Add /healthz endpoint');
      expect(element.props.isExtracting).toBe(false);
    });
  });

  describe('GoalExtractedEditor Component', () => {
    it('creates a React element with GoalExtracted props', () => {
      const mockExtracted: GoalExtracted = {
        title: 'Add /healthz endpoint',
        scope: ['api/health'],
        acceptanceCriteria: ['Returns 200 ok'],
        assumptions: ['Standard JSON output'],
        ambiguityFlags: [],
      };

      const handleConfirm = vi.fn();
      const handleBack = vi.fn();

      const element = React.createElement(GoalExtractedEditor, {
        extracted: mockExtracted,
        rawText: 'Add healthz',
        onConfirm: handleConfirm,
        onBack: handleBack,
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(GoalExtractedEditor);
      expect(element.props.extracted.title).toBe('Add /healthz endpoint');
      expect(element.props.extracted.scope).toEqual(['api/health']);
    });
  });

  describe('StartSessionModal Component', () => {
    it('creates a React element with modal props', () => {
      const handleConfirm = vi.fn();
      const handleCancel = vi.fn();

      const element = React.createElement(StartSessionModal, {
        isOpen: true,
        sessionId: 'session_test_123',
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      });

      expect(element).toBeDefined();
      expect(element.type).toBe(StartSessionModal);
      expect(element.props.isOpen).toBe(true);
      expect(element.props.sessionId).toBe('session_test_123');
    });
  });
});

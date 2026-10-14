import { describe, expect, it } from 'vitest';
import { describeSessionStage, inferSessionStage } from './state';

describe('inferSessionStage', () => {
  describe('structured session states', () => {
    it('infers plan_review from planning states', () => {
      for (const state of ['CREATED', 'PLANNING', 'AWAITING_APPROVAL', 'PLAN_REVIEW']) {
        expect(inferSessionStage({ sessionState: state })).toBe('plan_review');
      }
    });

    it('infers mid_execution from execution states', () => {
      for (const state of ['EXECUTING', 'RUNNING', 'CODING', 'QUEUED', 'IN_PROGRESS']) {
        expect(inferSessionStage({ sessionState: state })).toBe('mid_execution');
      }
    });

    it('infers pre_pr from PR-preparation states', () => {
      for (const state of ['PR_CREATION', 'PREPARING_PR', 'SUMMARIZING']) {
        expect(inferSessionStage({ sessionState: state })).toBe('pre_pr');
      }
    });

    it('infers post_pr from completion states', () => {
      for (const state of ['COMPLETED', 'PR_CREATED', 'PR_OPEN', 'PR_MERGED', 'MERGED']) {
        expect(inferSessionStage({ sessionState: state })).toBe('post_pr');
      }
    });

    it('matches state strings case-insensitively and tolerates whitespace', () => {
      expect(inferSessionStage({ sessionState: '  executing ' })).toBe('mid_execution');
      expect(inferSessionStage({ sessionState: 'Awaiting_Approval' })).toBe('plan_review');
    });

    it('returns unknown for terminal failure states', () => {
      for (const state of ['FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'ERROR', 'REJECTED']) {
        expect(inferSessionStage({ sessionState: state })).toBe('unknown');
      }
    });

    it('returns unknown for an unrecognized state with no message', () => {
      expect(inferSessionStage({ sessionState: 'SOME_FUTURE_STATE' })).toBe('unknown');
    });
  });

  describe('unstructured message patterns', () => {
    it('infers plan_review from plan and proposal phrasing', () => {
      expect(
        inferSessionStage({
          latestMessage: "Here's my plan: I will add a caching layer before we start.",
        })
      ).toBe('plan_review');
      expect(
        inferSessionStage({ latestMessage: 'I propose we refactor the parser.' })
      ).toBe('plan_review');
      expect(
        inferSessionStage({ latestMessage: 'My approach outlines three steps.' })
      ).toBe('plan_review');
    });

    it('infers mid_execution from edit and test phrasing', () => {
      expect(
        inferSessionStage({ latestMessage: 'Running the test suite now.' })
      ).toBe('mid_execution');
      expect(
        inferSessionStage({ latestMessage: 'I am implementing the fix and editing the parser.' })
      ).toBe('mid_execution');
      expect(
        inferSessionStage({ latestMessage: 'Tests are failing in lint.' })
      ).toBe('mid_execution');
    });

    it('infers pre_pr from PR-preparation phrasing', () => {
      expect(
        inferSessionStage({
          latestMessage: 'I am preparing the pull request description now.',
        })
      ).toBe('pre_pr');
      expect(
        inferSessionStage({ latestMessage: 'Summarizing the changes for the diff.' })
      ).toBe('pre_pr');
      expect(
        inferSessionStage({ latestMessage: 'Pushing the commits to the branch.' })
      ).toBe('pre_pr');
    });

    it('infers post_pr from PR-created and review phrasing', () => {
      expect(
        inferSessionStage({
          latestMessage: 'The pull request was created and is ready for review.',
        })
      ).toBe('post_pr');
      expect(
        inferSessionStage({ latestMessage: 'CI checks are running on the PR.' })
      ).toBe('post_pr');
      expect(
        inferSessionStage({ latestMessage: 'Awaiting review from the team.' })
      ).toBe('post_pr');
    });
  });

  describe('precedence and fallbacks', () => {
    it('a harvested PR URL always means post_pr', () => {
      expect(
        inferSessionStage({
          prUrl: 'https://github.com/acme-corp/api-gateway/pull/42',
          sessionState: 'EXECUTING',
          latestMessage: 'Running tests…',
        })
      ).toBe('post_pr');
    });

    it('the structured state wins over contradictory message text', () => {
      expect(
        inferSessionStage({
          sessionState: 'PLANNING',
          latestMessage: 'Running the test suite right now.',
        })
      ).toBe('plan_review');
    });

    it('falls back to message patterns when the state is unrecognized', () => {
      expect(
        inferSessionStage({
          sessionState: 'SOME_FUTURE_STATE',
          latestMessage: "Here's my plan for the change.",
        })
      ).toBe('plan_review');
    });

    it('returns unknown when only unstructured text that matches nothing is available', () => {
      expect(inferSessionStage({ latestMessage: 'ok' })).toBe('unknown');
      expect(inferSessionStage({ latestMessage: '' })).toBe('unknown');
    });

    it('returns unknown for empty input', () => {
      expect(inferSessionStage()).toBe('unknown');
      expect(inferSessionStage({})).toBe('unknown');
      expect(inferSessionStage({ latestMessage: null, sessionState: null, prUrl: null })).toBe(
        'unknown'
      );
    });
  });

  describe('determinism', () => {
    it('returns the same stage for repeated calls with identical input', () => {
      const input = {
        latestMessage: 'Running the test suite and fixing the failing lint check.',
        sessionState: null,
        prUrl: null,
      };
      const first = inferSessionStage(input);
      for (let i = 0; i < 5; i += 1) {
        expect(inferSessionStage(input)).toBe(first);
      }
      expect(first).toBe('mid_execution');
    });
  });

  describe('describeSessionStage', () => {
    it('labels every stage', () => {
      expect(describeSessionStage('plan_review')).toBe('plan review');
      expect(describeSessionStage('mid_execution')).toBe('mid execution');
      expect(describeSessionStage('pre_pr')).toBe('pre-PR');
      expect(describeSessionStage('post_pr')).toBe('post-PR');
      expect(describeSessionStage('unknown')).toBe('unknown stage');
    });
  });
});

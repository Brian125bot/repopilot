'use client';

import * as React from 'react';
import { GitBranch, KeyRound, Unlock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponseEditor } from '@/components/JulesSession/ResponseEditor';
import { SnippetBar } from '@/components/JulesSession/SnippetBar';
import {
  buildCitations,
  type CitationReason,
} from '@/lib/snippets/citations';
import { getBuiltinSnippets } from '@/lib/snippets/builtin-loader';
import { rankSnippets, type ScoredSnippet } from '@/lib/snippets/ranking';
import {
  describeSessionStage,
  inferSessionStage,
} from '@/lib/snippets/state';
import {
  sendInteractiveTurn,
  snippetSendMode,
  startNewSessionTurn,
  type HeadFreshnessResult,
} from '@/lib/sessions/send';
import type {
  RepoProfile,
  Snippet,
} from '@/lib/types/steering';
import {
  indexedDbSteeringStore,
  type SteeringStore,
} from '@/lib/vault/steering-store';
import type { Blueprint, FailureBrief } from '@/types';

export interface JulesFollowUpPanelProps {
  /** Active session blueprint. Read-only: Send never rebinds it. */
  blueprint: Blueprint;
  /** Latest failure brief, input to the continuation compiler. */
  brief: FailureBrief;
  /**
   * Latest Jules output text (audit findings, session
   * message, or continuation brief) — the corpus the
   * ranking engine matches snippets against.
   */
  latestMessage: string;
  /** Client-side Jules API key; sent only as a header, never stored. */
  julesApiKey: string;
  /** Audited PR repo (`owner/name`), the scorecard's `cleanRepo`. */
  repo: string;
  /**
   * Audited PR head branch (`prMetadata.headBranch`). Empty when PR
   * metadata is missing, which disables Send.
   */
  targetBranch: string;
  /** Audited PR base branch (`prMetadata.baseBranch`). */
  baseBranch?: string;
  /** Audited PR number (`prMetadata.number`). */
  prNumber?: number;
  /** Audited PR URL, forwarded to the message route. */
  prUrl?: string;
  /** Audited head SHA known to the scorecard (new-session metadata check). */
  auditedHeadSha?: string | null;
  /** Current session, from `resolveContinueSessionId`. */
  sessionId: string | null;
  /**
   * `shouldOfferContinueSession` result. When false and the audited
   * PR is fully known, the panel offers a separate, explicit
   * "Start new Jules session" button instead of Send.
   */
  canContinue: boolean;
  /** Parent policy gate (verified API key, vault lock). */
  requireVerifiedKey: () => boolean;
  /** COR-40 freshness gate, run after the key gate on every Send. */
  checkHeadFreshness: () => Promise<HeadFreshnessResult>;
  /** Called after a reply lands in the current session. */
  onSent: (sent: {
    sessionId: string;
    auditedHeadSha: string;
    snippetId: string | null;
  }) => void;
  /** Called after the explicit fallback started a new session. */
  onNewSessionStarted: (started: {
    sessionId: string;
    sessionUrl: string | null;
    blueprint: Blueprint;
    snippetId: string | null;
  }) => void;
}

/**
 * COR-59 interactive turn panel for an active Jules
 * session.
 *
 * Ranks the snippet library (built-ins plus decrypted
 * vault customs) against the latest Jules output, the
 * ingested goal criteria, and the inferred session
 * stage; renders the snippet bar directly beneath the
 * output; and replies in the CURRENT Jules session via
 * `/api/jules/message`, locked to the audited PR branch
 * and head SHA. It never starts a new session.
 *
 * Operator-in-the-loop: selecting a card only populates
 * the editor. Nothing sends until the explicit Send
 * button is clicked.
 */
export function JulesFollowUpPanel({
  blueprint,
  brief,
  latestMessage,
  julesApiKey,
  repo,
  targetBranch,
  baseBranch,
  prNumber,
  prUrl,
  auditedHeadSha,
  sessionId,
  canContinue,
  requireVerifiedKey,
  checkHeadFreshness,
  onSent,
  onNewSessionStarted,
}: JulesFollowUpPanelProps) {
  // Snippet library: built-ins are always readable;
  // vault customs require the operator's passphrase.
  const [snippets, setSnippets] = React.useState<Snippet[]>(
    () => getBuiltinSnippets()
  );
  const [passphrase, setPassphrase] = React.useState('');
  const [isUnlocked, setIsUnlocked] = React.useState(false);
  const [unlockError, setUnlockError] = React.useState<string | null>(
    null
  );
  const [repoProfile, setRepoProfile] = React.useState<
    RepoProfile | undefined
  >(undefined);

  // Turn composition state.
  const [selectedSnippetId, setSelectedSnippetId] = React.useState<
    string | null
  >(null);
  const [editorValue, setEditorValue] = React.useState('');
  const [isSending, setIsSending] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<{
    ok: boolean;
    newSession?: boolean;
    sessionId?: string;
    sessionUrl?: string;
    error?: string;
  } | null>(null);

  const goalCriteria = React.useMemo(
    () => (blueprint.criteria ?? []).map((criterion) => criterion.text),
    [blueprint.criteria]
  );

  const stage = React.useMemo(
    () =>
      inferSessionStage({
        latestMessage,
        sessionState: blueprint.sessionState,
        prUrl: blueprint.prUrl,
      }),
    [latestMessage, blueprint.sessionState, blueprint.prUrl]
  );

  const suggestions = React.useMemo(
    () =>
      rankSnippets(snippets, {
        latestMessage,
        goalCriteria,
        stage,
      }),
    [snippets, latestMessage, goalCriteria, stage]
  );

  const usageCounts = React.useMemo(
    () => new Map(snippets.map((snippet) => [snippet.id, snippet.usageCount])),
    [snippets]
  );

  const citationsBySnippetId = React.useMemo(() => {
    const map = new Map<string, CitationReason[]>();
    for (const { snippet } of suggestions) {
      map.set(
        snippet.id,
        buildCitations(snippet, {
          latestMessage,
          goalCriteria,
          stage,
          repoProfile,
          usageCounts,
        })
      );
    }
    return map;
  }, [
    suggestions,
    latestMessage,
    goalCriteria,
    stage,
    repoProfile,
    usageCounts,
  ]);

  const handleUnlock = async () => {
    const trimmed = passphrase.trim();
    if (!trimmed) return;
    setUnlockError(null);
    try {
      const store: SteeringStore = indexedDbSteeringStore();
      store.unlock(trimmed);
      // listSnippets skips records the passphrase cannot
      // decrypt rather than throwing, so a wrong passphrase
      // shows only the built-ins plus any readable customs.
      const unlocked = await store.listSnippets();
      setSnippets(mergeWithBuiltins(unlocked));
      // Repo conventions ground the citations; the
      // profile is optional and simply omitted when
      // absent (fail-soft).
      setRepoProfile((await store.getRepoProfile(repo)) ?? undefined);
      setIsUnlocked(true);
      // Do not keep the vault passphrase in React state.
      setPassphrase('');
    } catch (err: unknown) {
      setIsUnlocked(false);
      setRepoProfile(undefined);
      setSnippets(getBuiltinSnippets());
      setUnlockError(
        err instanceof Error
          ? err.message
          : 'Could not unlock the snippet vault.'
      );
    }
  };

  const handleSelectSnippet = (snippet: Snippet) => {
    // Operator-in-the-loop: selection only populates the
    // editor. There is no auto-send path here.
    setSelectedSnippetId(snippet.id);
    setEditorValue(snippet.content);
    setSendResult(null);
  };

  // In-memory only: the send path never writes to the vault.
  const recordUsage = (snippetId: string) => {
    setSnippets((current) =>
      current.map((snippet) =>
        snippet.id === snippetId
          ? { ...snippet, usageCount: (snippet.usageCount ?? 0) + 1 }
          : snippet
      )
    );
  };

  const mode = snippetSendMode({
    canContinue,
    sessionId,
    repo,
    targetBranch,
    baseBranch,
    prNumber,
    auditedHeadSha,
  });
  const sendDisabledReason = mode.kind === 'blocked' ? mode.reason : null;


  const handleSend = async (value: string) => {
    const directive = value.trim();
    if (!directive || isSending || mode.kind !== 'continue') return;
    setIsSending(true);
    setSendResult(null);
    try {
      const result = await sendInteractiveTurn({
        blueprint,
        brief,
        directive,
        julesApiKey,
        targetBranch,
        sessionId,
        canContinue,
        requireVerifiedKey,
        checkHeadFreshness,
        prUrl,
      });
      if (result.ok && result.sessionId && result.auditedHeadSha) {
        if (selectedSnippetId) recordUsage(selectedSnippetId);
        onSent({
          sessionId: result.sessionId,
          auditedHeadSha: result.auditedHeadSha,
          snippetId: selectedSnippetId,
        });
        setSelectedSnippetId(null);
        setEditorValue('');
        setSendResult({
          ok: true,
          sessionId: result.sessionId,
          sessionUrl: result.sessionUrl,
        });
      } else {
        setSendResult({ ok: false, error: result.error });
      }
    } catch (err: unknown) {
      setSendResult({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'The reply could not be sent.',
      });
    } finally {
      setIsSending(false);
    }
  };

  // Explicit-click fallback only: never reached from Send or selection.
  const handleStartNewSession = async (value: string) => {
    const directive = value.trim();
    if (!directive || isSending || mode.kind !== 'start-new') return;
    setIsSending(true);
    setSendResult(null);
    try {
      const result = await startNewSessionTurn({
        blueprint,
        brief,
        directive,
        julesApiKey,
        repo,
        targetBranch,
        baseBranch,
        prNumber,
        prUrl,
        auditedHeadSha,
        requireVerifiedKey,
        checkHeadFreshness,
      });
      if (result.ok && result.sessionId && result.blueprint) {
        if (selectedSnippetId) recordUsage(selectedSnippetId);
        onNewSessionStarted({
          sessionId: result.sessionId,
          sessionUrl: result.sessionUrl ?? null,
          blueprint: result.blueprint,
          snippetId: selectedSnippetId,
        });
        setSelectedSnippetId(null);
        setEditorValue('');
        setSendResult({
          ok: true,
          newSession: true,
          sessionId: result.sessionId,
          sessionUrl: result.sessionUrl ?? undefined,
        });
      } else {
        setSendResult({ ok: false, error: result.error });
      }
    } catch (err: unknown) {
      setSendResult({
        ok: false,
        error: err instanceof Error ? err.message : 'The session could not be started.',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-[11px] font-semibold text-slate-300">
            Suggested turn
          </span>
          <Badge
            variant="outline"
            className="border-slate-600 text-[10px] text-slate-400"
          >
            {describeSessionStage(stage)}
          </Badge>
        </div>
        {isUnlocked ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <Unlock className="h-3 w-3" />
            Vault snippets loaded
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleUnlock();
              }}
              placeholder="Vault passphrase for custom snippets"
              aria-label="Vault passphrase for custom snippets"
              className="h-7 w-48 text-[11px] bg-black/40 border-white/10 text-slate-100 placeholder:text-slate-500"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleUnlock()}
              disabled={!passphrase.trim()}
              className="h-7 text-[11px] border-slate-600 text-slate-300 hover:bg-white/10 gap-1"
            >
              <KeyRound className="h-3 w-3" />
              Unlock
            </Button>
          </div>
        )}
      </div>

      {mode.kind === 'continue' && (
        <p className="text-[11px] text-slate-400">
          Replies in the current Jules session{' '}
          <code className="font-mono text-slate-300">{sessionId}</code> on{' '}
          <code className="font-mono text-slate-300">{targetBranch}</code>
          {prNumber !== undefined ? ` (PR #${prNumber}` : ''}
          {prNumber !== undefined && baseBranch ? ` → ${baseBranch}` : ''}
          {prNumber !== undefined ? ')' : ''}. No new session is started.
        </p>
      )}

      {unlockError && (
        <p className="text-[11px] text-rose-300">{unlockError}</p>
      )}

      <SnippetBar
        suggestions={suggestions}
        citationsBySnippetId={citationsBySnippetId}
        onSelect={handleSelectSnippet}
        selectedSnippetId={selectedSnippetId}
      />

      <ResponseEditor
        value={editorValue}
        onChange={(value) => {
          setEditorValue(value);
          setSendResult(null);
        }}
        onSend={(value) => void handleSend(value)}
        isSending={isSending}
        disabled={mode.kind !== 'continue'}
        allowEditWhenDisabled={mode.kind === 'start-new'}
        placeholder="Reply to Jules, or pick a suggested snippet above…"
      />

      {mode.kind === 'start-new' && (
        <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-950/30 p-2.5">
          <p className="text-[11px] text-amber-200">
            The previous session has ended. This starts a new session on{' '}
            <code className="font-mono">{targetBranch}</code>.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleStartNewSession(editorValue)}
            disabled={isSending || !editorValue.trim()}
            className="h-7 text-[11px] border-amber-500/60 text-amber-100 hover:bg-amber-500/10"
          >
            {isSending ? 'Starting…' : 'Start new Jules session'}
          </Button>
        </div>
      )}

      {sendDisabledReason && (
        <p className="text-[11px] text-amber-300">{sendDisabledReason}</p>
      )}

      {sendResult && sendResult.ok && (
        <p className="text-[11px] text-emerald-300">
          {sendResult.newSession
            ? 'Started a new Jules session'
            : 'Sent to the current Jules session'}
          {sendResult.sessionUrl ? (
            <>
              {' — '}
              <a
                href={sendResult.sessionUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                open session
              </a>
            </>
          ) : null}
        </p>
      )}
      {sendResult && !sendResult.ok && (
        <p className="rounded-md border border-rose-500/40 bg-rose-950/50 p-2.5 text-[11px] text-rose-100 leading-relaxed">
          {sendResult.error}
        </p>
      )}
    </div>
  );
}

/** Built-ins plus vault customs, deduplicated by id (vault wins). */
function mergeWithBuiltins(custom: Snippet[]): Snippet[] {
  const byId = new Map<string, Snippet>();
  for (const snippet of getBuiltinSnippets()) byId.set(snippet.id, snippet);
  for (const snippet of custom) byId.set(snippet.id, snippet);
  return [...byId.values()];
}

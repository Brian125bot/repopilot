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
import { sendInteractiveTurn } from '@/lib/sessions/send';
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
  /**
   * Active session blueprint. `auditedHeadSha` locks the
   * continuation (COR-40); a blueprint without it cannot
   * send a turn.
   */
  blueprint: Blueprint;
  /** Latest failure brief, input to the continuation compiler. */
  brief: FailureBrief;
  /**
   * Latest Jules output text (audit findings, session
   * message, or continuation brief) — the corpus the
   * ranking engine matches snippets against.
   */
  latestMessage: string;
  /** Client-side Jules API key; never stored. */
  julesApiKey: string;
  /**
   * COR-40 lock: live PR head SHA. The dispatch route
   * rejects the turn unless it equals the audited SHA.
   */
  currentHeadSha: string;
  /**
   * COR-40 freshness gate, run before every dispatch
   * (same contract as the scorecard's remediation
   * flows). A failure aborts the turn with the gate's
   * error. When provided, the freshly resolved live
   * SHA is used as the continuation lock.
   */
  checkHeadFreshness?: () => Promise<
    | { ok: true; audited: string; live: string | null }
    | { ok: false; error: string }
  >;
  /**
   * Parent policy gate (verified API key, vault lock).
   * Returning false aborts the turn — the parent has
   * already surfaced the reason to the operator.
   */
  canSend?: () => boolean;
  /** Called with the rebound blueprint after a successful turn. */
  onContinued: (blueprint: Blueprint) => void;
}

/**
 * COR-59 interactive turn panel for an active Jules
 * session.
 *
 * Ranks the snippet library (built-ins plus decrypted
 * vault customs) against the latest Jules output, the
 * ingested goal criteria, and the inferred session
 * stage; renders the snippet bar directly beneath the
 * output; and dispatches the operator-reviewed turn
 * through the COR-39 continuation path
 * (`/api/jules/dispatch` + `applyNewRemediationSession`).
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
  currentHeadSha,
  checkHeadFreshness,
  canSend,
  onContinued,
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
      // listSnippets throws when the passphrase cannot
      // decrypt the vault — the unlock fails loudly.
      const unlocked = await store.listSnippets();
      setSnippets(unlocked);
      // Repo conventions ground the citations; the
      // profile is optional and simply omitted when
      // absent (fail-soft).
      setRepoProfile((await store.getRepoProfile(blueprint.repo)) ?? undefined);
      setIsUnlocked(true);
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

  const handleSend = async (value: string) => {
    const directive = value.trim();
    if (!directive || isSending) return;
    // Parent policy gate (verified key, vault lock):
    // the parent surfaces the reason when it aborts.
    if (canSend && !canSend()) return;
    setIsSending(true);
    setSendResult(null);
    try {
      // COR-40 gate: resolve the live head SHA and
      // refuse the turn when it drifted from the
      // audited commit. The dispatch route enforces
      // the same lock server-side.
      let headSha = (currentHeadSha || '').trim();
      if (checkHeadFreshness) {
        const freshness = await checkHeadFreshness();
        if (!freshness.ok) {
          setSendResult({ ok: false, error: freshness.error });
          return;
        }
        if (freshness.live) headSha = freshness.live.trim();
      }
      const result = await sendInteractiveTurn({
        blueprint,
        brief,
        directive,
        julesApiKey,
        currentHeadSha: headSha,
        prUrl: blueprint.prUrl,
      });
      if (result.ok && result.blueprint) {
        onContinued(result.blueprint);
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
            : 'The turn could not be sent.',
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
        placeholder="Reply to Jules, or pick a suggested snippet above…"
      />

      {sendResult && sendResult.ok && (
        <p className="text-[11px] text-emerald-300">
          Turn dispatched to Jules
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

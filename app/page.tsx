'use client';

import * as React from 'react';
import { Navbar } from '@/components/Navbar';
import { IntakeDispatchStage } from '@/components/IntakeDispatchStage';
import { AuditEvaluationStage } from '@/components/AuditEvaluationStage';
import { SettingsModal } from '@/components/SettingsModal';
import { BlueprintVaultModal } from '@/components/BlueprintVaultModal';
import { DocumentationModal } from '@/components/DocumentationModal';
import { Blueprint } from '@/types';
import { GitPullRequest, Send, Sparkles } from 'lucide-react';
import { useCredentialVault } from '@/hooks/use-credential-vault';
import { hasLegacyPlaintext } from '@/lib/credential-vault';
import type { KeyStorage } from '@/lib/settings-keys';

export default function RepoPilotPage() {
  const [currentStage, setCurrentStage] = React.useState<'stage1' | 'stage2'>('stage1');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [vaultOpen, setVaultOpen] = React.useState(false);
  const [docsOpen, setDocsOpen] = React.useState(false);

  // API credentials live in the encrypted vault (memory only when unlocked).
  const vault = useCredentialVault();
  const [julesKey, setJulesKey] = React.useState('');
  const [geminiKey, setGeminiKey] = React.useState('');
  const [githubPat, setGithubPat] = React.useState('');

  // First-run onboarding banner (passive, dismissible, localStorage-backed)
  const [bannerDismissed, setBannerDismissed] = React.useState(true);

  // Blueprint history in localStorage
  const [blueprints, setBlueprints] = React.useState<Blueprint[]>([]);
  const [activeBlueprint, setActiveBlueprint] = React.useState<Blueprint | null>(null);

  // Hydrate blueprints from localStorage on mount; credentials come only from
  // the encrypted vault (memory when unlocked). Legacy plaintext keys force
  // Settings open for a passphrase migration — never auto-read into state.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        if (hasLegacyPlaintext(window.localStorage as unknown as KeyStorage)) {
          setSettingsOpen(true);
        }
        const storedBlueprints = localStorage.getItem('repopilot_vault_blueprints');
        if (!localStorage.getItem('repopilot_onboarding_dismissed')) {
          setBannerDismissed(false);
        }

        if (storedBlueprints) {
          try {
            const parsed = JSON.parse(storedBlueprints);
            if (Array.isArray(parsed)) {
              setBlueprints(parsed);
              if (parsed.length > 0) {
                setActiveBlueprint(parsed[0]);
              }
            }
          } catch (e) {
            console.error('Failed to parse cached blueprints:', e);
          }
        }

        // Server-first hydration: when the server vault is reachable and
        // non-empty it wins (cross-device continuity); otherwise the local
        // cache above stands. Never throws — localStorage is the fallback.
        fetch('/api/vault', { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            const remote = data?.blueprints;
            if (data?.success === true && Array.isArray(remote) && remote.length > 0) {
              const full = remote as Blueprint[];
              setBlueprints(full);
              setActiveBlueprint((current) => current || full[0] || null);
            }
          })
          .catch(() => {
            // Server store unreachable — local cache remains authoritative.
          });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Mirror vault credentials into the key props consumed by stage components.
  // Deferred to a microtask so the setState lands outside the effect body.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setJulesKey(vault.credentials?.julesKey || '');
      setGeminiKey(vault.credentials?.geminiKey || '');
      setGithubPat(vault.credentials?.githubPat || '');
    }, 0);
    return () => clearTimeout(timer);
  }, [vault.credentials]);

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('repopilot_onboarding_dismissed', '1');
    }
  };

  // Best-effort server write-through; localStorage stays authoritative on failure.
  const syncVaultDelete = (id: string) => {
    fetch(`/api/vault?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  };

  const handleSaveBlueprint = (bp: Blueprint) => {
    setActiveBlueprint(bp);
    setBlueprints((prev) => {
      const filtered = prev.filter((b) => b.blueprintId !== bp.blueprintId);
      const updated = [bp, ...filtered];
      if (typeof window !== 'undefined') {
        localStorage.setItem('repopilot_vault_blueprints', JSON.stringify(updated));
      }
      return updated;
    });
    fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint: bp }),
    }).catch(() => {});
  };

  const handleDeleteBlueprint = (id: string) => {
    setBlueprints((prev) => {
      const updated = prev.filter((b) => b.blueprintId !== id);
      if (typeof window !== 'undefined') {
        localStorage.setItem('repopilot_vault_blueprints', JSON.stringify(updated));
      }
      return updated;
    });
    if (activeBlueprint?.blueprintId === id) {
      setActiveBlueprint(null);
    }
    syncVaultDelete(id);
  };

  const handleClearAllBlueprints = () => {
    setBlueprints([]);
    setActiveBlueprint(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('repopilot_vault_blueprints');
    }
  };

  const handleSelectBlueprintForAudit = (bp: Blueprint) => {
    setActiveBlueprint(bp);
    setCurrentStage('stage2');
  };

  return (
    <div suppressHydrationWarning className="min-h-screen bg-slate-50/60 text-slate-900 flex flex-col antialiased">
      {/* Navbar */}
      <Navbar
        currentStage={currentStage}
        setCurrentStage={setCurrentStage}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenVault={() => setVaultOpen(true)}
        onOpenDocs={() => setDocsOpen(true)}
        hasCredentials={Boolean(julesKey || geminiKey || githubPat)}
        blueprintsCount={blueprints.length}
        githubPat={githubPat}
        activeBlueprint={activeBlueprint}
        vaultStatus={vault.status}
      />

      {/* Main App Container */}
      <main suppressHydrationWarning className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <strong className="text-slate-800">Dispatch → wait for PR → audit → fix.</strong>
            <span>Two stages, one loop.</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-mono">
              <Send className="h-3 w-3 text-indigo-600" />
              Stage 1: Dispatch
            </span>
            <span>→</span>
            <span className="flex items-center gap-1 font-mono">
              <GitPullRequest className="h-3 w-3 text-emerald-600" />
              Stage 2: Audit
            </span>
          </div>
        </div>

        {/* First-run onboarding banner: passive, dismissible, no server keys needed */}
        {!bannerDismissed && !julesKey && !geminiKey && !githubPat && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/70 rounded-xl p-3.5 border border-indigo-200/80 shadow-2xs text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>
                <strong className="text-slate-800">Welcome to RepoPilot.</strong>{' '}
                No server setup needed — add your Jules, Gemini, and GitHub keys (stored only in this browser) or try Stage 1 in dry-run mode.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setSettingsOpen(true)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold transition-colors"
              >
                Configure API keys
              </button>
              <button
                onClick={handleDismissBanner}
                className="px-3 py-1.5 text-slate-500 hover:text-slate-800 text-xs transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Stage Render */}
        {currentStage === 'stage1' ? (          <IntakeDispatchStage
            julesKey={julesKey}
            geminiKey={geminiKey}
            githubPat={githubPat}
            vaultLocked={vault.isLocked}
            onDispatchSuccess={handleSaveBlueprint}
            onNavigateToStage2={(bp) => {
              if (bp) setActiveBlueprint(bp);
              setCurrentStage('stage2');
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <AuditEvaluationStage
            julesKey={julesKey}
            geminiKey={geminiKey}
            githubPat={githubPat}
            vaultLocked={vault.isLocked}
            activeBlueprint={activeBlueprint}
            blueprints={blueprints}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenVault={() => setVaultOpen(true)}
            onSaveBlueprint={handleSaveBlueprint}
            onSelectBlueprint={setActiveBlueprint}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 bg-white/70 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>RepoPilot 1.0.1 — dispatch, wait for PR, audit, fix</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSettingsOpen(true)}
              className="hover:text-slate-600 transition-colors"
            >
              API Credentials
            </button>
            <span>•</span>
            <button
              onClick={() => setVaultOpen(true)}
              className="hover:text-slate-600 transition-colors"
            >
              Blueprint Vault ({blueprints.length})
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        julesKey={julesKey}
        setJulesKey={setJulesKey}
        geminiKey={geminiKey}
        setGeminiKey={setGeminiKey}
        githubPat={githubPat}
        setGithubPat={setGithubPat}
        vault={vault}
      />

      <BlueprintVaultModal
        open={vaultOpen}
        onOpenChange={setVaultOpen}
        blueprints={blueprints}
        onSelectBlueprintForAudit={handleSelectBlueprintForAudit}
        onDeleteBlueprint={handleDeleteBlueprint}
        onClearAll={handleClearAllBlueprints}
      />

      <DocumentationModal
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
      />
    </div>
  );
}

'use client';

import * as React from 'react';
import { Navbar } from '@/components/Navbar';
import { IntakeDispatchStage } from '@/components/IntakeDispatchStage';
import { AuditEvaluationStage } from '@/components/AuditEvaluationStage';
import { SettingsModal } from '@/components/SettingsModal';
import { BlueprintVaultModal } from '@/components/BlueprintVaultModal';
import { DocumentationModal } from '@/components/DocumentationModal';
import { Blueprint } from '@/types';
import { ShieldCheck, GitPullRequest, Send, ArrowRight, Sparkles, BookOpen } from 'lucide-react';

export default function RepoPilotPage() {
  const [currentStage, setCurrentStage] = React.useState<'stage1' | 'stage2'>('stage1');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [vaultOpen, setVaultOpen] = React.useState(false);
  const [docsOpen, setDocsOpen] = React.useState(false);

  // API credentials stored in localStorage
  const [julesKey, setJulesKey] = React.useState('');
  const [geminiKey, setGeminiKey] = React.useState('');
  const [githubPat, setGithubPat] = React.useState('');

  // First-run onboarding banner (passive, dismissible, localStorage-backed)
  const [bannerDismissed, setBannerDismissed] = React.useState(true);

  // Blueprint history in localStorage
  const [blueprints, setBlueprints] = React.useState<Blueprint[]>([]);
  const [activeBlueprint, setActiveBlueprint] = React.useState<Blueprint | null>(null);

  // Hydrate credentials & blueprints from localStorage on mount
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined') {
        const storedJules = localStorage.getItem('repopilot_jules_key') || '';
        const storedGemini = localStorage.getItem('repopilot_gemini_key') || '';
        const storedPat = localStorage.getItem('repopilot_github_pat') || '';
        const storedBlueprints = localStorage.getItem('repopilot_vault_blueprints');

        if (storedJules) setJulesKey(storedJules);
        if (storedGemini) setGeminiKey(storedGemini);
        if (storedPat) setGithubPat(storedPat);
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
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('repopilot_onboarding_dismissed', '1');
    }
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
      />

      {/* Main App Container */}
      <main suppressHydrationWarning className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Architecture Operating Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl p-3.5 border border-slate-200/80 shadow-2xs text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <strong className="text-slate-800">Decoupled Operating Architecture:</strong>
            <span>Stateless request-response lifecycles eliminate long-polling & connection drops.</span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-mono">
              <Send className="h-3 w-3 text-indigo-600" />
              Stage 1: Jules Dispatch
            </span>
            <span>→</span>
            <span className="flex items-center gap-1 font-mono">
              <GitPullRequest className="h-3 w-3 text-emerald-600" />
              Stage 2: Gemini Audit
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
          <span>RepoPilot V1 — Google Jules Autonomous Dispatch & Gemini PR Evaluation</span>
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

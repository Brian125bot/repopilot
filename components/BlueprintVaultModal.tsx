'use client';

import * as React from 'react';
import { FolderArchive, Copy, Check, ExternalLink, ArrowRight, Trash2, Calendar, GitBranch } from 'lucide-react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Blueprint } from '@/types';

interface BlueprintVaultModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprints: Blueprint[];
  onSelectBlueprintForAudit: (bp: Blueprint) => void;
  onDeleteBlueprint: (id: string) => void;
  onClearAll: () => void;
}

export function BlueprintVaultModal({
  open,
  onOpenChange,
  blueprints,
  onSelectBlueprintForAudit,
  onDeleteBlueprint,
  onClearAll,
}: BlueprintVaultModalProps) {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCopyJson = (bp: Blueprint) => {
    navigator.clipboard.writeText(JSON.stringify(bp, null, 2));
    setCopiedId(bp.blueprintId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader onClose={() => onOpenChange(false)}>
        <DialogTitle className="flex items-center gap-2">
          <FolderArchive className="h-5 w-5 text-indigo-600" />
          Blueprint Vault (Local State Cache)
        </DialogTitle>
        <DialogDescription>
          Inspect, export, and load previous Stage 1 dispatch contracts directly into the Stage 2 Evaluation Engine.
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        {blueprints.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <FolderArchive className="mx-auto h-10 w-10 text-slate-300 mb-2" />
            <p className="font-medium text-slate-700">No cached blueprints yet</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Dispatched jobs from Stage 1 will automatically appear here for rapid cross-stage evaluation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {blueprints.map((bp) => (
              <div
                key={bp.blueprintId}
                className="rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors bg-white shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-sm">{bp.repo}</span>
                      <Badge variant="indigo" className="text-[10px] font-mono">
                        <GitBranch className="h-3 w-3 mr-1 inline" />
                        {bp.branchName}
                      </Badge>
                      {bp.sessionId && (
                        <Badge variant="outline" className="text-[10px] text-slate-500">
                          {bp.sessionId}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2 mt-1">{bp.objective}</p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(bp.createdAt).toLocaleDateString()} {new Date(bp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>•</span>
                      <span>{bp.criteria?.length || 0} Criteria</span>
                      <span>•</span>
                      <span>{bp.fileBoundaries?.length || 0} Scope Patterns</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyJson(bp)}
                      title="Copy JSON Payload"
                      className="h-8 px-2 text-xs"
                    >
                      {copiedId === bp.blueprintId ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-slate-600" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDeleteBlueprint(bp.blueprintId)}
                      title="Delete Blueprint"
                      className="h-8 px-2 text-xs text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        onSelectBlueprintForAudit(bp);
                        onOpenChange(false);
                      }}
                      className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white gap-1"
                    >
                      <span>Load in Stage 2</span>
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>

      <DialogFooter>
        {blueprints.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearAll} className="text-xs text-red-600 hover:bg-red-50">
            Clear All Blueprints
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

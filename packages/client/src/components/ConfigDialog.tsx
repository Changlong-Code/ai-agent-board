import { api } from '@/lib/api';
import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ProjectConfig } from '@/types';

interface ConfigDialogProps {
  open: boolean;
  config: ProjectConfig | null;
  onClose: () => void;
  onSubmit: (cloneRoot: string) => Promise<unknown>;
}

export function ConfigDialog({ open, config, onClose, onSubmit }: ConfigDialogProps) {
  const [cloneRoot, setCloneRoot] = useState('');
  const [developmentMode, setDevelopmentMode] = useState<'low' | 'balanced' | 'high'>('low');
  const [policySaved, setPolicySaved] = useState('');
  const [error, setError] = useState('');
  const [updateInfo, setUpdateInfo] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateState, setUpdateState] = useState<{ phase?: string; startedAt?: string; phaseStartedAt?: string; updatedAt?: string; finishedAt?: string | null; error?: string; to?: string; from?: string } | null>(null);
  const [updateConnected, setUpdateConnected] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCloneRoot(config?.cloneRoot ?? '');
    void api.getDevelopmentSettings().then(v => setDevelopmentMode(v.defaultMode)).catch(e => setError(String(e)));
    setError('');
    setSubmitting(false);
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/self-update/status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Status unavailable');
        const info = await response.json() as { busy: boolean; state?: typeof updateState };
        if (disposed) return;
        setUpdateConnected(true);
        setUpdateState(info.state || null);
        setUpdateBusy(info.busy);
      } catch {
        if (!disposed) setUpdateConnected(false);
      }
    };
    void refresh();
    const poll = window.setInterval(() => { void refresh(); }, 2000);
    const ticker = window.setInterval(() => setElapsed(Date.now()), 1000);
    return () => { disposed = true; window.clearInterval(poll); window.clearInterval(ticker); };
  }, [open]);

  const phase = updateState?.phase || 'idle';
  const activeUpdate = ['checking','preparing','awaiting-stop','installing','restarting','rolling-back'].includes(phase);
  const phaseNames: Record<string, string> = {
    idle: 'Ready', checking: 'Checking GitHub', preparing: 'Preparing and building',
    'awaiting-stop': 'Safely stopping Board', installing: 'Installing',
    restarting: 'Restarting and health-checking', complete: 'Update completed',
    'up-to-date': 'Already up to date', failed: 'Update failed',
    'rolled-back': 'Update failed — previous version restored',
    'rolling-back': 'Restoring previous version',
    'manual-recovery-required': 'Manual recovery required'
  };
  const seconds = updateState?.startedAt
    ? Math.max(0, Math.floor(((updateState.finishedAt ? Date.parse(updateState.finishedAt) : elapsed || Date.now()) - Date.parse(updateState.startedAt)) / 1000))
    : 0;
  const elapsedLabel = Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = cloneRoot.trim();
    if (!trimmed) {
      setError('Clone root is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await onSubmit(trimmed);
      if (result === undefined) {
        setError('Failed to update clone root');
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold">Settings</h2>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="config-clone-root" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Clone Root
                </label>
                <input
                  id="config-clone-root"
                  value={cloneRoot}
                  onChange={(e) => { setCloneRoot(e.target.value); setError(''); }}
                  placeholder="~/agentboard/projects"
                  autoFocus
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Repos created from a GitHub URL are cloned into this folder. It is created automatically.
                </p>
              </div>

              <div className="rounded-lg border border-border p-3">
                <label htmlFor="default-development-mode" className="block text-sm font-semibold mb-2">Default development mode</label>
                <select id="default-development-mode" value={developmentMode} onChange={e => { setDevelopmentMode(e.target.value as 'low' | 'balanced' | 'high'); setPolicySaved(''); }} className="w-full rounded border border-border bg-background p-2 text-sm">
                  <option value="low">Low (recommended)</option><option value="balanced">Balanced</option><option value="high">High</option>
                </select>
                <p className="mt-2 text-xs text-muted-foreground">New tasks inherit this mode. Upgrades always require approval. Provider-level reasoning control is not guaranteed.</p>
                <button type="button" className="mt-2 rounded bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => { void api.setDevelopmentMode(developmentMode).then(() => setPolicySaved('Saved')).catch(e => setError(String(e))); }}>Save development mode</button>
                {policySaved && <span role="status" className="ml-2 text-xs">{policySaved}</span>}
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-sm font-semibold">Self Update (Windows)</div>
                <p className="text-xs text-muted-foreground">The updater prepares the next release before stopping Board. The page reconnects when the server returns.</p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" className="rounded border border-border px-3 py-2 text-xs" onClick={() => {
                    void fetch('/api/self-update/status').then(async r => {
                      const body = await r.json();
                      if (!r.ok) throw new Error(body.error || 'Update check failed');
                      setUpdateInfo('Branch: ' + body.branch + ' | Commit: ' + body.current.slice(0, 7) + (body.dirty ? ' | Local changes' : ' | Clean'));
                      setUpdateState(body.state || null);
                    }).catch(e => setUpdateInfo(String(e)));
                  }}>Check update status</button>
                  <button type="button" disabled={updateBusy || activeUpdate || !updateConnected} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={() => {
                    if (!window.confirm('Install the GitHub update and restart this Board? Save work first.')) return;
                    setUpdateBusy(true);
                    void fetch('/api/self-update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).then(async r => {
                      const body = await r.json();
                      if (!r.ok) throw new Error(body.error || 'Update could not start');
                      setUpdateInfo(body.message);
                    }).catch(e => setUpdateInfo(String(e))).finally(() => {
                      // The background status poll owns the busy flag after launch.
                    });
                  }}>{updateBusy || activeUpdate ? 'Update in progress…' : 'Install update'}</button>
                </div>
                <div role="status" aria-live="polite" className="text-xs">
                  <div className="flex justify-between gap-2"><span>{phaseNames[phase] || phase}</span><span className="tabular-nums">{updateState?.startedAt ? elapsedLabel : ''}</span></div>
                  <div className="text-muted-foreground mt-1">{updateConnected ? 'Connected' : 'Reconnecting to Board…'}</div>
                  {updateState?.to && <div className="text-muted-foreground">Target: {updateState.to.slice(0, 7)}</div>}
                  {updateState?.error && <div className="text-red-400 break-words mt-1">{updateState.error}</div>}
                  {['complete','rolled-back','failed','manual-recovery-required'].includes(phase) && <div className="mt-1 font-semibold">{phaseNames[phase]}</div>}
                </div>
                {updateInfo && <p className="whitespace-pre-wrap text-xs">{updateInfo}</p>}
              </div>
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

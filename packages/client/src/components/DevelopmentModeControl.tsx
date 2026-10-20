import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Mode = 'low' | 'balanced' | 'high';
type TaskMode = {mode: Mode; approval?: {requestedMode: Mode; status: string}};

export function DevelopmentModeControl({ taskId, isRunning }: {taskId: string; isRunning: boolean}) {
  const [policy, setPolicy] = useState<TaskMode | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPolicy(null);
    void api.getTaskDevelopmentMode(taskId).then(setPolicy).catch(e => setMessage(String(e)));
  }, [taskId]);
  async function run(action: 'request' | 'approve' | 'reject') {
    if (isRunning) return;
    setBusy(true); setMessage('');
    try {
      if (action === 'request' && policy) {
        await api.requestTaskModeUpgrade(taskId, policy.mode === 'low' ? 'balanced' : 'high');
      } else {
        await api.decideTaskModeUpgrade(taskId, action === 'approve');
      }
      setPolicy(await api.getTaskDevelopmentMode(taskId));
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  return (
    <section className="border-b border-border px-4 py-2 text-xs" aria-label="Development mode">
      <div className="flex items-center justify-between gap-2">
        <span>Mode: <strong>{policy?.mode ?? 'loading'}</strong></span>
        <span>Approval required for upgrades</span>
      </div>
      {policy?.approval?.status === 'pending' ? (
        <div className="mt-2 flex gap-2 items-center">
          <span>Requested: {policy.approval.requestedMode}</span>
          <button disabled={busy || isRunning} onClick={() => void run('approve')}>Approve</button>
          <button disabled={busy || isRunning} onClick={() => void run('reject')}>Reject</button>
        </div>
      ) : policy && policy.mode !== 'high' ? (
        <button className="mt-2" disabled={busy || isRunning} onClick={() => void run('request')}>
          Request {policy.mode === 'low' ? 'Balanced' : 'High'}
        </button>
      ) : null}
      {isRunning && <p>Pause the task before changing its mode.</p>}
      {message && <p role="alert" className="text-red-500">{message}</p>}
    </section>
  );
}

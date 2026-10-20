import fs from 'fs';
import os from 'os';
import path from 'path';

export type DevelopmentMode = 'low' | 'balanced' | 'high';
type Approval = { requestedMode: DevelopmentMode; status: 'pending' | 'rejected' | 'approved'; updatedAt: number };
export interface TaskMode { mode: DevelopmentMode; approval?: Approval }
export interface DevelopmentSettings {
  defaultMode: DevelopmentMode;
  upgradeRequiresApproval: true;
}
interface State { settings: DevelopmentSettings; tasks: Record<string, TaskMode> }
const defaults: DevelopmentSettings = { defaultMode: 'low', upgradeRequiresApproval: true };
const home = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
const directory = path.join(home, 'AI-Agent-Board', 'development-policy');
const file = path.join(directory, 'policy.json');
const modes: DevelopmentMode[] = ['low', 'balanced', 'high'];
export function isDevelopmentMode(value: unknown): value is DevelopmentMode {
  return typeof value === 'string' && modes.includes(value as DevelopmentMode);
}
function read(): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<State>;
    const configured = parsed.settings?.defaultMode;
    const settings: DevelopmentSettings = {
      defaultMode: isDevelopmentMode(configured) ? configured : 'low',
      upgradeRequiresApproval: true,
    };
    return { settings, tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { settings: defaults, tasks: {} };
    // Corrupted files must not silently reset approvals or security settings.
    throw err;
  }
}
function save(state: State): void {
  fs.mkdirSync(directory, { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function getDevelopmentSettings(): DevelopmentSettings { return read().settings; }
export function setDefaultDevelopmentMode(mode: DevelopmentMode): DevelopmentSettings {
  const state = read();
  state.settings.defaultMode = mode;
  save(state);
  return state.settings;
}
export function ensureTaskMode(id: string): TaskMode {
  const state = read();
  if (!state.tasks[id]) {
    state.tasks[id] = { mode: state.settings.defaultMode };
    save(state);
  }
  return state.tasks[id];
}
export function requestModeUpgrade(id: string, requestedMode: DevelopmentMode): TaskMode {
  const state = read();
  const existing = state.tasks[id] || { mode: state.settings.defaultMode };
  if (modes.indexOf(requestedMode) <= modes.indexOf(existing.mode)) {
    throw new Error('Upgrade must target a higher mode');
  }
  state.tasks[id] = {
    ...existing, approval: { requestedMode, status: 'pending', updatedAt: Date.now() },
  };
  save(state);
  return state.tasks[id];
}
export function decideModeUpgrade(id: string, approve: boolean): TaskMode {
  const state = read();
  const current = state.tasks[id];
  if (!current?.approval || current.approval.status !== 'pending') {
    throw new Error('No pending upgrade request');
  }
  state.tasks[id] = {
    mode: approve ? current.approval.requestedMode : current.mode,
    approval: { ...current.approval, status: approve ? 'approved' : 'rejected', updatedAt: Date.now() },
  };
  save(state);
  return state.tasks[id];
}
export function getLowTokenInstructions(id: string): string {
  const policy = ensureTaskMode(id);
  return [
    'Development execution policy: ' + policy.mode.toUpperCase() + '.',
    'Do not scan the full repository or unrelated history. Read only files needed for this task.',
    'Keep tool calls, intermediate commentary, and final summary concise.',
    'Run targeted validation first; widen scope only when a clear dependency or failure requires it.',
    'Stop after the requested objective and its necessary verification are complete.',
    'Do not autonomously increase reasoning effort, change model or switch to a potentially billable provider.',
    'If more resources are needed, explain why and request approval through the Board. Until approved, remain in the current mode.',
    'This is a context/output discipline policy; provider-level reasoning effort is not guaranteed by this instruction.',
  ].join('\n');
}

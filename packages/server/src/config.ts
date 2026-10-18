import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProjectConfig } from './types.js';

/**
 * Agent Board persists its server-side configuration in a JSON file at a fixed
 * location (the "Agent Board home"). The clone root — where repos cloned from a
 * URL are placed — is configurable and defaults to `<home>/projects`.
 *
 * The config file deliberately lives at a fixed path (NOT inside the configurable
 * clone root) to avoid a chicken-and-egg problem: we must be able to read the
 * config before we know where the clone root is.
 */

const CONFIG_FILE_NAME = 'config.json';

function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1);
  return path.join(os.homedir(), rest);
}

export function getConfigHome(): string {
  const override = process.env.AGENTBOARD_HOME?.trim();
  return override ? path.resolve(expandTilde(override)) : path.join(os.homedir(), 'agentboard');
}

function getConfigPath(): string {
  return path.join(getConfigHome(), CONFIG_FILE_NAME);
}

function defaultConfig(): ProjectConfig {
  return { cloneRoot: path.join(getConfigHome(), 'projects') };
}

let cached: ProjectConfig | null = null;

/** Atomically write the config file (temp file + rename) to avoid corruption. */
function writeConfig(config: ProjectConfig): void {
  const home = getConfigHome();
  fs.mkdirSync(home, { recursive: true });
  const target = getConfigPath();
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, target);
}

/**
 * Load (and if necessary create) the Agent Board config. Ensures the home
 * directory, the config file, and the clone root directory all exist.
 */
export function loadConfig(): ProjectConfig {
  if (cached) return cached;

  const home = getConfigHome();
  fs.mkdirSync(home, { recursive: true });

  const configPath = getConfigPath();
  let config = defaultConfig();
  if (fs.existsSync(configPath)) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
          !('cloneRoot' in raw) || typeof raw.cloneRoot !== 'string' ||
          !raw.cloneRoot.trim() || raw.cloneRoot.includes('\0')) {
        throw new Error('Invalid cloneRoot');
      }
      config = { cloneRoot: path.resolve(expandTilde(raw.cloneRoot.trim())) };
    } catch {
      // Existing configuration is user data. Never silently replace a damaged
      // file with defaults or redirect later project operations to a new root.
      throw new Error(
        `Cannot load Agent Board configuration at ${configPath}. ` +
        'The original file was preserved. Restore a valid JSON object with a ' +
        'non-empty cloneRoot directory path from your backup, then restart.',
      );
    }
  } else {
    writeConfig(config);
  }

  fs.mkdirSync(config.cloneRoot, { recursive: true });
  cached = config;
  return config;
}

export function getConfig(): ProjectConfig {
  return cached ?? loadConfig();
}

export function getCloneRoot(): string {
  return getConfig().cloneRoot;
}

/**
 * Update the clone root. The new path is expanded/resolved, created on disk, and
 * persisted to the config file. Returns the updated config.
 */
export function setCloneRoot(cloneRoot: string): ProjectConfig {
  const trimmed = cloneRoot.trim();
  if (!trimmed) throw new Error('cloneRoot must be a non-empty string');
  const resolved = path.resolve(expandTilde(trimmed));
  if (!path.isAbsolute(resolved)) throw new Error('cloneRoot must be an absolute path');
  fs.mkdirSync(resolved, { recursive: true });
  const next: ProjectConfig = { cloneRoot: resolved };
  writeConfig(next);
  cached = next;
  return next;
}

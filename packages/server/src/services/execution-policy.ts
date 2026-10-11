/** Explicit opt-in is required before loading or running agent providers. */
export const AGENT_EXECUTION_DISABLED_REASON =
  'Agent execution disabled in basic mode. Set AGENTBOARD_ENABLE_AGENT_EXECUTION=1 to opt in; AGENTBOARD_DISABLE_AGENT_STARTUP takes precedence.';

export function isAgentExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const legacyDisable = env.AGENTBOARD_DISABLE_AGENT_STARTUP;
  return env.AGENTBOARD_ENABLE_AGENT_EXECUTION === '1' &&
    legacyDisable !== '1' && legacyDisable !== 'true';
}

export class AgentExecutionDisabledError extends Error {
  readonly code = 'AGENT_EXECUTION_DISABLED';

  constructor() {
    super(AGENT_EXECUTION_DISABLED_REASON);
    this.name = 'AgentExecutionDisabledError';
  }
}

export function assertAgentExecutionEnabled(): void {
  if (!isAgentExecutionEnabled()) throw new AgentExecutionDisabledError();
}

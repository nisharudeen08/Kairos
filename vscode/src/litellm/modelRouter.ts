import { selectModel, TaskIntent } from './models';

// Add location awareness to model router.
// Windows client needs to know which models
// are local vs remote vs cloud.

export enum ModelLocation {
  WINDOWS_LOCAL  = "windows-local",
  UBUNTU_REMOTE  = "ubuntu-remote",
  CLOUD          = "cloud"
}

export const MODEL_LOCATIONS: Record<string, ModelLocation> = {
  "gemma-vision":      ModelLocation.WINDOWS_LOCAL,
  "qwen-coder":        ModelLocation.WINDOWS_LOCAL,
  "kairos-r1-14b":     ModelLocation.UBUNTU_REMOTE,
  "360-light":         ModelLocation.UBUNTU_REMOTE,
  "kairos-coder":      ModelLocation.UBUNTU_REMOTE,
  "deepseek-r1-8b":    ModelLocation.UBUNTU_REMOTE,
  "openrouter-mistral":ModelLocation.CLOUD,
  "github-gpt4o":      ModelLocation.CLOUD
};

// Check if Ubuntu tunnel is reachable
// before routing to remote models
async function isUbuntuReachable(
  tunnelUrl: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${tunnelUrl}/api/ps`,
      { signal: AbortSignal.timeout(5000) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Emulate RouterDecision type from user's pseudo-code mapping to selectModel structure
export interface RouterDecision {
    model: string;
    reason: string;
    confidence?: number;
    fallback?: string;
}

// Enhanced routing with location fallback
export async function routeTaskWithLocation(
  userPrompt: string,
  tunnelUrl: string,
  intent: TaskIntent = 'AMBIGUOUS',
  estimatedTokens: number = 0,
  options: any = {}
): Promise<RouterDecision> {

  // Calling selectModel as the base routeTask
  const decision = selectModel(intent, estimatedTokens, options);
  const location = MODEL_LOCATIONS[decision.alias];

  // If model is on Ubuntu check tunnel first
  if (location === ModelLocation.UBUNTU_REMOTE) {
    const tunnelUp = await isUbuntuReachable(tunnelUrl);

    if (!tunnelUp) {
      console.warn(
        `[Router] Ubuntu tunnel DOWN. ` +
        `Falling back from ${decision.alias} to cloud.`
      );
      return {
        model: "openrouter-mistral",
        reason: "Ubuntu tunnel unreachable — cloud fallback",
        confidence: 0.5,
        fallback: "github-gpt4o"
      };
    }
  }

  return {
      model: decision.alias,
      reason: decision.reason
  };
}

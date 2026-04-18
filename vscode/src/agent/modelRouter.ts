export enum ModelLocation {
  WINDOWS = "windows",
  UBUNTU  = "ubuntu",
  CLOUD   = "cloud"
}

export const MODEL_LOCATIONS: Record<string, string> = {
  "gemma-local-fast":   "windows",
  "qwen-coder-win":     "windows",
  "deepseek-r1-8b":     "windows",
  "kairos-r1-14b":      "windows",
  "360-light":          "windows",
  "kairos-coder":       "windows",
  // "qwen-coder-ubuntu":  "ubuntu",   // DISABLED pending tunnel
  "openrouter-mistral": "cloud",
  "github-gpt4o":       "cloud"
};

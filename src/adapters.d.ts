// The shipped Adapters' skill module, shared with the CLI so fetch and digest have one implementation (15-prompt-skill.md).
declare module '*/adapters/lib/skills.mjs' {
  /** sha256 over every regular file in sorted posix-path order, `.git` excluded; refuses anything but files and directories. */
  export function skillDigest(dir: string): string
  /** Fetches (git) or copies (file) the bundle into `<cacheRoot>/<hash>`, verifies the digest, returns the cached directory. Throws AdapterError. */
  export function fetchSkill(entry: { name: string; source: { provider: string; locator?: Record<string, unknown>; version?: string }; digest: string }, cacheRoot: string, cwd?: string): string
}

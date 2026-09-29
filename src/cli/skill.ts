// `persimmon skill install <name> --into <dir> [--for claude|codex]`: a Skill's verified bundle copied where the agent CLIs discover skills (15-prompt-skill.md).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fetchSkill } from '../../adapters/lib/skills.mjs'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { find } from './get.js'

/** Where each CLI looks, relative to the workspace. */
export const skillDirs = { codex: '.agents/skills', claude: '.claude/skills' } as const

export async function skillInstall(cli: Cli, name: string, o: { into?: string; for?: string; namespace?: string }): Promise<number> {
  if (!o.into) throw new Error('skill install: --into <workspace dir> required')
  const targets = o.for ? [o.for] : Object.keys(skillDirs)
  for (const t of targets) if (!(t in skillDirs)) throw new Error(`skill install: --for ${t}; expected claude or codex`)
  const workspace = resolve(cli.cwd, o.into)
  if (!existsSync(workspace)) throw new Error(`skill install: ${o.into} is not a directory`)
  return withEngine(
    cli,
    async (engine) => {
      const r = find(engine, 'Skill', name, o.namespace ? { namespace: o.namespace } : {})
      if (!r) {
        cli.err(`Skill/${name} not found`)
        return 1
      }
      const spec = r.spec as { source: { provider: string; locator?: Record<string, unknown>; version?: string }; digest: string }
      const cached = fetchSkill({ name, source: spec.source, digest: spec.digest }, join(cli.cwd, '.persimmon', 'skills'), cli.cwd) // verified, or throws
      for (const t of targets as (keyof typeof skillDirs)[]) {
        const at = join(workspace, skillDirs[t], name)
        rmSync(at, { recursive: true, force: true }) // an earlier install of this Skill; the Skill's digest is the truth
        mkdirSync(join(workspace, skillDirs[t]), { recursive: true })
        cpSync(cached, at, { recursive: true })
        cli.out(`installed Skill/${name} into ${o.into}/${skillDirs[t]}/${name}`)
      }
      return 0
    },
    { listen: false },
  )
}

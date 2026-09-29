// `persimmon digest <dir>`: the bundle digest a Skill declares (15-prompt-skill.md), computed by the Adapters' own function.
import { resolve } from 'node:path'
import { skillDigest } from '../../adapters/lib/skills.mjs'
import type { Cli } from './context.js'

export async function digest(cli: Cli, dir: string): Promise<number> {
  cli.out(skillDigest(resolve(cli.cwd, dir)))
  return 0
}

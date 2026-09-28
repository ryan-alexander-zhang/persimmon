// announce Task (subprocess/v1): writes announce/<version>.txt for the channel.
import { mkdirSync, writeFileSync } from 'node:fs'

const payload = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)).on('end', () => r(s)) }))
const { version, channel } = { version: payload.inputs.version.value, channel: payload.inputs.channel.value }
const pkg = payload.inputs.package.ref
console.log(`announcing ${version} to #${channel}`)
mkdirSync('announce', { recursive: true })
writeFileSync(`announce/${version}.txt`, `#${channel}: Todo CLI ${version} is out. Package ${pkg.kind}/${pkg.id}.r${pkg.revision}.\n`)
mkdirSync('.persimmon', { recursive: true })
writeFileSync('.persimmon/release-result.json', JSON.stringify({ outputs: { posted: true }, summary: `announced ${version}` }))

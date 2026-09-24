// cli-human/v1: persimmon.adapter/v1 stdio Adapter for human Executors in local mode (19-adapter-roles.md).
// execute drops the request in .persimmon/inbox/<taskRun>.yaml and answers HumanAck; the human finishes with
// `persimmon complete <taskRun> --file <result.yaml>`. ponytail: no TTY prompt yet; file drop covers both cases.
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parse, stringify } from 'yaml'

const inbox = process.env.PERSIMMON_INBOX ?? join(process.cwd(), '.persimmon', 'inbox')
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

createInterface({ input: process.stdin }).once('line', (line) => {
  const req = JSON.parse(line)
  const { id, op, payload } = req
  switch (op) {
    case 'describe':
      return out({
        id, ok: true,
        result: {
          adapterId: 'cli-human/v1', protocol: 'persimmon.adapter/v1', roles: ['executor'],
          executorTypes: ['human'], configurationSchema: { type: 'object' }, parametersSchema: { type: 'object' },
          contextKinds: ['artifact', 'prompt'], skillFormats: [], supports: { query: false, cancel: true, complete: true }, formRenderable: false,
        },
      })
    case 'execute': {
      mkdirSync(inbox, { recursive: true })
      const name = payload.taskRun.ref.name
      const file = join(inbox, `${name}.yaml`)
      const form = {
        taskRun: payload.taskRun.ref,
        logicalExecutionId: payload.taskRun.logicalExecutionId,
        instructions: payload.task.instructions,
        inputs: payload.inputs,
        context: payload.context,
        outputs: payload.task.outputs,
        outputSchemas: payload.task.outputSchemas,
        deadline: payload.deadline,
        answer: `persimmon complete ${name} --file <result.yaml>  # result.yaml: {protocol: persimmon.result/v1, outputs: {<port>: {kind: value, value: ...}}}`,
      }
      writeFileSync(file, stringify(form, { lineWidth: 0 }))
      out({ id, event: 'log', text: `waiting for a human: ${file}` })
      out({ id, event: 'waiting', reason: 'human' })
      return out({ id, ok: true, result: { accepted: true } })
    }
    case 'cancel': {
      // the cancel payload names the attempt, not the TaskRun: find the form that carries this logicalExecutionId
      if (existsSync(inbox))
        for (const f of readdirSync(inbox)) {
          const file = join(inbox, f)
          if (parse(readFileSync(file, 'utf8'))?.logicalExecutionId === payload.logicalExecutionId) unlinkSync(file)
        }
      return out({ id, ok: true, result: { state: 'cancelled' } })
    }
    case 'query':
      return out({ id, ok: true, result: { state: 'running' } })
    default:
      return out({ id, ok: false, error: { code: 'invalid_input', message: `unknown op ${op}`, retryable: false } })
  }
})

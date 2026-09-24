// cli-human/v1: persimmon.adapter/v1 stdio Adapter for human Executors in local mode (19-adapter-roles.md).
// execute drops the request in .persimmon/inbox/<taskRun>.yaml and answers HumanAck; the human finishes with
// `persimmon complete <taskRun>` (terminal) or `--file <result.yaml>` (script). The form carries the artifact contents the
// reviewer reads, fetched with the call token, so a human or a tool renders it without touching the engine.
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { request } from 'node:http'
import { parse, stringify } from 'yaml'

const inbox = process.env.PERSIMMON_INBOX ?? join(process.cwd(), '.persimmon', 'inbox')
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

createInterface({ input: process.stdin }).once('line', async (line) => {
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
      const review = []
      for (const c of payload.context) {
        if (c.kind === 'prompt') review.push({ kind: 'prompt', name: c.name, content: c.content })
        if (c.kind === 'artifact') {
          try {
            const a = await callback(payload.engine, 'getArtifact', c.ref)
            review.push({ kind: c.ref.kind, id: c.ref.id, revision: c.ref.revision, content: a.spec.content })
          } catch (e) {
            review.push({ kind: c.ref.kind, id: c.ref.id, revision: c.ref.revision, error: e.message })
          }
        }
      }
      const form = {
        taskRun: payload.taskRun.ref,
        logicalExecutionId: payload.taskRun.logicalExecutionId,
        instructions: payload.task.instructions,
        review,
        inputs: payload.inputs,
        context: payload.context,
        outputs: payload.task.outputs,
        outputSchemas: payload.task.outputSchemas,
        deadline: payload.deadline,
        answer: `persimmon complete ${name}   # or --file <result.yaml> with {protocol: persimmon.result/v1, outputs: {<port>: {kind: value, value: ...}}}`,
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

function callback(engine, name, args) {
  return new Promise((resolve, reject) => {
    const r = request({ socketPath: engine.endpoint.replace(/^unix:\/\//, ''), path: `/callbacks/${name}`, method: 'POST', headers: { authorization: `Bearer ${engine.token}`, 'content-type': 'application/json' } }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        const body = JSON.parse(data)
        body.error ? reject(new Error(body.error.message)) : resolve(body.result)
      })
    })
    r.on('error', reject)
    r.end(JSON.stringify(args))
  })
}


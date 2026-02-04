---
name: adapter-scheduler-job-generator
description: "Generates scheduler jobs in adapter layer with consistent packaging, batch configs, and safe retry behavior."
---

# Adapter Scheduler Job Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `com.ryan.persimmon.adapter.scheduler.system.job.*`

## Inputs Required
- Job purpose (what app service it triggers)
- Schedule config keys (fixed delay/cron) and defaults
- Batch size / concurrency parameters

## Outputs
- `.../adapter/scheduler/system/job/<XxxJob>.java`
- `start` YAML keys if new config is required

## Naming & Packaging
- System jobs go to `adapter.scheduler.system.job`
- Business-context jobs go under `adapter.scheduler.biz.*` only when truly BC-specific.

## Implementation Rules
- Jobs should call app-layer services/ports only.
- Keep jobs thin: read config, call service, handle logging/metrics.
- Only inject `WorkerIdProvider` when the job itself must compute a worker identity.
  - Prefer worker identity to be used inside infra stores (lease locking) rather than in adapter jobs.

## Reference Implementations
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/scheduler/system/job/OutboxRelayJob.java`

## Pitfalls
- Putting business logic into jobs.

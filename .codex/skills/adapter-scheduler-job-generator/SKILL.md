---
name: adapter-scheduler-job-generator
description: "Generates scheduler jobs in adapter layer with consistent packaging, batch configs, and safe retry behavior."
---

# Adapter Scheduler Job Generator

## Use for
- `com.ryan.persimmon.adapter.scheduler.system.job.*`

## Rules
- Jobs should call app-layer services/ports only.
- Keep jobs thin: read config, call service, handle logging/metrics.
- Worker identity must be injected via `WorkerIdProvider` (app/common).


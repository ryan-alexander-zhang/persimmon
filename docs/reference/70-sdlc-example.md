# SDLC Example (design doc §13 and examples.yaml)

Scope: single repository, single application image, full delivery loop.

```text
Opportunity
  -> research
  -> planning repeat (max 5):
       write_prd -> [technical || test_plan] -> review -> review_gate
  -> engineering repeat (max 3):
       implement -> [tests || security] -> quality gate (validators: quality, traceability)
  -> open_pr -> human approve_pr -> pr_gate
  -> merge
  -> [postmerge_tests || postmerge_security] -> postmerge_gate
  -> build
  -> staging rollout + verification
  -> human approve_production -> production_gate
  -> production rollout + verification
  -> release record
```

Note: the design doc sketch names an `evidence_alignment` step; in examples.yaml those are the
two validator ids `quality` and `traceability` inside `Gate/engineering-quality`.

## Inventory (examples.yaml, namespace `demo`)

Workflows (5): `research`, `planning-iteration`, `engineering-iteration`, `rollout`, `sdlc`.

Step ids:
- research: `research`
- planning-iteration: `write_prd`, `technical`, `test_plan`, `review`, `review_gate`
- engineering-iteration: `implement`, `tests`, `security`, `quality`
- rollout: `prepare`, `deploy`, `verify`, `rollback_deploy`, `rollback_health`
- sdlc (16): `research`, `planning`, `engineering`, `open_pr`, `approve_pr`, `pr_gate`, `merge`,
  `postmerge_tests`, `postmerge_security`, `postmerge_gate`, `build`, `staging`,
  `approve_production`, `production_gate`, `production`, `release`

Tasks (20): research, write-prd, technical-analysis, test-plan, review-prd, implement,
run-tests, security-review, open-pr, approve, merge-pr, build, approve-production,
prepare-deployment, deploy, verify-deployment, rollback, record-release,
script-result-example, check-traceability.

Executors (4): `engineering-agent` (agent, `example.agent/v1`), `sdlc-tools` (tool, 11
`sdlc.*` operations), `human-review` (human), `local-script` (script, `networkAccess: deny`).

Validators (5): `planning-quality` (cel), `engineering-quality` (cel), `coverage-integrity`
(task → `check-traceability`), `merge-approval` (cel), `production-approval` (cel).

Gates (4): `planning-quality`, `engineering-quality` (quality + traceability),
`merge-approval`, `production-approval`. All `policy: all`. No `any`/`quorum` in the corpus.

Domain kinds (14): Opportunity, ResearchReport, ProductRequirementDocument, TechnicalAnalysis,
TestPlan, ReviewReport, ImplementationManifest, VerificationReport, SecurityAssessment,
BuildManifest, ApprovalRecord, DeploymentPlan, DeploymentRecord, ReleaseManifest.
Entities: PRD → Problem, Feature, Requirement, AcceptanceCriterion; TestPlan → TestCase;
ImplementationManifest → Change; VerificationReport → TestResult.

## sdlc workflow shape

Inputs `opportunity`, `repository`; outputs `prd`, `implementation`, `verification`, `build`,
`pullRequest`, `release`; `timeout: 48h`; entry `[research]`. Fifteen transitions, all
`join: all`. Three decision transitions use `dispatch: first` with a Failed terminal on
rejection: `pr_decision` (MergeApprovalRejected), `postmerge_decision`
(PostMergeVerificationRejected), `production_decision` (ProductionApprovalRejected).

Repeats: `planning` maxIterations 5, `engineering` maxIterations 3, both
`until: iteration.outputs.accepted`, `timeout: 6h`, `initial: {}`, state carried with
`fromIterationOutput` and read with `fromState` + `onMissing: omit`.

`rollout` is the only branching sub-workflow: `deploy_result` → verify or rollback_deploy;
`health_result` → Succeeded (Healthy) when `steps.verify.phase == "Succeeded" &&
steps.verify.outputs.healthy`, else rollback_health. Rollback terminals are Failed with
`DeploymentFailedRolledBack` / `HealthCheckFailedRolledBack`.

## Evidence contracts

| Stage | Invariant |
|---|---|
| PRD and design | technical-analysis and test-plan read the same PRD revision; review references all three |
| Implement and test | tests and scans check out `ImplementationManifest.commit` in isolation |
| Rework | implement receives previous `verificationFeedback` and `securityFeedback` |
| PR approval | ApprovalRecord binds the exact ImplementationManifest; merge adapter re-checks PR head |
| Merge | may produce a merge commit different from PR head; outputs a new ImplementationManifest |
| Post-merge | new tests and scans bind the merge commit; pre-merge reports are not reused |
| Build | same commit and post-merge evidence; outputs imageRepository, imageDigest, SBOM digest |
| Staging / production | promote the same BuildManifest and imageDigest; no rebuild |
| Production approval | ApprovalRecord binds the exact BuildManifest, action deploy, environment production |
| Release | written only after production verification; commit, build, deployment, digest align |

Rollout creates a DeploymentPlan with target image, previous version, `operationKey`,
`fencingToken`. Successful rollback still means the release failed. Old rollouts may not
override a newer fencing token. The example assumes a recoverable previous image; it is not a
general scheme for migrations, infra changes, multi-service transactions or first deploys.

A merge that passes but fails post-merge verification blocks build/deploy without reverting
the merge. Production healthy but release record failed leaves the Run Failed with the new
version live. WorkflowRun Failed does not imply "production rolled back".

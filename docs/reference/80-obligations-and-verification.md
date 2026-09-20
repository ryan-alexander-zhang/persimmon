# Implementation Obligations and Verification Entry (design doc §14–15)

Obligations the implementation must meet; the local simulator does not verify them:

- API write permission separates user `spec` from controller `status`. Run spec, artifact
  revisions, published schemas and Relations are never overwritten.
- Approval actor and provenance come from authenticated server-side events. `approved: true`
  or an actor string alone is not authorization.
- Every artifact and resource read is permission-checked. Namespace boundaries, tool
  allowlists, credential bindings and log redaction cannot be overridden by agent output.
- Retries, Transition firing, output selection and recovery use persistent state and
  deduplicated commits. In-memory maps are not a production guarantee.
- Every real adapter implements TaskResult, I/O schemas, idempotency keys, timeouts,
  unknown-result query and cancel.
- Real models, images, Git credentials, approval accounts and deploy permissions were not
  connected or verified in the notes.

The reference checker uses conservative "explicit port type equality"; it does not solve JSON
Schema subtyping. New definitions still need static checks, bounded path tests and real
integration/conformance tests.

## Verification entry (as described; files not present in this repo)

```bash
python -m pip install -r requirements.txt
python validate.py
python test_spec.py
python simulate.py
```

Outputs: `validation-report.json` (machine-readable), `test-output.txt` (per case),
`simulation-trace.json` (steps, gates, iterations, artifact revisions, simulated environment).
No network, accounts, repositories or models required.

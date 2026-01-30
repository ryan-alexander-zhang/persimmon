/**
 * Architecture tests based on ArchUnit.
 *
 * <p>This package contains executable architecture rules for verifying the DDD module layout
 * described in {@code docs/requirements/01-ddd-layout.requirement.md}. The rules are intentionally
 * written as "guardrails": they describe what is allowed between layers and packages, and they fail
 * fast when code violates the agreed boundaries.
 *
 * <h2>How to use</h2>
 *
 * <ul>
 *   <li>Add/modify production code in {@code com.ryan.persimmon.*}.
 *   <li>Run tests in the start module to validate architecture constraints.
 *   <li>If you introduce a new bounded context or system integration, update the allowed packages.
 * </ul>
 *
 * <h2>Rule categories</h2>
 *
 * <ul>
 *   <li>Package dependency checks: prevent forbidden package-to-package dependencies and cycles.
 *   <li>Class dependency checks: prevent forbidden type-level dependencies (imports/field
 *       types/calls).
 *   <li>Containment checks: enforce that certain class kinds live in the right packages.
 *   <li>Inheritance checks: enforce base-type conventions where needed.
 *   <li>Annotation checks: prevent framework annotations from leaking into pure layers.
 *   <li><strong>Layer checks (Must)</strong>: enforce the strict dependency direction between
 *       modules.
 * </ul>
 *
 * <p>Notes:
 *
 * <ul>
 *   <li>Some rules are marked "Optional/Reserved" and are kept as placeholders for future needs.
 *   <li>Most rules allow empty matches to avoid failing in early scaffolding phases.
 * </ul>
 */
package com.ryan.persimmon.arch;

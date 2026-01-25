/**
 * Aggregate roots for the {@code biz} domain context.
 *
 * <p>Aggregates define consistency boundaries. External collaborators should access aggregate state
 * through aggregate behaviors, not by directly mutating internal entities.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Expose intention-revealing methods that enforce invariants.</li>
 *   <li>Emit domain events when meaningful business state changes happen.</li>
 *   <li>Do not leak persistence concerns into aggregate types.</li>
 * </ul>
 */
package com.ryan.persimmon.domain.biz.model.aggregate;


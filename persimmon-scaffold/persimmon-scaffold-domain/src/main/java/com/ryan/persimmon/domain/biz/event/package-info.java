/**
 * Domain events for the {@code biz} context.
 *
 * <p>Domain events describe something meaningful that has happened in the domain (past-tense),
 * typically as a consequence of a successful state transition. They are used to decouple domain
 * changes from side effects (notifications, integration, read-model updates, etc.).</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Events should be immutable and describe facts, not commands.</li>
 *   <li>Publish events from within the aggregate boundary when invariants are satisfied.</li>
 * </ul>
 */
package com.ryan.persimmon.domain.biz.event;


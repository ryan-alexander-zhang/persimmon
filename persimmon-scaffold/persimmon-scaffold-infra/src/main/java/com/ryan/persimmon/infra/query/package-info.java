/**
 * CQRS read-side infrastructure (optional).
 *
 * <p>Contains optimized read-side persistence access for queries, separated from write-side
 * repositories. Use when the system adopts CQRS and maintains read models/projections.
 *
 * <p><strong>Optional:</strong> include this when query performance requirements justify dedicated
 * read models or separate query stores.
 */
package com.ryan.persimmon.infra.query;

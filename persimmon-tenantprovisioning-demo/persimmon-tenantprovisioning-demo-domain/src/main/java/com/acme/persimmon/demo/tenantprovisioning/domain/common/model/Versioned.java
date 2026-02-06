package com.acme.persimmon.demo.tenantprovisioning.domain.common.model;

/**
 * Optimistic locking token contract.
 *
 * <p>The version is a concurrency control mechanism, not a business attribute. Repositories/infra
 * typically use it as a compare-and-swap token.
 */
public interface Versioned {

  /**
   * Returns the current version.
   *
   * <p>Convention: {@code -1} means "not yet persisted / no version assigned".
   */
  long version();
}

package com.acme.persimmon.demo.tenantprovisioning.domain.common.model;

import java.util.Arrays;

/**
 * Base type for Value Objects.
 *
 * <p>Value objects are immutable and defined by their attributes rather than identity. Equality and
 * hashing must be derived from those attributes.
 *
 * <p>This base class avoids reflection and forces the implementer to explicitly declare which
 * fields participate in equality via {@link #equalityComponents()}.
 */
public abstract class ValueObject {

  @Override
  public final int hashCode() {
    return Arrays.deepHashCode(equalityComponents());
  }

  @Override
  public final boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    return Arrays.deepEquals(this.equalityComponents(), ((ValueObject) o).equalityComponents());
  }

  /**
   * Returns the components that define value equality.
   *
   * <p>Rules:
   *
   * <ul>
   *   <li>The returned array must be stable (same values after construction).
   *   <li>Components should be immutable (or treated as such).
   *   <li>Order matters; keep it consistent with your conceptual model.
   * </ul>
   */
  protected abstract Object[] equalityComponents();
}

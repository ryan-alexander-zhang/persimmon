package com.acme.persimmon.demo.tenantprovisioning.domain.common.model;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.id.TypedId;
import java.util.Objects;

/**
 * Base type for Entities.
 *
 * <p>Entities have identity. Equality is based on identity (the {@link #id()}) rather than
 * attributes. This base class uses strict type equality ({@code getClass()}) to prevent accidental
 * cross-type equality when IDs have the same underlying UUID.
 */
public abstract class EntityBase<I extends TypedId> {
  private final I id;

  protected EntityBase(I id) {
    this.id = Objects.requireNonNull(id, "id must not be null");
  }

  public final I id() {
    return id;
  }

  @Override
  public final int hashCode() {
    return id.hashCode();
  }

  @Override
  public final boolean equals(Object o) {
    return (this == o)
        || (o != null && getClass() == o.getClass() && id.equals(((EntityBase<?>) o).id));
  }
}

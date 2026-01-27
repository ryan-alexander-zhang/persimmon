package com.ryan.persimmon.domain.common.id;

import java.util.UUID;

/**
 * Base class for UUIDv7-backed strongly-typed identifiers.
 *
 * <p>Equality and hashing are value-based and type-safe: two IDs are equal only if both their
 * concrete classes and UUID values match.
 *
 * <p>Example:
 *
 * <pre>{@code
 * public final class OrderId extends UuidV7Id {
 *   public OrderId(UUID value) { super(value); }
 * }
 * }</pre>
 */
public abstract class UuidV7Id implements TypedId {
  private final UUID value;

  protected UuidV7Id(UUID value) {
    this.value = TypedId.requireV7(value);
  }

  @Override
  public final UUID value() {
    return value;
  }

  @Override
  public final int hashCode() {
    return value.hashCode();
  }

  @Override
  public final boolean equals(Object o) {
    return (this == o)
        || (o != null && getClass() == o.getClass() && value.equals(((UuidV7Id) o).value));
  }

  @Override
  public String toString() {
    return getClass().getSimpleName() + "(" + value + ")";
  }
}

package com.acme.persimmon.demo.tenantprovisioning.domain.common.id;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.exception.DomainRuleViolationException;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Strongly-typed identifier contract backed by a UUIDv7 value.
 *
 * <p>Intent: prevent accidental mixing of identifiers across aggregates/bounded contexts while
 * keeping the domain model framework-free. The domain layer validates invariants but does not
 * generate IDs.
 *
 * <h2>UUIDv7 requirement</h2>
 *
 * <p>All IDs in this codebase are required to be UUID version 7. Implementations must validate this
 * invariant during construction.
 */
public interface TypedId {

  /**
   * Validates the UUIDv7 invariant and returns the provided value.
   *
   * <p>This helper exists to centralize invariant checking for both IDs and domain events.
   *
   * @throws DomainRuleViolationException if the value is null or not a UUIDv7
   */
  static UUID requireV7(UUID value) {
    Objects.requireNonNull(value, "uuid must not be null");
    if (value.version() != 7) {
      throw new DomainRuleViolationException(
          "UUID_NOT_V7",
          "UUID must be version 7, but was version=" + value.version(),
          Map.of("actualVersion", value.version()));
    }
    return value;
  }

  /**
   * Returns the underlying UUID value (required to be UUIDv7).
   *
   * <p>The returned value must be stable and non-null.
   */
  UUID value();
}

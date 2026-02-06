package com.acme.persimmon.demo.tenantprovisioning.domain.common.exception;

import java.util.Map;
import java.util.Objects;

/**
 * Thrown when a domain rule / invariant is violated.
 *
 * <p>This exception is intentionally generic and business-agnostic. Use a stable {@code code} to
 * support consistent error handling/mapping in upper layers.
 */
public class DomainRuleViolationException extends DomainException {
  private final String code;
  // RuntimeException is Serializable; keep non-serializable debug context out of the serialized
  // form.
  private final transient Map<String, Object> details;

  public DomainRuleViolationException(String code, String message) {
    this(code, message, null);
  }

  public DomainRuleViolationException(String code, String message, Map<String, Object> details) {
    super(message);
    this.code = Objects.requireNonNull(code, "code must not be null");
    this.details = (details == null) ? Map.of() : Map.copyOf(details);
  }

  /** A stable, machine-readable code for mapping/translation. */
  public String code() {
    return code;
  }

  /** Optional context details that help debugging or mapping (immutable snapshot). */
  public Map<String, Object> details() {
    return details;
  }
}

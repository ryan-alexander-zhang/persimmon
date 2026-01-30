package com.ryan.persimmon.domain.common.assertion;

import com.ryan.persimmon.domain.common.exception.DomainRuleViolationException;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.Map;
import java.util.Objects;

/**
 * Tiny assertion helpers for enforcing domain invariants consistently.
 *
 * <p>Purpose: keep domain code expressive and ensure consistent exception types/codes/messages
 * across aggregates and entities.
 *
 * <p>Example:
 *
 * <pre>{@code
 * DomainAssertions.state(
 *     orderStatus == OrderStatus.CREATED,
 *     "ORDER_STATUS_ILLEGAL",
 *     "Order can only be paid when status is CREATED.",
 *     Map.of("status", orderStatus));
 * }</pre>
 */
public final class DomainAssertions {
  private DomainAssertions() {}

  /**
   * Asserts a state invariant without additional details.
   *
   * @throws DomainRuleViolationException if {@code condition} is false
   */
  public static void state(boolean condition, String code, String message) {
    state(condition, code, message, Map.of());
  }

  /**
   * Asserts a state invariant.
   *
   * @throws DomainRuleViolationException if {@code condition} is false
   */
  public static void state(
      boolean condition, String code, String message, Map<String, Object> details) {
    if (!condition) {
      throw new DomainRuleViolationException(code, message, details);
    }
  }

  /**
   * Asserts a non-null requirement and returns the value for fluent usage (no details).
   *
   * @throws DomainRuleViolationException if {@code value} is null
   */
  public static <T> T notNull(T value, String code, String message) {
    return notNull(value, code, message, Map.of());
  }

  /**
   * Asserts a non-null requirement and returns the value for fluent usage.
   *
   * @throws DomainRuleViolationException if {@code value} is null
   */
  public static <T> T notNull(T value, String code, String message, Map<String, Object> details) {
    if (value == null) {
      throw new DomainRuleViolationException(code, message, details);
    }
    return value;
  }

  /**
   * Asserts a non-blank string requirement and returns the value for fluent usage.
   *
   * <p>Blank means empty or consisting only of whitespace.
   *
   * @throws DomainRuleViolationException if {@code value} is null or blank
   */
  public static String nonBlank(
      String value, String code, String message, Map<String, Object> details) {
    if (value == null || value.isBlank()) {
      throw new DomainRuleViolationException(code, message, details);
    }
    return value;
  }

  /**
   * Asserts a non-empty collection requirement and returns the value for fluent usage.
   *
   * @throws DomainRuleViolationException if {@code value} is null or empty
   */
  public static <T extends Collection<?>> T nonEmpty(
      T value, String code, String message, Map<String, Object> details) {
    if (value == null || value.isEmpty()) {
      throw new DomainRuleViolationException(code, message, details);
    }
    return value;
  }

  /**
   * Asserts a positive (strictly greater than zero) requirement.
   *
   * @throws DomainRuleViolationException if {@code value} is not positive
   */
  public static long positive(
      long value, String code, String message, Map<String, Object> details) {
    if (value <= 0) {
      throw new DomainRuleViolationException(code, message, details);
    }
    return value;
  }

  /**
   * Asserts a positive (strictly greater than zero) BigDecimal requirement.
   *
   * <p>This is useful for money/amount-like value objects where integer types are not suitable.
   *
   * @throws DomainRuleViolationException if {@code value} is null or not positive
   */
  public static BigDecimal positive(
      BigDecimal value, String code, String message, Map<String, Object> details) {
    Objects.requireNonNull(details, "details must not be null");
    if (value == null || value.signum() <= 0) {
      throw new DomainRuleViolationException(code, message, details);
    }
    return value;
  }
}

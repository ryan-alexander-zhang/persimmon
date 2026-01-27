package com.ryan.persimmon.domain.common.exception;

/**
 * Base exception type for domain errors.
 *
 * <p>Domain exceptions are unchecked (RuntimeException) and represent business rule violations,
 * invalid state transitions, or invalid inputs at the domain boundary.
 *
 * <p>Infrastructure and framework exceptions should generally be handled outside the domain module
 * and mapped to domain concepts only if appropriate.
 */
public class DomainException extends RuntimeException {

  public DomainException(String message) {
    super(message);
  }

  public DomainException(String message, Throwable cause) {
    super(message, cause);
  }
}

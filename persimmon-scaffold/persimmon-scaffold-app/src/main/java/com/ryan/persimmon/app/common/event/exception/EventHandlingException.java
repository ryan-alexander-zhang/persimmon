package com.ryan.persimmon.app.common.event.exception;

import java.util.Map;

/**
 * Canonical exception type for integration event handling.
 *
 * <p>Handlers should throw this exception to clearly indicate whether the failure is retryable.
 */
public final class EventHandlingException extends RuntimeException {
  private final String code;
  private final boolean retryable;
  private final Map<String, Object> details;

  private EventHandlingException(
      String code, String message, boolean retryable, Map<String, Object> details, Throwable cause) {
    super(message, cause);
    this.code = code;
    this.retryable = retryable;
    this.details = details == null ? Map.of() : Map.copyOf(details);
  }

  public static EventHandlingException retryable(String code, String message, Throwable cause) {
    return new EventHandlingException(code, message, true, Map.of(), cause);
  }

  public static EventHandlingException nonRetryable(String code, String message, Throwable cause) {
    return new EventHandlingException(code, message, false, Map.of(), cause);
  }

  public static EventHandlingException retryable(
      String code, String message, Map<String, Object> details, Throwable cause) {
    return new EventHandlingException(code, message, true, details, cause);
  }

  public static EventHandlingException nonRetryable(
      String code, String message, Map<String, Object> details, Throwable cause) {
    return new EventHandlingException(code, message, false, details, cause);
  }

  public String code() {
    return code;
  }

  public boolean retryable() {
    return retryable;
  }

  public Map<String, Object> details() {
    return details;
  }
}


package com.ryan.persimmon.domain.common.event;

import com.ryan.persimmon.domain.common.exception.DomainRuleViolationException;
import java.time.Instant;
import java.util.UUID;

/**
 * Domain event contract.
 *
 * <p>A domain event is an immutable fact that has occurred within the domain model. It should be
 * named in the past tense and carry only the minimum information required by downstream consumers.
 *
 * <h2>Event identity</h2>
 *
 * <p>{@link #eventId()} is required and must be a UUIDv7. Event ID generation belongs to
 * application/infra. The domain layer only validates invariants.
 */
public interface DomainEvent {

  /**
   * Validates the invariants for any domain event instance.
   *
   * <p>Aggregates should defensively validate events before recording them.
   *
   * @throws DomainRuleViolationException if any invariant is violated
   */
  static void validate(DomainEvent event) {
    if (event == null) {
      throw new DomainRuleViolationException("EVENT_REQUIRED", "Domain event must not be null.");
    }
    validate(event.eventId(), event.occurredAt());
  }

  /**
   * Validates the invariants for domain event fields.
   *
   * <p>This overload exists because some immutable implementations (e.g., Java records) cannot
   * safely call {@code validate(this)} inside their compact constructors before field assignment.
   *
   * @throws DomainRuleViolationException if any invariant is violated
   */
  static void validate(UUID eventId, Instant occurredAt) {
    if (eventId == null) {
      throw new DomainRuleViolationException(
          "EVENT_ID_REQUIRED", "Domain eventId must not be null.");
    }
    if (eventId.version() != 7) {
      throw new DomainRuleViolationException(
          "EVENT_ID_NOT_UUIDV7",
          "Domain eventId must be a UUIDv7.",
          java.util.Map.of("actualVersion", eventId.version()));
    }
    if (occurredAt == null) {
      throw new DomainRuleViolationException(
          "EVENT_OCCURRED_AT_REQUIRED", "Domain occurredAt must not be null.");
    }
  }

  /** Unique identifier for this event (required, UUIDv7). */
  UUID eventId();

  /** When the event occurred in domain time (required). */
  Instant occurredAt();
}

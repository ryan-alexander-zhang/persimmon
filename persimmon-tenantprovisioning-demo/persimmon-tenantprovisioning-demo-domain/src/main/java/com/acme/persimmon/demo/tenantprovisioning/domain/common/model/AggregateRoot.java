package com.acme.persimmon.demo.tenantprovisioning.domain.common.model;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.assertion.DomainAssertions;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.HasDomainEvents;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.id.TypedId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Aggregate Root base type.
 *
 * <p>Responsibilities:
 *
 * <ul>
 *   <li>Own invariants and state transitions.
 *   <li>Record (but never publish) uncommitted {@link DomainEvent domain events}.
 *   <li>Carry an optimistic-lock version token via {@link Versioned}.
 * </ul>
 *
 * <h2>Domain events</h2>
 *
 * <p>Aggregates record events using {@link #raise(DomainEvent)}. The application layer is
 * responsible for publishing them after persistence by calling {@link #pullDomainEvents()}.
 *
 * <h2>Optimistic lock version</h2>
 *
 * <p>Version starts at {@code -1} to indicate "no version assigned yet". Repositories are allowed
 * to set the version when rehydrating or after successful persistence.
 *
 * <p>This class is intentionally not thread-safe; domain objects are expected to be used within a
 * single request/transaction scope.
 */
public abstract class AggregateRoot<I extends TypedId> extends EntityBase<I>
    implements HasDomainEvents, Versioned {

  private final List<DomainEvent> domainEvents = new ArrayList<>();

  private long version = -1;

  protected AggregateRoot(I id) {
    super(id);
  }

  /**
   * Raises (records) an uncommitted domain event.
   *
   * <p>The event is validated (non-null, UUIDv7 eventId, non-null occurredAt) before being
   * recorded.
   */
  protected final void raise(DomainEvent event) {
    DomainEvent.validate(event);
    domainEvents.add(event);
  }

  /**
   * Returns and clears the currently recorded uncommitted domain events.
   *
   * <p>The returned list is an immutable snapshot.
   */
  @Override
  public final List<DomainEvent> pullDomainEvents() {
    if (domainEvents.isEmpty()) {
      return List.of();
    }
    List<DomainEvent> snapshot = List.copyOf(domainEvents);
    domainEvents.clear();
    return snapshot;
  }

  /** Returns a read-only snapshot of the currently recorded uncommitted domain events. */
  @Override
  public final List<DomainEvent> peekDomainEvents() {
    if (domainEvents.isEmpty()) {
      return List.of();
    }
    return Collections.unmodifiableList(List.copyOf(domainEvents));
  }

  @Override
  public final long version() {
    return version;
  }

  /**
   * Sets the optimistic lock version.
   *
   * <p>Intended for repository/rehydration use only. Domain behavior should not arbitrarily mutate
   * the version; it is a concurrency token.
   *
   * <p>Valid values: {@code -1} (unassigned) or any non-negative number.
   */
  protected final void setVersion(long version) {
    DomainAssertions.state(
        version >= -1,
        "VERSION_INVALID",
        "Version must be -1 (unassigned) or non-negative.",
        java.util.Map.of("version", version));
    this.version = version;
  }
}

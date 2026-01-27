package com.ryan.persimmon.domain.common.event;

import java.util.List;

/**
 * Contract for domain objects that can expose uncommitted domain events.
 *
 * <p>Typical usage: the application layer saves an aggregate and then calls {@link
 * #pullDomainEvents()} to publish those events via an outbox/message bus (outside the domain
 * module).
 */
public interface HasDomainEvents {

  /**
   * Returns and clears the current uncommitted domain events (one-shot).
   *
   * <p>The returned list is a snapshot and should be treated as immutable.
   */
  List<DomainEvent> pullDomainEvents();

  /**
   * Returns a read-only snapshot of the current uncommitted domain events.
   *
   * <p>This method does not clear events.
   */
  List<DomainEvent> peekDomainEvents();
}

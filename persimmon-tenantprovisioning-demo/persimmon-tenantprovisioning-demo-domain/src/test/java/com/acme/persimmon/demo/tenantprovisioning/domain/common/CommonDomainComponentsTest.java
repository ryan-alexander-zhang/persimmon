package com.acme.persimmon.demo.tenantprovisioning.domain.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.assertion.DomainAssertions;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.exception.DomainRuleViolationException;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.id.TypedId;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.id.UuidV7Id;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.model.AggregateRoot;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.model.ValueObject;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Usage-focused unit tests for the "domain.common" building blocks.
 *
 * <p>Goal: demonstrate correct usage without polluting business context packages, while protecting
 * these foundational abstractions from regressions.
 */
class CommonDomainComponentsTest {

  private static final UUID UUID_V7 = UUID.fromString("00000000-0000-7000-8000-000000000000");
  private static final UUID UUID_V4 = UUID.fromString("00000000-0000-4000-8000-000000000000");

  @Test
  void typedId_requires_uuidv7() {
    assertEquals(7, TypedId.requireV7(UUID_V7).version());

    DomainRuleViolationException ex =
        assertThrows(DomainRuleViolationException.class, () -> TypedId.requireV7(UUID_V4));
    assertEquals("UUID_NOT_V7", ex.code());
  }

  @Test
  void uuidV7Id_is_type_safe_and_value_based() {
    OrderId a1 = new OrderId(UUID_V7);
    OrderId a2 = new OrderId(UUID_V7);
    CustomerId b = new CustomerId(UUID_V7);

    assertEquals(a1, a2);
    assertEquals(a1.hashCode(), a2.hashCode());
    assertNotEquals(a1, b); // same UUID, different ID type
  }

  @Test
  void valueObject_equality_is_defined_by_components() {
    Money m1 = new Money(100, "USD");
    Money m2 = new Money(100, "USD");
    Money m3 = new Money(200, "USD");

    assertEquals(m1, m2);
    assertNotEquals(m1, m3);
  }

  @Test
  void aggregateRoot_records_and_pulls_domain_events_and_defaults_version_to_minus_one() {
    TestOrder order = new TestOrder(new OrderId(UUID_V7));
    assertEquals(-1, order.version());

    UUID eventId = UUID.fromString("00000000-0000-7000-8000-000000000001");
    order.markPaid(eventId, Instant.parse("2026-01-01T00:00:00Z"));

    List<DomainEvent> peek = order.peekDomainEvents();
    assertEquals(1, peek.size());
    assertInstanceOf(OrderPaid.class, peek.getFirst());

    List<DomainEvent> pulled = order.pullDomainEvents();
    assertEquals(1, pulled.size());
    assertEquals(List.of(), order.peekDomainEvents()); // cleared after pull
  }

  @Test
  void domainEvent_requires_uuidv7_event_id() {
    DomainEvent badEvent =
        new DomainEvent() {
          @Override
          public UUID eventId() {
            return UUID_V4;
          }

          @Override
          public Instant occurredAt() {
            return Instant.now();
          }
        };

    DomainRuleViolationException ex =
        assertThrows(DomainRuleViolationException.class, () -> DomainEvent.validate(badEvent));
    assertEquals("EVENT_ID_NOT_UUIDV7", ex.code());
  }

  @Test
  void aggregateRoot_version_must_be_minus_one_or_non_negative() {
    TestOrder order = new TestOrder(new OrderId(UUID_V7));

    order.exposeSetVersion(-1);
    assertEquals(-1, order.version());

    order.exposeSetVersion(0);
    assertEquals(0, order.version());

    DomainRuleViolationException ex =
        assertThrows(DomainRuleViolationException.class, () -> order.exposeSetVersion(-2));
    assertEquals("VERSION_INVALID", ex.code());
  }

  @Test
  void aggregateRoot_raise_defensively_validates_events() {
    TestOrder order = new TestOrder(new OrderId(UUID_V7));

    // Null event instance should be rejected.
    DomainRuleViolationException ex1 =
        assertThrows(DomainRuleViolationException.class, () -> order.exposeRecord(null));
    assertEquals("EVENT_REQUIRED", ex1.code());

    // Null eventId should be rejected.
    DomainEvent nullId =
        new DomainEvent() {
          @Override
          public UUID eventId() {
            return null;
          }

          @Override
          public Instant occurredAt() {
            return Instant.now();
          }
        };

    DomainRuleViolationException ex2 =
        assertThrows(DomainRuleViolationException.class, () -> order.exposeRecord(nullId));
    assertEquals("EVENT_ID_REQUIRED", ex2.code());

    // Null occurredAt should be rejected.
    DomainEvent nullOccurredAt =
        new DomainEvent() {
          @Override
          public UUID eventId() {
            return UUID.fromString("00000000-0000-7000-8000-000000000002");
          }

          @Override
          public Instant occurredAt() {
            return null;
          }
        };

    DomainRuleViolationException ex3 =
        assertThrows(DomainRuleViolationException.class, () -> order.exposeRecord(nullOccurredAt));
    assertEquals("EVENT_OCCURRED_AT_REQUIRED", ex3.code());
  }

  @Test
  void domainAssertions_has_convenience_helpers() {
    String blankName = "   ";
    Map<String, Object> emptyDetails = Map.of();

    DomainRuleViolationException ex1 =
        assertThrows(
            DomainRuleViolationException.class,
            () ->
                DomainAssertions.nonBlank(
                    blankName, "NAME_BLANK", "Name must not be blank.", emptyDetails));
    assertEquals("NAME_BLANK", ex1.code());

    java.math.BigDecimal nullAmount = null;
    DomainRuleViolationException ex2 =
        assertThrows(
            DomainRuleViolationException.class,
            () ->
                DomainAssertions.positive(
                    nullAmount, "AMOUNT_INVALID", "Amount must be positive.", emptyDetails));
    assertEquals("AMOUNT_INVALID", ex2.code());
  }

  /** Example strongly-typed ID used by the tests. */
  private static final class OrderId extends UuidV7Id {
    private OrderId(UUID value) {
      super(value);
    }
  }

  /** Another ID type used to demonstrate type-safe equality (same UUID != same ID type). */
  private static final class CustomerId extends UuidV7Id {
    private CustomerId(UUID value) {
      super(value);
    }
  }

  /** Example value object used by the tests. */
  private static final class Money extends ValueObject {
    private final long amount;
    private final String currency;

    private Money(long amount, String currency) {
      this.amount =
          DomainAssertions.positive(
              amount, "AMOUNT_INVALID", "Money amount must be positive.", Map.of("amount", amount));
      this.currency =
          DomainAssertions.notNull(
              currency, "CURRENCY_REQUIRED", "Currency is required.", Map.of());
    }

    @Override
    protected Object[] equalityComponents() {
      return new Object[] {amount, currency};
    }
  }

  /** Example aggregate root used by the tests. */
  private static final class TestOrder extends AggregateRoot<OrderId> {
    private boolean paid;

    private TestOrder(OrderId id) {
      super(id);
    }

    private void markPaid(UUID eventId, Instant occurredAt) {
      DomainAssertions.state(
          !paid, "ORDER_ALREADY_PAID", "Order is already paid.", Map.of("id", id().value()));
      paid = true;
      raise(new OrderPaid(eventId, occurredAt, id()));
    }

    private void exposeSetVersion(long version) {
      setVersion(version);
    }

    private void exposeRecord(DomainEvent event) {
      raise(event);
    }
  }

  /**
   * Example domain event used by the tests.
   *
   * <p>Events should be immutable and validate required invariants at construction time.
   */
  private record OrderPaid(UUID eventId, Instant occurredAt, OrderId orderId)
      implements DomainEvent {
    private OrderPaid {
      // Defensive validation close to the data, so invalid events cannot be constructed.
      //
      // Note: in a record compact constructor, the implicit assignments to fields happen *after*
      // the constructor body. Therefore, validate the parameters (eventId/occurredAt/orderId)
      // directly, rather than calling accessors on "this".
      DomainEvent.validate(eventId, occurredAt);
      DomainAssertions.notNull(orderId, "ORDER_ID_REQUIRED", "OrderId is required.", Map.of());
    }
  }
}

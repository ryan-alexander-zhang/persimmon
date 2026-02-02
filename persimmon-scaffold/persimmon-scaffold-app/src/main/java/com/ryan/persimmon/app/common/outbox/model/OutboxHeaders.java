package com.ryan.persimmon.app.common.outbox.model;

/** Standard headers for outbox integration events. */
public final class OutboxHeaders {
  private OutboxHeaders() {}

  public static final String EVENT_ID = "eventId";
  public static final String EVENT_TYPE = "eventType";
  public static final String OCCURRED_AT = "occurredAt";
  public static final String AGGREGATE_TYPE = "aggregateType";
  public static final String AGGREGATE_ID = "aggregateId";
}


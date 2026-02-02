package com.ryan.persimmon.adapter.mq.system.consumer;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import com.ryan.persimmon.app.common.event.port.EventDispatcher;
import com.ryan.persimmon.app.common.outbox.model.OutboxHeaders;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OutboxEventKafkaConsumer {
  private final EventDispatcher eventDispatcher;

  public OutboxEventKafkaConsumer(EventDispatcher eventDispatcher) {
    this.eventDispatcher = eventDispatcher;
  }

  @KafkaListener(
      topics = "${persimmon.outbox.topic:persimmon-outbox}",
      groupId = "${persimmon.outbox.kafka.consumer.group-id:persimmon-outbox-consumer}",
      concurrency = "${persimmon.outbox.kafka.consumer.concurrency:1}")
  public void onMessage(ConsumerRecord<String, String> record) throws Exception {
    Map<String, String> headers = new HashMap<>();
    for (Header h : record.headers()) {
      if (h.key() == null || h.value() == null) {
        continue;
      }
      headers.put(h.key(), new String(h.value(), StandardCharsets.UTF_8));
    }

    UUID eventId = UUID.fromString(required(headers, OutboxHeaders.EVENT_ID));
    String eventType = required(headers, OutboxHeaders.EVENT_TYPE);
    Instant occurredAt = Instant.parse(required(headers, OutboxHeaders.OCCURRED_AT));
    String aggregateType = required(headers, OutboxHeaders.AGGREGATE_TYPE);
    UUID aggregateId = UUID.fromString(required(headers, OutboxHeaders.AGGREGATE_ID));

    ConsumedEvent event =
        new ConsumedEvent(
            eventId, eventType, occurredAt, aggregateType, aggregateId, record.value(), headers);
    eventDispatcher.dispatch(event);
  }

  private static String required(Map<String, String> headers, String key) {
    String v = headers.get(key);
    if (v == null || v.isBlank()) {
      throw new IllegalArgumentException("Missing required Kafka header: " + key);
    }
    return v;
  }
}

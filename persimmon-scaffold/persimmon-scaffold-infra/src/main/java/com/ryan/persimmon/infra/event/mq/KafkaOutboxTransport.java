package com.ryan.persimmon.infra.event.mq;

import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.model.OutboxHeaders;
import com.ryan.persimmon.app.common.outbox.port.OutboxTransport;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.kafka.core.KafkaTemplate;

/** Kafka implementation of {@link OutboxTransport}. */
public class KafkaOutboxTransport implements OutboxTransport {
  private final KafkaTemplate<String, String> kafkaTemplate;
  private final String topic;
  private final Duration sendTimeout;

  public KafkaOutboxTransport(
      KafkaTemplate<String, String> kafkaTemplate, String topic, Duration sendTimeout) {
    this.kafkaTemplate = kafkaTemplate;
    this.topic = topic;
    this.sendTimeout = sendTimeout;
  }

  @Override
  public void publish(OutboxMessage message) throws Exception {
    String key = message.eventId().toString();
    ProducerRecord<String, String> record = new ProducerRecord<>(topic, key, message.payload());

    addHeader(record, OutboxHeaders.EVENT_ID, message.eventId().toString());
    addHeader(record, OutboxHeaders.EVENT_TYPE, message.eventType());
    addHeader(record, OutboxHeaders.OCCURRED_AT, message.occurredAt().toString());
    addHeader(record, OutboxHeaders.AGGREGATE_TYPE, message.aggregateType());
    addHeader(record, OutboxHeaders.AGGREGATE_ID, message.aggregateId().toString());

    for (Map.Entry<String, String> e : message.headers().entrySet()) {
      if (e.getKey() == null || e.getKey().isBlank() || e.getValue() == null) {
        continue;
      }
      addHeader(record, e.getKey(), e.getValue());
    }

    // Block until broker acknowledges the send (or timeout) to keep outbox marking consistent.
    kafkaTemplate.send(record).get(sendTimeout.toMillis(), TimeUnit.MILLISECONDS);
  }

  private static void addHeader(ProducerRecord<String, String> record, String key, String value) {
    record.headers().add(key, value.getBytes(StandardCharsets.UTF_8));
  }
}

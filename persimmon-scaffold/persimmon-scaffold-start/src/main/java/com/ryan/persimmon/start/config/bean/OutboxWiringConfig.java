package com.ryan.persimmon.start.config.bean;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxEventTypeResolver;
import com.ryan.persimmon.app.common.outbox.port.OutboxPayloadSerializer;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.outbox.port.OutboxTransport;
import com.ryan.persimmon.app.common.outbox.retry.ExponentialBackoffRetryPolicy;
import com.ryan.persimmon.app.common.outbox.retry.RetryPolicy;
import com.ryan.persimmon.app.common.outbox.service.DomainEventOutboxService;
import com.ryan.persimmon.app.common.outbox.service.OutboxRelayService;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.infra.event.outbox.mapper.OutboxEventMapper;
import com.ryan.persimmon.infra.event.outbox.store.MybatisOutboxStore;
import com.ryan.persimmon.infra.event.mq.KafkaOutboxTransport;
import java.time.Duration;
import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;

@Configuration
public class OutboxWiringConfig {

  @Bean
  public AppClock appClock() {
    return Instant::now;
  }

  @Bean
  public RetryPolicy outboxRetryPolicy(
      @Value("${persimmon.outbox.retry.base-seconds:1}") long baseSeconds,
      @Value("${persimmon.outbox.retry.max-seconds:300}") long maxSeconds) {
    return new ExponentialBackoffRetryPolicy(
        Duration.ofSeconds(baseSeconds), Duration.ofSeconds(maxSeconds));
  }

  @Bean
  public OutboxPayloadSerializer outboxPayloadSerializer(ObjectMapper objectMapper) {
    return event -> {
      try {
        return objectMapper.writeValueAsString(event);
      } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
        throw new IllegalStateException("Failed to serialize domain event to outbox payload.", e);
      }
    };
  }

  @Bean
  public OutboxEventTypeResolver outboxEventTypeResolver() {
    return event -> {
      com.ryan.persimmon.domain.common.event.DomainEventType ann =
          event.getClass().getAnnotation(com.ryan.persimmon.domain.common.event.DomainEventType.class);
      return ann != null && !ann.value().isBlank() ? ann.value() : event.getClass().getName();
    };
  }

  @Bean
  @ConditionalOnProperty(name = "persimmon.outbox.transport", havingValue = "kafka")
  public OutboxTransport kafkaOutboxTransport(
      KafkaTemplate<String, String> kafkaTemplate,
      @Value("${persimmon.outbox.kafka.topic:persimmon-outbox}") String topic,
      @Value("${persimmon.outbox.kafka.send-timeout-ms:5000}") long sendTimeoutMs) {
    return new KafkaOutboxTransport(kafkaTemplate, topic, Duration.ofMillis(sendTimeoutMs));
  }

  @Bean
  @ConditionalOnMissingBean(OutboxTransport.class)
  public OutboxTransport defaultOutboxTransport() {
    return new LoggingOutboxTransport();
  }

  @Bean
  public OutboxStore outboxStore(
      OutboxEventMapper outboxEventMapper,
      ObjectMapper objectMapper,
      AppClock clock,
      @Value("${persimmon.outbox.relay.worker-id:local}") String workerId,
      @Value("${persimmon.outbox.relay.lease-seconds:30}") long leaseSeconds) {
    return new MybatisOutboxStore(
        outboxEventMapper, objectMapper, clock, workerId, Duration.ofSeconds(leaseSeconds));
  }

  @Bean
  public DomainEventOutboxService domainEventOutboxService(
      OutboxStore outboxStore,
      OutboxPayloadSerializer outboxPayloadSerializer,
      OutboxEventTypeResolver outboxEventTypeResolver) {
    return new DomainEventOutboxService(outboxStore, outboxPayloadSerializer, outboxEventTypeResolver);
  }

  @Bean
  public OutboxRelayService outboxRelayService(
      OutboxStore outboxStore,
      OutboxTransport outboxTransport,
      RetryPolicy retryPolicy,
      AppClock clock,
      @Value("${persimmon.outbox.retry.max-attempts:10}") int maxAttempts) {
    return new OutboxRelayService(outboxStore, outboxTransport, retryPolicy, clock, maxAttempts);
  }

  @Slf4j
  static final class LoggingOutboxTransport implements OutboxTransport {
    @Override
    public void publish(OutboxMessage message) {
      log.info(
          "Outbox publish (noop): eventId={}, aggregateType={}, aggregateId={}, eventType={}",
          message.eventId(),
          message.aggregateType(),
          message.aggregateId(),
          message.eventType());
    }
  }
}

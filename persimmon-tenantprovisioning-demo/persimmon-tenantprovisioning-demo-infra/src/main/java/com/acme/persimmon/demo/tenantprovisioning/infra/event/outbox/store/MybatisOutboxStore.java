package com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.OutboxMessage;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port.OutboxStore;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.retry.RetryPolicy;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.mapper.OutboxEventMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.po.OutboxEventPO;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

/** MyBatis-based outbox store implementation. */
public class MybatisOutboxStore implements OutboxStore {
  private static final TypeReference<Map<String, String>> HEADERS_TYPE = new TypeReference<>() {};

  private final OutboxEventMapper mapper;
  private final ObjectMapper objectMapper;
  private final AppClock clock;
  private final String workerId;
  private final Duration lease;
  private final RetryPolicy retryPolicy;
  private final int maxAttempts;

  public MybatisOutboxStore(
      OutboxEventMapper mapper,
      ObjectMapper objectMapper,
      AppClock clock,
      String workerId,
      Duration lease,
      RetryPolicy retryPolicy,
      int maxAttempts) {
    this.mapper = mapper;
    this.objectMapper = objectMapper;
    this.clock = clock;
    this.workerId = workerId;
    this.lease = lease;
    this.retryPolicy = retryPolicy;
    this.maxAttempts = maxAttempts;
  }

  @Override
  public void append(List<OutboxMessage> messages) {
    if (messages == null || messages.isEmpty()) {
      return;
    }
    Instant now = clock.now();
    List<OutboxEventPO> batch = new ArrayList<>(messages.size());
    for (OutboxMessage message : messages) {
      OutboxEventPO po = new OutboxEventPO();
      po.setEventId(message.eventId());
      po.setOccurredAt(message.occurredAt());
      po.setAggregateType(message.aggregateType());
      po.setAggregateId(message.aggregateId());
      po.setEventType(message.eventType());
      po.setPayload(message.payload());
      po.setHeaders(serializeHeaders(message.headers()));
      po.setStatus("READY");
      po.setAttempts(0);
      po.setNextRetryAt(null);
      po.setSentAt(null);
      po.setDeadAt(null);
      po.setLockedBy(null);
      po.setLockedUntil(null);
      po.setLastError(null);
      po.setCreatedAt(now);
      po.setUpdatedAt(now);
      batch.add(po);
    }
    mapper.insertBatch(batch);
  }

  @Override
  @Transactional
  public List<OutboxMessage> claimNextBatch(int batchSize, Instant now) {
    requeueExpiredLeases(batchSize, now);

    List<OutboxEventPO> locked = mapper.lockNextBatchForSending(now, batchSize);
    if (locked.isEmpty()) {
      return List.of();
    }

    Instant lockedUntil = now.plus(lease);
    for (OutboxEventPO po : locked) {
      int updated = mapper.markSending(po.getEventId(), workerId, lockedUntil, now);
      if (updated != 1) {
        throw new IllegalStateException("Failed to mark outbox event SENDING: " + po.getEventId());
      }
    }

    List<OutboxMessage> result = new ArrayList<>(locked.size());
    for (OutboxEventPO po : locked) {
      result.add(
          new OutboxMessage(
              po.getEventId(),
              po.getOccurredAt(),
              po.getAggregateType(),
              po.getAggregateId(),
              po.getEventType(),
              po.getPayload(),
              deserializeHeaders(po.getHeaders()),
              po.getAttempts() == null ? 0 : po.getAttempts()));
    }
    return result;
  }

  @Override
  public void markSent(UUID eventId, Instant sentAt) {
    // Late updates must not overwrite newer state (e.g., reclaimed lease by another worker).
    mapper.markSent(eventId, workerId, sentAt, sentAt);
  }

  @Override
  public void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError) {
    // Late updates must not overwrite newer state (e.g., reclaimed lease by another worker).
    mapper.markFailed(eventId, now, nextRetryAt, lastError, workerId);
  }

  @Override
  public void markDead(UUID eventId, Instant now, String lastError) {
    // Late updates must not overwrite newer state (e.g., reclaimed lease by another worker).
    mapper.markDead(eventId, now, lastError, workerId);
  }

  private Map<String, String> deserializeHeaders(String headersJson) {
    if (headersJson == null || headersJson.isBlank()) {
      return Map.of();
    }
    try {
      return objectMapper.readValue(headersJson, HEADERS_TYPE);
    } catch (JsonProcessingException e) {
      return Map.of();
    }
  }

  private String serializeHeaders(Map<String, String> headers) {
    if (headers == null || headers.isEmpty()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(headers);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize outbox headers.", e);
    }
  }

  private void requeueExpiredLeases(int batchSize, Instant now) {
    if (batchSize <= 0) {
      return;
    }
    List<OutboxEventPO> expired = mapper.lockExpiredSendingBatch(now, batchSize);
    for (OutboxEventPO po : expired) {
      int attempts = po.getAttempts() == null ? 0 : po.getAttempts();
      int nextAttempt = attempts + 1;
      if (nextAttempt >= maxAttempts) {
        mapper.markLeaseExpiredDead(po.getEventId(), now);
        continue;
      }
      Instant nextRetryAt = now.plus(retryPolicy.nextBackoff(nextAttempt));
      mapper.markLeaseExpiredReady(po.getEventId(), now, nextRetryAt);
    }
  }
}

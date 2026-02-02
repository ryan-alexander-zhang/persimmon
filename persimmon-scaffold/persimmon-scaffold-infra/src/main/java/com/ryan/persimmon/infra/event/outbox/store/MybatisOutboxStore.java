package com.ryan.persimmon.infra.event.outbox.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.infra.event.outbox.mapper.OutboxEventMapper;
import com.ryan.persimmon.infra.event.outbox.po.OutboxEventPO;
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

  public MybatisOutboxStore(
      OutboxEventMapper mapper,
      ObjectMapper objectMapper,
      AppClock clock,
      String workerId,
      Duration lease) {
    this.mapper = mapper;
    this.objectMapper = objectMapper;
    this.clock = clock;
    this.workerId = workerId;
    this.lease = lease;
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
    mapper.releaseExpiredLocks(now);

    List<OutboxEventPO> locked = mapper.lockNextBatchForSending(now, batchSize);
    if (locked.isEmpty()) {
      return List.of();
    }

    Instant lockedUntil = now.plus(lease);
    for (OutboxEventPO po : locked) {
      mapper.markSending(po.getEventId(), workerId, lockedUntil, now);
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
    mapper.markSent(eventId, sentAt);
  }

  @Override
  public void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError) {
    mapper.markFailed(eventId, now, nextRetryAt, lastError);
  }

  @Override
  public void markDead(UUID eventId, Instant now, String lastError) {
    mapper.markDead(eventId, now, lastError);
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
}

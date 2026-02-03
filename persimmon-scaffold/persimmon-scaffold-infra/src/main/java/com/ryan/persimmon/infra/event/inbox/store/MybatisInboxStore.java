package com.ryan.persimmon.infra.event.inbox.store;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import com.ryan.persimmon.app.common.event.port.InboxStore;
import com.ryan.persimmon.infra.event.inbox.mapper.InboxEventMapper;
import com.ryan.persimmon.infra.event.inbox.po.InboxEventPO;
import java.time.Instant;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;

/** MyBatis-based inbox store implementation. */
public class MybatisInboxStore implements InboxStore {
  private final InboxEventMapper mapper;

  public MybatisInboxStore(InboxEventMapper mapper) {
    this.mapper = mapper;
  }

  @Override
  public boolean tryStart(ConsumedEvent event, String consumerName, Instant startedAt) {
    InboxEventPO po = new InboxEventPO();
    po.setId(UUID.randomUUID());
    po.setEventId(event.eventId());
    po.setConsumerName(consumerName);
    po.setEventType(event.eventType());
    po.setOccurredAt(event.occurredAt());
    po.setAggregateType(event.aggregateType());
    po.setAggregateId(event.aggregateId());
    po.setStatus("PROCESSING");
    po.setStartedAt(startedAt);
    po.setProcessedAt(null);
    po.setDeadAt(null);
    po.setLastError(null);
    po.setCreatedAt(startedAt);
    po.setUpdatedAt(startedAt);

    try {
      mapper.insert(po);
      return true;
    } catch (DuplicateKeyException ignore) {
      // already exists: allow retry only if status is FAILED.
      return mapper.tryClaimFailed(event.eventId(), consumerName, startedAt) == 1;
    }
  }

  @Override
  public void markProcessed(UUID eventId, String consumerName, Instant processedAt) {
    mapper.markProcessed(eventId, consumerName, processedAt);
  }

  @Override
  public void markFailed(UUID eventId, String consumerName, Instant failedAt, String lastError) {
    mapper.markFailed(eventId, consumerName, failedAt, lastError);
  }

  @Override
  public void markDead(UUID eventId, String consumerName, Instant deadAt, String lastError) {
    mapper.markDead(eventId, consumerName, deadAt, lastError);
  }
}

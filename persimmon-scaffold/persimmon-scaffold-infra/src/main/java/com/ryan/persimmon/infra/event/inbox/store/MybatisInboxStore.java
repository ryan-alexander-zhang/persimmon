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
  public boolean isProcessed(UUID eventId, String consumerName) {
    return mapper.countByEventAndConsumer(eventId, consumerName) > 0;
  }

  @Override
  public void markProcessed(ConsumedEvent event, String consumerName, Instant processedAt) {
    InboxEventPO po = new InboxEventPO();
    po.setId(UUID.randomUUID());
    po.setEventId(event.eventId());
    po.setConsumerName(consumerName);
    po.setEventType(event.eventType());
    po.setOccurredAt(event.occurredAt());
    po.setAggregateType(event.aggregateType());
    po.setAggregateId(event.aggregateId());
    po.setProcessedAt(processedAt);
    po.setCreatedAt(processedAt);
    po.setUpdatedAt(processedAt);

    try {
      mapper.insert(po);
    } catch (DuplicateKeyException ignore) {
      // already processed by this consumer; ignore
    }
  }
}

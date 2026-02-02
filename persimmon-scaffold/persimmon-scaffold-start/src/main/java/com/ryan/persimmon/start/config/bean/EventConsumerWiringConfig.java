package com.ryan.persimmon.start.config.bean;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import com.ryan.persimmon.app.common.event.port.EventDispatcher;
import com.ryan.persimmon.app.common.event.port.EventHandler;
import com.ryan.persimmon.app.common.event.port.InboxStore;
import com.ryan.persimmon.app.common.event.service.DefaultEventDispatcher;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.infra.event.inbox.mapper.InboxEventMapper;
import com.ryan.persimmon.infra.event.inbox.store.MybatisInboxStore;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
public class EventConsumerWiringConfig {

  @Bean
  public InboxStore inboxStore(InboxEventMapper inboxEventMapper) {
    return new MybatisInboxStore(inboxEventMapper);
  }

  /**
   * Default dispatcher implementation.
   *
   * <p>Production applications should replace this with a real dispatcher that routes by {@code
   * eventType} to application handlers and enforces idempotency.
   */
  @Bean
  @ConditionalOnBean(EventHandler.class)
  public EventDispatcher defaultEventDispatcher(
      InboxStore inboxStore,
      AppClock clock,
      @Value("${persimmon.outbox.kafka.consumer.group-id:persimmon-outbox-consumer}") String consumerName,
      List<EventHandler> handlers,
      PlatformTransactionManager txManager) {
    DefaultEventDispatcher delegate = new DefaultEventDispatcher(inboxStore, clock, consumerName, handlers);
    TransactionTemplate tx = new TransactionTemplate(txManager);
    return event -> tx.executeWithoutResult(status -> {
      try {
        delegate.dispatch(event);
      } catch (RuntimeException e) {
        throw e;
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    });
  }

  @Bean
  @ConditionalOnMissingBean(EventDispatcher.class)
  public EventDispatcher loggingEventDispatcher() {
    return new LoggingEventDispatcher();
  }

  @Slf4j
  static final class LoggingEventDispatcher implements EventDispatcher {
    @Override
    public void dispatch(ConsumedEvent event) {
      log.info(
          "Consumed event (noop): eventId={}, eventType={}, aggregateType={}, aggregateId={}",
          event.eventId(),
          event.eventType(),
          event.aggregateType(),
          event.aggregateId());
    }
  }
}

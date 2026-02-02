package com.ryan.persimmon.adapter.scheduler.system.job;

import com.ryan.persimmon.app.common.outbox.service.OutboxRelayService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OutboxRelayJob {
  private final OutboxRelayService outboxRelayService;
  private final int batchSize;

  public OutboxRelayJob(
      OutboxRelayService outboxRelayService,
      @Value("${persimmon.outbox.relay.batch-size:100}") int batchSize) {
    this.outboxRelayService = outboxRelayService;
    this.batchSize = batchSize;
  }

  @Scheduled(fixedDelayString = "${persimmon.outbox.relay.fixed-delay-ms:1000}")
  public void run() {
    outboxRelayService.relayOnce(batchSize);
  }
}

package com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.baomidou.mybatisplus.test.autoconfigure.MybatisPlusTest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.OutboxMessage;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.retry.ExponentialBackoffRetryPolicy;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.retry.RetryPolicy;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AutoFillObjectHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.MybatisPlusConfig;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.UuidTypeHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.mapper.OutboxEventMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase.Replace;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

@MybatisPlusTest(
    properties = {
      "spring.test.database.replace=none",
      "spring.datasource.url=jdbc:postgresql://localhost:5432/persimmon_scaffold",
      "spring.datasource.username=postgres",
      "spring.datasource.password=postgres",
      "spring.datasource.driver-class-name=org.postgresql.Driver",
      "spring.sql.init.mode=always",
      "spring.sql.init.schema-locations=classpath:db/migration/V1.0.1__outbox_event.sql,classpath:db/migration/V1.0.2__outbox_event_ready_dead.sql"
    })
@AutoConfigureTestDatabase(replace = Replace.NONE)
@Import({
  OutboxStoreIT.MapperConfig.class,
  UuidTypeHandler.class,
  AutoFillObjectHandler.class,
  MybatisPlusConfig.class
})
class OutboxStoreIT {

  @Autowired private OutboxEventMapper outboxEventMapper;
  @Autowired private JdbcTemplate jdbcTemplate;

  @Test
  void late_updates_must_not_overwrite_reclaimed_send_state() {
    Instant t0 = Instant.parse("2026-02-03T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fd0");
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fd1");

    jdbcTemplate.update("delete from outbox_event where event_id = ?", eventId);
    jdbcTemplate.update(
        """
        insert into outbox_event (
          event_id, occurred_at, aggregate_type, aggregate_id, event_type,
          payload, headers, status, attempts, next_retry_at, sent_at, dead_at,
          locked_by, locked_until, last_error, created_at, updated_at
        ) values (?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?,?)
        """,
        eventId,
        java.sql.Timestamp.from(t0),
        "Agg",
        aggregateId,
        "evt.x",
        "{}",
        null,
        "READY",
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        java.sql.Timestamp.from(t0),
        java.sql.Timestamp.from(t0));

    ObjectMapper objectMapper = new ObjectMapper();
    RetryPolicy retryPolicy = new ExponentialBackoffRetryPolicy(Duration.ofSeconds(5), Duration.ofSeconds(60));
    int maxAttempts = 10;

    // Worker A claims with a short lease (1s).
    AppClock clockA = () -> t0;
    MybatisOutboxStore storeA =
        new MybatisOutboxStore(outboxEventMapper, objectMapper, clockA, "worker-a", Duration.ofSeconds(1), retryPolicy, maxAttempts);

    List<OutboxMessage> aBatch = storeA.claimNextBatch(10, t0);
    assertEquals(1, aBatch.size());
    assertEquals("SENDING", status(eventId));
    assertEquals("worker-a", lockedBy(eventId));

    // Lease expires; store should count it as a failure and apply backoff.
    Instant t2 = t0.plusSeconds(2);
    AppClock clockB = () -> t2;
    MybatisOutboxStore storeB =
        new MybatisOutboxStore(outboxEventMapper, objectMapper, clockB, "worker-b", Duration.ofSeconds(30), retryPolicy, maxAttempts);

    List<OutboxMessage> bBatch0 = storeB.claimNextBatch(10, t2);
    assertEquals(0, bBatch0.size());
    assertEquals("READY", status(eventId));
    assertEquals(1, attempts(eventId));
    assertEquals("LEASE_EXPIRED", lastError(eventId));
    assertEquals(t2.plusSeconds(5), nextRetryAt(eventId));

    // After backoff is due, worker B claims and sends successfully.
    Instant t7 = t2.plusSeconds(5);
    List<OutboxMessage> bBatch1 = storeB.claimNextBatch(10, t7);
    assertEquals(1, bBatch1.size());
    assertEquals("SENDING", status(eventId));
    assertEquals("worker-b", lockedBy(eventId));

    storeB.markSent(eventId, t7);
    assertEquals("SENT", status(eventId));
    assertNull(lockedBy(eventId));
    assertNull(lockedUntil(eventId));
    assertNull(lastError(eventId));
    assertNull(nextRetryAt(eventId));

    // Worker A finishes late and tries to markFailed; must NOT flip SENT back to READY.
    storeA.markFailed(eventId, t7, t7.plusSeconds(10), "late-fail");
    assertEquals("SENT", status(eventId));
    assertNull(nextRetryAt(eventId));
    assertNull(lastError(eventId));
  }

  private String status(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select status from outbox_event where event_id = ?",
        String.class,
        eventId);
  }

  private String lockedBy(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select locked_by from outbox_event where event_id = ?",
        String.class,
        eventId);
  }

  private Instant lockedUntil(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select locked_until from outbox_event where event_id = ?",
        Instant.class,
        eventId);
  }

  private Integer attempts(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select attempts from outbox_event where event_id = ?",
        Integer.class,
        eventId);
  }

  private String lastError(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select last_error from outbox_event where event_id = ?",
        String.class,
        eventId);
  }

  private Instant nextRetryAt(UUID eventId) {
    return jdbcTemplate.queryForObject(
        "select next_retry_at from outbox_event where event_id = ?",
        Instant.class,
        eventId);
  }

  @Configuration
  @MapperScan("com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox.mapper")
  static class MapperConfig {}
}

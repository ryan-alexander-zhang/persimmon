package com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.store;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.baomidou.mybatisplus.test.autoconfigure.MybatisPlusTest;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTask;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStore;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstanceStatus;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowStepStatus;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AutoFillObjectHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.MybatisPlusConfig;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.UuidTypeHandler;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowInstanceMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowStepMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
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
      "spring.sql.init.schema-locations=classpath:db/migration/V1.0.4__workflow_instance_step.sql"
    })
@AutoConfigureTestDatabase(replace = Replace.NONE)
@Import({
  WorkflowStoreIT.MapperConfig.class,
  UuidTypeHandler.class,
  AutoFillObjectHandler.class,
  MybatisPlusConfig.class
})
@EnabledIfSystemProperty(named = "it.postgres", matches = "true")
class WorkflowStoreIT {
  @Autowired private WorkflowInstanceMapper instanceMapper;
  @Autowired private WorkflowStepMapper stepMapper;
  @Autowired private JdbcTemplate jdbcTemplate;

  @Test
  void workflowStore_endToEndTransitions_work() {
    Instant now = Instant.parse("2026-02-03T00:00:00Z");
    String workerId = "it-worker-01";
    Duration lease = Duration.ofSeconds(10);
    WorkflowStore store = new MybatisWorkflowStore(instanceMapper, stepMapper, workerId, lease);

    UUID instanceId = UUID.randomUUID();
    store.insertInstance(
        instanceId,
        "biz-1",
        "demo",
        1,
        WorkflowInstanceStatus.RUNNING,
        "{\"k\":\"v\"}",
        0,
        "s1",
        now,
        now);

    store.insertSteps(
        List.of(
            new WorkflowStore.WorkflowStepToInsert(
                instanceId, 0, "s1", WorkflowStepStatus.READY, 3, now, now),
            new WorkflowStore.WorkflowStepToInsert(
                instanceId, 1, "s2", WorkflowStepStatus.PENDING, 3, null, now),
            new WorkflowStore.WorkflowStepToInsert(
                instanceId, 2, "s3", WorkflowStepStatus.WAITING, 3, null, now)));

    // Seed a timed-out WAITING step.
    jdbcTemplate.update(
        "update workflow_step set deadline_at = ? where instance_id = ? and step_seq = ?",
        java.sql.Timestamp.from(now.minusSeconds(1)),
        instanceId,
        2);

    assertTrue(store.stepExists(instanceId, 0));
    assertEquals("s1", store.getStepType(instanceId, 0));

    // READY -> RUNNING via claim
    List<WorkflowTask> tasks = store.claimNextReadySteps(10, now);
    assertEquals(1, tasks.size());
    assertEquals(WorkflowTaskType.READY_STEP, tasks.getFirst().type());
    assertEquals(0, tasks.getFirst().stepSeq());
    assertEquals("RUNNING", stepStatus(instanceId, 0));
    assertEquals(workerId, stepLockedBy(instanceId, 0));

    // RUNNING -> WAITING, then WAITING -> READY via wake-up
    store.markStepWaiting(instanceId, 0, "evt.x", now.plusSeconds(5), now);
    assertEquals("WAITING", stepStatus(instanceId, 0));
    assertEquals("evt.x", stepWaitingEventType(instanceId, 0));
    assertEquals(null, stepLockedBy(instanceId, 0));

    assertTrue(store.wakeUpWaitingStep(instanceId, "evt.x", now));
    assertEquals("READY", stepStatus(instanceId, 0));
    assertEquals(null, stepWaitingEventType(instanceId, 0));

    // READY -> RUNNING again, then schedule retry
    tasks = store.claimNextReadySteps(10, now);
    assertEquals(1, tasks.size());
    assertEquals(0, tasks.getFirst().attempts());
    assertEquals("RUNNING", stepStatus(instanceId, 0));

    Instant retryAt = now.plusSeconds(30);
    store.markStepRetry(instanceId, 0, retryAt, "boom", now);
    assertEquals("READY", stepStatus(instanceId, 0));
    assertEquals(1, stepAttempts(instanceId, 0));
    assertEquals("boom", stepLastError(instanceId, 0));

    // not claimable before retryAt
    assertEquals(0, store.claimNextReadySteps(10, now.plusSeconds(10)).size());

    // claimable after retryAt
    Instant afterRetryAt = retryAt.plusSeconds(1);
    tasks = store.claimNextReadySteps(10, afterRetryAt);
    assertEquals(1, tasks.size());
    assertEquals(1, tasks.getFirst().attempts());
    assertEquals("RUNNING", stepStatus(instanceId, 0));

    // RUNNING -> DONE
    store.markStepDone(instanceId, 0, afterRetryAt);
    assertEquals("DONE", stepStatus(instanceId, 0));
    assertEquals(null, stepLockedBy(instanceId, 0));

    // PENDING -> READY, then claim next step
    assertTrue(store.activatePendingStep(instanceId, 1, afterRetryAt));
    assertEquals("READY", stepStatus(instanceId, 1));
    tasks = store.claimNextReadySteps(10, afterRetryAt);
    assertEquals(1, tasks.size());
    assertEquals(1, tasks.getFirst().stepSeq());

    // WAITING timeout claim produces WAITING_TIMEOUT task
    tasks = store.claimNextTimedOutWaitingSteps(10, now);
    assertEquals(1, tasks.size());
    assertEquals(WorkflowTaskType.WAITING_TIMEOUT, tasks.getFirst().type());
    assertEquals(2, tasks.getFirst().stepSeq());
    assertEquals("RUNNING", stepStatus(instanceId, 2));

    // lease expiry: RUNNING with locked_until < now => READY + attempts++
    jdbcTemplate.update(
        "update workflow_step set locked_until = ? where instance_id = ? and step_seq = ?",
        java.sql.Timestamp.from(now.minusSeconds(1)),
        instanceId,
        2);
    store.releaseExpiredLeases(now);
    assertEquals("READY", stepStatus(instanceId, 2));
    assertEquals(1, stepAttempts(instanceId, 2));
    assertEquals("LEASE_EXPIRED", stepLastError(instanceId, 2));

    // instance row is readable
    WorkflowInstance instance = store.loadInstanceForUpdate(instanceId);
    assertNotNull(instance);
    assertEquals("demo", instance.getWorkflowType());
  }

  private String stepStatus(UUID instanceId, int stepSeq) {
    return jdbcTemplate.queryForObject(
        "select status from workflow_step where instance_id = ? and step_seq = ?",
        String.class,
        instanceId,
        stepSeq);
  }

  private String stepLockedBy(UUID instanceId, int stepSeq) {
    return jdbcTemplate.queryForObject(
        "select locked_by from workflow_step where instance_id = ? and step_seq = ?",
        String.class,
        instanceId,
        stepSeq);
  }

  private String stepWaitingEventType(UUID instanceId, int stepSeq) {
    return jdbcTemplate.queryForObject(
        "select waiting_event_type from workflow_step where instance_id = ? and step_seq = ?",
        String.class,
        instanceId,
        stepSeq);
  }

  private Integer stepAttempts(UUID instanceId, int stepSeq) {
    return jdbcTemplate.queryForObject(
        "select attempts from workflow_step where instance_id = ? and step_seq = ?",
        Integer.class,
        instanceId,
        stepSeq);
  }

  private String stepLastError(UUID instanceId, int stepSeq) {
    return jdbcTemplate.queryForObject(
        "select last_error from workflow_step where instance_id = ? and step_seq = ?",
        String.class,
        instanceId,
        stepSeq);
  }

  @Configuration
  @MapperScan("com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper")
  static class MapperConfig {}
}

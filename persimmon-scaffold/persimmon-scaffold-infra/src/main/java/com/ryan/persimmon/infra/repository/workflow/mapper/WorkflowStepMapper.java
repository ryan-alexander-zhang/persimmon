package com.ryan.persimmon.infra.repository.workflow.mapper;

import com.ryan.persimmon.infra.repository.workflow.po.WorkflowStepPO;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface WorkflowStepMapper {

  @org.apache.ibatis.annotations.Insert(
      """
      <script>
      insert into workflow_step (
        instance_id,
        step_seq,
        step_type,
        status,
        attempts,
        max_attempts,
        next_run_at,
        waiting_event_type,
        deadline_at,
        locked_by,
        locked_until,
        last_error,
        created_at,
        updated_at
      ) values
      <foreach collection="list" item="it" separator=",">
        (
          #{it.instanceId},
          #{it.stepSeq},
          #{it.stepType},
          #{it.status},
          #{it.attempts},
          #{it.maxAttempts},
          #{it.nextRunAt},
          #{it.waitingEventType},
          #{it.deadlineAt},
          #{it.lockedBy},
          #{it.lockedUntil},
          #{it.lastError},
          #{it.createdAt},
          #{it.updatedAt}
        )
      </foreach>
      on conflict (instance_id, step_seq) do nothing
      </script>
      """)
  int insertBatchIfAbsent(@Param("list") List<WorkflowStepPO> list);

  @Insert(
      """
      insert into workflow_step (
        instance_id,
        step_seq,
        step_type,
        status,
        attempts,
        max_attempts,
        next_run_at,
        waiting_event_type,
        deadline_at,
        locked_by,
        locked_until,
        last_error,
        created_at,
        updated_at
      ) values (
        #{it.instanceId},
        #{it.stepSeq},
        #{it.stepType},
        #{it.status},
        #{it.attempts},
        #{it.maxAttempts},
        #{it.nextRunAt},
        #{it.waitingEventType},
        #{it.deadlineAt},
        #{it.lockedBy},
        #{it.lockedUntil},
        #{it.lastError},
        #{it.createdAt},
        #{it.updatedAt}
      )
      on conflict (instance_id, step_seq) do nothing
      """)
  int insertIfAbsent(@Param("it") WorkflowStepPO it);

  @Select(
      """
      select
        instance_id,
        step_seq,
        step_type,
        attempts,
        max_attempts,
        status,
        next_run_at,
        waiting_event_type,
        deadline_at,
        locked_by,
        locked_until,
        last_error,
        created_at,
        updated_at
      from workflow_step
      where status = 'READY'
        and next_run_at is not null
        and next_run_at <= #{now}
      order by next_run_at asc
      limit #{batchSize}
      for update skip locked
      """)
  List<WorkflowStepPO> lockNextReadyBatch(
      @Param("now") Instant now, @Param("batchSize") int batchSize);

  @Select(
      """
      select
        instance_id,
        step_seq,
        step_type,
        attempts,
        max_attempts
      from workflow_step
      where status = 'WAITING'
        and deadline_at is not null
        and deadline_at <= #{now}
      order by deadline_at asc
      limit #{batchSize}
      for update skip locked
      """)
  List<WorkflowStepPO> lockNextTimedOutWaitingBatch(
      @Param("now") Instant now, @Param("batchSize") int batchSize);

  @Update(
      """
      update workflow_step
      set
        status = 'RUNNING',
        locked_by = #{lockedBy},
        locked_until = #{lockedUntil},
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status in ('READY', 'WAITING')
      """)
  int markRunning(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("lockedBy") String lockedBy,
      @Param("lockedUntil") Instant lockedUntil,
      @Param("now") Instant now);

  @Select(
      """
      select count(1)
      from workflow_step
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
      """)
  long countByInstanceAndSeq(@Param("instanceId") UUID instanceId, @Param("stepSeq") int stepSeq);

  @Select(
      """
      select step_type
      from workflow_step
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
      """)
  String selectStepType(@Param("instanceId") UUID instanceId, @Param("stepSeq") int stepSeq);

  @Update(
      """
      update workflow_step
      set
        status = 'READY',
        next_run_at = #{now},
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status = 'PENDING'
      """)
  int activatePending(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'DONE',
        waiting_event_type = null,
        deadline_at = null,
        locked_by = null,
        locked_until = null,
        last_error = null,
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status = 'RUNNING'
        and locked_by = #{lockedBy}
        and (locked_until is null or locked_until >= #{now})
      """)
  int markDone(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("lockedBy") String lockedBy,
      @Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'WAITING',
        waiting_event_type = #{waitingEventType},
        deadline_at = #{deadlineAt},
        next_run_at = null,
        locked_by = null,
        locked_until = null,
        last_error = null,
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status = 'RUNNING'
        and locked_by = #{lockedBy}
        and (locked_until is null or locked_until >= #{now})
      """)
  int markWaiting(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("waitingEventType") String waitingEventType,
      @Param("deadlineAt") Instant deadlineAt,
      @Param("lockedBy") String lockedBy,
      @Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'READY',
        attempts = attempts + 1,
        next_run_at = #{nextRunAt},
        waiting_event_type = null,
        deadline_at = null,
        last_error = #{lastError},
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status = 'RUNNING'
        and locked_by = #{lockedBy}
        and (locked_until is null or locked_until >= #{now})
        and (attempts + 1) <= max_attempts
      """)
  int markRetry(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("nextRunAt") Instant nextRunAt,
      @Param("lastError") String lastError,
      @Param("lockedBy") String lockedBy,
      @Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'DEAD',
        attempts = attempts + 1,
        next_run_at = null,
        waiting_event_type = null,
        deadline_at = null,
        last_error = #{lastError},
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where instance_id = #{instanceId}
        and step_seq = #{stepSeq}
        and status = 'RUNNING'
        and locked_by = #{lockedBy}
        and (locked_until is null or locked_until >= #{now})
      """)
  int markDead(
      @Param("instanceId") UUID instanceId,
      @Param("stepSeq") int stepSeq,
      @Param("lastError") String lastError,
      @Param("lockedBy") String lockedBy,
      @Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'READY',
        attempts = attempts + 1,
        next_run_at = #{now},
        last_error = 'LEASE_EXPIRED',
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where status = 'RUNNING'
        and locked_until is not null
        and locked_until < #{now}
      """)
  int releaseExpiredLocks(@Param("now") Instant now);

  @Update(
      """
      update workflow_step
      set
        status = 'READY',
        next_run_at = #{now},
        waiting_event_type = null,
        deadline_at = null,
        updated_at = #{now}
      where instance_id = #{instanceId}
        and status = 'WAITING'
        and waiting_event_type = #{waitingEventType}
      """)
  int wakeUpWaitingStep(
      @Param("instanceId") UUID instanceId,
      @Param("waitingEventType") String waitingEventType,
      @Param("now") Instant now);
}

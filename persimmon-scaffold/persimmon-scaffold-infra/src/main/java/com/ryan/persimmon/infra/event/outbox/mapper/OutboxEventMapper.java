package com.ryan.persimmon.infra.event.outbox.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.ryan.persimmon.infra.event.outbox.po.OutboxEventPO;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface OutboxEventMapper extends BaseMapper<OutboxEventPO> {

  @org.apache.ibatis.annotations.Insert(
      """
      <script>
      insert into outbox_event (
        event_id,
        occurred_at,
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        headers,
        status,
        attempts,
        next_retry_at,
        sent_at,
        locked_by,
        locked_until,
        last_error,
        created_at,
        updated_at
      ) values
      <foreach collection="list" item="it" separator=",">
        (
          #{it.eventId},
          #{it.occurredAt},
          #{it.aggregateType},
          #{it.aggregateId},
          #{it.eventType},
          #{it.payload},
          #{it.headers},
          #{it.status},
          #{it.attempts},
          #{it.nextRetryAt},
          #{it.sentAt},
          #{it.lockedBy},
          #{it.lockedUntil},
          #{it.lastError},
          #{it.createdAt},
          #{it.updatedAt}
        )
      </foreach>
      </script>
      """)
  int insertBatch(@Param("list") List<OutboxEventPO> list);

  /**
   * Locks a batch of claimable outbox rows.
   *
   * <p>Must be called inside a transaction.
   */
  @Select(
      """
      select
        event_id,
        occurred_at,
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        headers,
        status,
        attempts,
        next_retry_at
      from outbox_event
      where status = 'READY'
        and (next_retry_at is null or next_retry_at <= #{now})
      order by occurred_at asc
      limit #{batchSize}
      for update skip locked
      """)
  List<OutboxEventPO> lockNextBatchForSending(
      @Param("now") Instant now, @Param("batchSize") int batchSize);

  @Update(
      """
      update outbox_event
      set
        status = 'SENDING',
        locked_by = #{lockedBy},
        locked_until = #{lockedUntil},
        updated_at = #{now}
      where event_id = #{eventId}
      """)
  int markSending(
      @Param("eventId") UUID eventId,
      @Param("lockedBy") String lockedBy,
      @Param("lockedUntil") Instant lockedUntil,
      @Param("now") Instant now);

  @Update(
      """
      update outbox_event
      set
        status = 'SENT',
        sent_at = #{sentAt},
        locked_by = null,
        locked_until = null,
        last_error = null,
        updated_at = #{sentAt}
      where event_id = #{eventId}
      """)
  int markSent(@Param("eventId") UUID eventId, @Param("sentAt") Instant sentAt);

  @Update(
      """
      update outbox_event
      set
        status = 'READY',
        attempts = attempts + 1,
        next_retry_at = #{nextRetryAt},
        last_error = #{lastError},
        dead_at = null,
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where event_id = #{eventId}
      """)
  int markFailed(
      @Param("eventId") UUID eventId,
      @Param("now") Instant now,
      @Param("nextRetryAt") Instant nextRetryAt,
      @Param("lastError") String lastError);

  @Update(
      """
      update outbox_event
      set
        status = 'DEAD',
        attempts = attempts + 1,
        next_retry_at = null,
        last_error = #{lastError},
        dead_at = #{now},
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where event_id = #{eventId}
      """)
  int markDead(
      @Param("eventId") UUID eventId,
      @Param("now") Instant now,
      @Param("lastError") String lastError);

  @Update(
      """
      update outbox_event
      set
        status = 'READY',
        locked_by = null,
        locked_until = null,
        updated_at = #{now}
      where status = 'SENDING'
        and locked_until is not null
        and locked_until < #{now}
      """)
  int releaseExpiredLocks(@Param("now") Instant now);
}

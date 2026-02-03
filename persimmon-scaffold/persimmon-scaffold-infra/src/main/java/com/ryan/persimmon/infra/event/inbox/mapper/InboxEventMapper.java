package com.ryan.persimmon.infra.event.inbox.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.ryan.persimmon.infra.event.inbox.po.InboxEventPO;
import java.time.Instant;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface InboxEventMapper extends BaseMapper<InboxEventPO> {

  @Select(
      """
      select count(1)
      from inbox_event
      where event_id = #{eventId}
        and consumer_name = #{consumerName}
      """)
  long countByEventAndConsumer(
      @Param("eventId") UUID eventId, @Param("consumerName") String consumerName);

  @Update(
      """
      update inbox_event
      set
        status = 'PROCESSING',
        started_at = #{startedAt},
        last_error = null,
        updated_at = #{startedAt}
      where event_id = #{eventId}
        and consumer_name = #{consumerName}
        and status = 'FAILED'
      """)
  int tryClaimFailed(
      @Param("eventId") UUID eventId,
      @Param("consumerName") String consumerName,
      @Param("startedAt") Instant startedAt);

  @Update(
      """
      update inbox_event
      set
        status = 'PROCESSED',
        processed_at = #{processedAt},
        last_error = null,
        updated_at = #{processedAt}
      where event_id = #{eventId}
        and consumer_name = #{consumerName}
        and status = 'PROCESSING'
      """)
  int markProcessed(
      @Param("eventId") UUID eventId,
      @Param("consumerName") String consumerName,
      @Param("processedAt") Instant processedAt);

  @Update(
      """
      update inbox_event
      set
        status = 'FAILED',
        processed_at = #{failedAt},
        last_error = #{lastError},
        updated_at = #{failedAt}
      where event_id = #{eventId}
        and consumer_name = #{consumerName}
        and status = 'PROCESSING'
      """)
  int markFailed(
      @Param("eventId") UUID eventId,
      @Param("consumerName") String consumerName,
      @Param("failedAt") Instant failedAt,
      @Param("lastError") String lastError);
}

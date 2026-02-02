package com.ryan.persimmon.infra.event.inbox.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.ryan.persimmon.infra.event.inbox.po.InboxEventPO;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

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
}

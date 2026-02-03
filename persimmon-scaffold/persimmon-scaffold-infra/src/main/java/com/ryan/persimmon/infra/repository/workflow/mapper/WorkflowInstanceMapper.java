package com.ryan.persimmon.infra.repository.workflow.mapper;

import com.ryan.persimmon.infra.repository.workflow.po.WorkflowInstancePO;
import java.time.Instant;
import java.util.UUID;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface WorkflowInstanceMapper {

  @Insert(
      """
      insert into workflow_instance (
        instance_id,
        biz_key,
        workflow_type,
        workflow_version,
        status,
        current_step_seq,
        current_step_type,
        context_json,
        started_at,
        completed_at,
        failed_at,
        created_at,
        updated_at
      ) values (
        #{it.instanceId},
        #{it.bizKey},
        #{it.workflowType},
        #{it.workflowVersion},
        #{it.status},
        #{it.currentStepSeq},
        #{it.currentStepType},
        #{it.contextJson},
        #{it.startedAt},
        #{it.completedAt},
        #{it.failedAt},
        #{it.createdAt},
        #{it.updatedAt}
      )
      """)
  int insert(@Param("it") WorkflowInstancePO it);

  @Select(
      """
      select
        instance_id,
        biz_key,
        workflow_type,
        workflow_version,
        status,
        current_step_seq,
        current_step_type,
        context_json,
        started_at,
        completed_at,
        failed_at,
        created_at,
        updated_at
      from workflow_instance
      where instance_id = #{instanceId}
      for update
      """)
  WorkflowInstancePO selectForUpdate(@Param("instanceId") UUID instanceId);

  @Update(
      """
      update workflow_instance
      set
        status = #{it.status},
        current_step_seq = #{it.currentStepSeq},
        current_step_type = #{it.currentStepType},
        context_json = #{it.contextJson},
        completed_at = #{it.completedAt},
        failed_at = #{it.failedAt},
        updated_at = #{now}
      where instance_id = #{it.instanceId}
      """)
  int update(@Param("it") WorkflowInstancePO it, @Param("now") Instant now);
}

package com.ryan.persimmon.start.config.bean;

import com.ryan.persimmon.app.common.id.UuidV7Generator;
import com.ryan.persimmon.app.common.outbox.service.DomainEventOutboxService;
import com.ryan.persimmon.app.common.runtime.WorkerIdProvider;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinitionProvider;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinitionRegistry;
import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStepHandler;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import com.ryan.persimmon.app.common.workflow.service.WorkflowRunner;
import com.ryan.persimmon.app.common.workflow.service.WorkflowSignalService;
import com.ryan.persimmon.app.common.workflow.service.WorkflowStartService;
import com.ryan.persimmon.app.common.workflow.service.WorkflowStepHandlerRegistry;
import com.ryan.persimmon.app.common.workflow.service.WorkflowTaskProcessor;
import com.ryan.persimmon.app.common.workflow.service.WorkflowTaskProcessorImpl;
import com.ryan.persimmon.infra.repository.workflow.mapper.WorkflowInstanceMapper;
import com.ryan.persimmon.infra.repository.workflow.mapper.WorkflowStepMapper;
import com.ryan.persimmon.infra.repository.workflow.store.MybatisWorkflowStore;
import com.ryan.persimmon.start.config.properties.WorkflowRetryProperties;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
@EnableConfigurationProperties(WorkflowRetryProperties.class)
public class WorkflowWiringConfig {

  @Bean
  public WorkflowStore workflowStore(
      WorkflowInstanceMapper instanceMapper,
      WorkflowStepMapper stepMapper,
      WorkerIdProvider workerIdProvider,
      @Value("${persimmon.workflow.lease-seconds:30}") long leaseSeconds) {
    return new MybatisWorkflowStore(instanceMapper, stepMapper, workerIdProvider.workerId(), Duration.ofSeconds(leaseSeconds));
  }

  @Bean
  public WorkflowStepHandlerRegistry workflowStepHandlerRegistry(List<WorkflowStepHandler> handlers) {
    return new WorkflowStepHandlerRegistry(handlers);
  }

  @Bean
  public WorkflowDefinitionRegistry workflowDefinitionRegistry(List<WorkflowDefinitionProvider> providers) {
    return new WorkflowDefinitionRegistry(providers);
  }

  @Bean
  public WorkflowRetryPolicy workflowRetryPolicy(WorkflowRetryProperties props) {
    return new ConfigurableWorkflowRetryPolicy(props);
  }

  @Bean
  @ConditionalOnBean({WorkflowStepHandler.class, WorkflowDefinitionProvider.class})
  public WorkflowTaskProcessor workflowTaskProcessor(
      WorkflowStore workflowStore,
      WorkflowStepHandlerRegistry handlerRegistry,
      DomainEventOutboxService outboxService,
      WorkflowRetryPolicy retryPolicy,
      AppClock clock,
      PlatformTransactionManager txManager) {
    WorkflowTaskProcessorImpl delegate =
        new WorkflowTaskProcessorImpl(workflowStore, handlerRegistry, outboxService, retryPolicy, clock);
    TransactionTemplate tx = new TransactionTemplate(txManager);
    return task -> tx.executeWithoutResult(status -> delegate.process(task));
  }

  @Bean
  @ConditionalOnBean({WorkflowStepHandler.class, WorkflowDefinitionProvider.class})
  public WorkflowRunner workflowRunner(WorkflowStore workflowStore, WorkflowTaskProcessor taskProcessor, AppClock clock) {
    return new WorkflowRunner(workflowStore, taskProcessor, clock);
  }

  @Bean
  @ConditionalOnBean(WorkflowDefinitionProvider.class)
  public WorkflowStartService workflowStartService(
      WorkflowStore workflowStore,
      WorkflowDefinitionRegistry definitionRegistry,
      UuidV7Generator uuidV7Generator,
      WorkflowRetryPolicy retryPolicy,
      AppClock clock) {
    return new WorkflowStartService(workflowStore, definitionRegistry, uuidV7Generator, retryPolicy, clock);
  }

  @Bean
  public WorkflowSignalService workflowSignalService(WorkflowStore workflowStore, AppClock clock) {
    return new WorkflowSignalService(workflowStore, clock);
  }

}

package com.acme.persimmon.demo.tenantprovisioning.start.config.bean;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.command.handler.CreateTenantCommandHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.event.handler.HarborProjectReadyEventHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.port.out.TenantQueryPort;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.service.TenantQueryService;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.definition.TenantProvisioningWorkflowDefinitionProvider;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step.HarborCreateProjectStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step.HarborCreateRobotStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step.K8sCreateNamespaceStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step.K8sCreateSecretStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step.TenantMarkActiveStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.common.event.port.EventHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.common.id.UuidV7Generator;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.service.DomainEventOutboxService;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.definition.WorkflowDefinitionProvider;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.service.WorkflowSignalService;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.service.WorkflowStartService;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway.HarborGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway.KubernetesGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.repository.TenantRepository;
import com.acme.persimmon.demo.tenantprovisioning.infra.gateway.harbor.MockHarborGateway;
import com.acme.persimmon.demo.tenantprovisioning.infra.gateway.kubernetes.MockKubernetesGateway;
import com.acme.persimmon.demo.tenantprovisioning.infra.query.tenant.impl.MybatisTenantQueryPort;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper.TenantMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.repository.MybatisTenantRepository;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowInstanceMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowStepMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TenantDemoWiringConfig {

  @Bean
  public TenantProvisioningContextCodec tenantProvisioningContextCodec(ObjectMapper objectMapper) {
    return new TenantProvisioningContextCodec(objectMapper);
  }

  @Bean
  public HarborGateway harborGateway() {
    return new MockHarborGateway();
  }

  @Bean
  public KubernetesGateway kubernetesGateway() {
    return new MockKubernetesGateway();
  }

  @Bean
  public TenantRepository tenantRepository(TenantMapper tenantMapper) {
    return new MybatisTenantRepository(tenantMapper);
  }

  @Bean
  public TenantQueryPort tenantQueryPort(
      TenantMapper tenantMapper,
      WorkflowInstanceMapper workflowInstanceMapper,
      WorkflowStepMapper workflowStepMapper) {
    return new MybatisTenantQueryPort(tenantMapper, workflowInstanceMapper, workflowStepMapper);
  }

  @Bean
  public TenantQueryService tenantQueryService(TenantQueryPort tenantQueryPort) {
    return new TenantQueryService(tenantQueryPort);
  }

  @Bean
  public CreateTenantCommandHandler createTenantCommandHandler(
      TenantRepository tenantRepository,
      WorkflowStartService workflowStartService,
      DomainEventOutboxService outboxService,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    return new CreateTenantCommandHandler(
        tenantRepository, workflowStartService, outboxService, contextCodec, uuidV7Generator, clock);
  }

  @Bean
  public WorkflowDefinitionProvider tenantProvisioningWorkflowDefinitionProvider() {
    return new TenantProvisioningWorkflowDefinitionProvider();
  }

  @Bean
  public WorkflowStepHandler k8sCreateNamespaceStepHandler(
      KubernetesGateway kubernetesGateway, TenantProvisioningContextCodec contextCodec) {
    return new K8sCreateNamespaceStepHandler(kubernetesGateway, contextCodec);
  }

  @Bean
  public WorkflowStepHandler harborCreateProjectStepHandler(
      HarborGateway harborGateway,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    return new HarborCreateProjectStepHandler(harborGateway, contextCodec, uuidV7Generator, clock);
  }

  @Bean
  public WorkflowStepHandler harborCreateRobotStepHandler(
      HarborGateway harborGateway, TenantProvisioningContextCodec contextCodec) {
    return new HarborCreateRobotStepHandler(harborGateway, contextCodec);
  }

  @Bean
  public WorkflowStepHandler k8sCreateSecretStepHandler(
      KubernetesGateway kubernetesGateway, TenantProvisioningContextCodec contextCodec) {
    return new K8sCreateSecretStepHandler(kubernetesGateway, contextCodec);
  }

  @Bean
  public WorkflowStepHandler tenantMarkActiveStepHandler(
      TenantRepository tenantRepository,
      DomainEventOutboxService outboxService,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    return new TenantMarkActiveStepHandler(
        tenantRepository, outboxService, contextCodec, uuidV7Generator, clock);
  }

  @Bean
  public EventHandler harborProjectReadyEventHandler(
      WorkflowSignalService workflowSignalService, ObjectMapper objectMapper) {
    return new HarborProjectReadyEventHandler(workflowSignalService, objectMapper);
  }
}


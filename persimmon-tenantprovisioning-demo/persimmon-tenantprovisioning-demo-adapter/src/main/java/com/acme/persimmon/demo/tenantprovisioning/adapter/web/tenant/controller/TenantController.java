package com.acme.persimmon.demo.tenantprovisioning.adapter.web.tenant.controller;

import com.acme.persimmon.demo.tenantprovisioning.adapter.web.tenant.dto.CreateTenantRequest;
import com.acme.persimmon.demo.tenantprovisioning.adapter.web.tenant.dto.CreateTenantResponse;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto.CreateTenantCommand;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto.CreateTenantResult;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.handler.CreateTenantCommandHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto.TenantDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto.TenantProvisioningDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.service.TenantQueryService;
import java.util.UUID;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/tenants")
public class TenantController {
  private final CreateTenantCommandHandler createTenantCommandHandler;
  private final TenantQueryService tenantQueryService;

  public TenantController(
      CreateTenantCommandHandler createTenantCommandHandler, TenantQueryService tenantQueryService) {
    this.createTenantCommandHandler = createTenantCommandHandler;
    this.tenantQueryService = tenantQueryService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public CreateTenantResponse create(@Valid @RequestBody CreateTenantRequest req) {
    CreateTenantResult result =
        createTenantCommandHandler.handle(new CreateTenantCommand(req.name(), req.email()));
    return new CreateTenantResponse(result.tenantId(), result.workflowInstanceId());
  }

  @GetMapping("/{tenantId}")
  public TenantDTO get(@PathVariable UUID tenantId) {
    return tenantQueryService
        .findTenant(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
  }

  @GetMapping("/{tenantId}/provisioning")
  public TenantProvisioningDTO provisioning(@PathVariable UUID tenantId) {
    return tenantQueryService
        .findProvisioning(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
  }
}

package com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.aggregate;

import com.acme.persimmon.demo.tenantprovisioning.domain.biz.event.TenantCreatedEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.event.TenantProvisioningCompletedEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.event.TenantProvisioningFailedEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.enums.TenantStatus;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.vo.TenantId;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.assertion.DomainAssertions;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.model.AggregateRoot;
import java.time.Instant;
import java.util.UUID;

public final class Tenant extends AggregateRoot<TenantId> {
  private final String name;
  private final String email;
  private final String plan;
  private TenantStatus status;

  private Tenant(TenantId id, String name, String email, String plan) {
    super(id);
    this.name = requireText(name, "TENANT_NAME_REQUIRED", "Tenant name must not be blank.");
    this.email = requireText(email, "TENANT_EMAIL_REQUIRED", "Tenant email must not be blank.");
    this.plan = requireText(plan, "TENANT_PLAN_REQUIRED", "Tenant plan must not be blank.");
  }

  public static Tenant rehydrate(
      TenantId id, String name, String email, String plan, TenantStatus status, long version) {
    DomainAssertions.notNull(id, "TENANT_ID_REQUIRED", "Tenant id must not be null.");
    DomainAssertions.notNull(status, "TENANT_STATUS_REQUIRED", "Tenant status must not be null.");
    Tenant tenant = new Tenant(id, name, email, plan);
    tenant.status = status;
    tenant.setVersion(version);
    return tenant;
  }

  public static Tenant create(
      TenantId id,
      String name,
      String email,
      String plan,
      UUID eventId,
      Instant occurredAt) {
    DomainAssertions.notNull(id, "TENANT_ID_REQUIRED", "Tenant id must not be null.");
    Tenant tenant = new Tenant(id, name, email, plan);
    tenant.status = TenantStatus.PROVISIONING;
    tenant.raise(new TenantCreatedEvent(eventId, occurredAt, id.value(), email));
    return tenant;
  }

  public String getName() {
    return name;
  }

  public String getEmail() {
    return email;
  }

  public String getPlan() {
    return plan;
  }

  public TenantStatus getStatus() {
    return status;
  }

  public void markActive(UUID eventId, Instant occurredAt) {
    if (status == TenantStatus.ACTIVE) {
      return;
    }
    this.status = TenantStatus.ACTIVE;
    raise(new TenantProvisioningCompletedEvent(eventId, occurredAt, id().value()));
  }

  public void markFailed(UUID eventId, Instant occurredAt, String reason) {
    if (status == TenantStatus.FAILED) {
      return;
    }
    this.status = TenantStatus.FAILED;
    raise(new TenantProvisioningFailedEvent(eventId, occurredAt, id().value(), reason));
  }

  private static String requireText(String v, String code, String msg) {
    DomainAssertions.state(v != null && !v.isBlank(), code, msg);
    return v;
  }
}

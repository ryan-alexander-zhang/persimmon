package com.acme.persimmon.demo.tenantprovisioning.domain.common.event;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares a stable, contract-level event type identifier.
 *
 * <p>Recommended format: {@code <bc>.<event-name>.v<version>}, e.g. {@code order.order-created.v1}.
 *
 * <p>This string is intended to be stable across refactors (unlike Java class names).
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface DomainEventType {
  String value();
}

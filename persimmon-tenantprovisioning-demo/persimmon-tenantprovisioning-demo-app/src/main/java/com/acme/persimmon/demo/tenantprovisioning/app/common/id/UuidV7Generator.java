package com.acme.persimmon.demo.tenantprovisioning.app.common.id;

import java.util.UUID;

/**
 * Generates UUIDv7 identifiers.
 *
 * <p>UUIDv7 is required by this codebase for IDs and domain event identities.
 */
public interface UuidV7Generator {
  UUID next();
}

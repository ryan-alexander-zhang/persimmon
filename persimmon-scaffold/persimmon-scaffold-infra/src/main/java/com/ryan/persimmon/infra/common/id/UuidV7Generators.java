package com.ryan.persimmon.infra.common.id;

import com.ryan.persimmon.app.common.id.UuidV7Generator;
import com.github.f4b6a3.uuid.UuidCreator;
import java.util.UUID;

/**
 * Default UUIDv7 generator implementation.
 *
 * <p>Notes:
 *
 * <ul>
 *   <li>Uses current epoch millis as the 48-bit timestamp component.
 *   <li>Generates remaining bits using randomness and a per-millisecond counter to reduce collision
 *       risk.
 *   <li>Ensures RFC 4122 variant bits and version 7 bits are correctly set.
 * </ul>
 */
public final class UuidV7Generators implements UuidV7Generator{

  /**
   * Generates a time-ordered UUID v7.
   * <p>
   * UUID v7 features:
   * - Time-ordered (millisecond precision timestamp prefix)
   * - Database index friendly (reduces B-tree fragmentation)
   * - Naturally sortable by creation time
   * - RFC 9562 compliant
   *
   * @return a new UUID v7 instance
   */
  @Override
  public UUID next() {
    return UuidCreator.getTimeOrderedEpoch();
  }
}

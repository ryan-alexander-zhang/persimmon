package com.ryan.persimmon.infra.common.id;

import com.github.f4b6a3.uuid.UuidCreator;
import com.ryan.persimmon.app.common.id.UuidV7Generator;
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
public final class UuidV7Generators implements UuidV7Generator {

  @Override
  public UUID next() {
    return UuidCreator.getTimeOrderedEpoch();
  }
}

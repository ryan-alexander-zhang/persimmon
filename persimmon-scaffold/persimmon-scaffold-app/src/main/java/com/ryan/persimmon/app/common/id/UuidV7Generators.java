package com.ryan.persimmon.app.common.id;

import java.security.SecureRandom;
import java.time.Clock;
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
public final class UuidV7Generators {
  private UuidV7Generators() {}

  public static UuidV7Generator defaultGenerator() {
    return new DefaultUuidV7Generator(Clock.systemUTC());
  }

  public static UuidV7Generator defaultGenerator(Clock clock) {
    return new DefaultUuidV7Generator(clock);
  }

  private static final class DefaultUuidV7Generator implements UuidV7Generator {
    private static final SecureRandom RNG = new SecureRandom();

    private final Clock clock;

    private long lastEpochMillis = -1;
    private int counter = 0;

    private DefaultUuidV7Generator(Clock clock) {
      this.clock = clock;
    }

    @Override
    public synchronized UUID next() {
      long epochMillis = clock.millis();
      if (epochMillis == lastEpochMillis) {
        counter = (counter + 1) & 0x0FFF; // 12-bit counter
      } else {
        lastEpochMillis = epochMillis;
        counter = RNG.nextInt() & 0x0FFF;
      }

      long randA = RNG.nextLong();
      long randB = RNG.nextLong();

      // msb layout:
      // - 48 bits: unix epoch millis
      // - 4 bits: version (0111)
      // - 12 bits: counter/random (rand_a)
      long msb = 0L;
      msb |= (epochMillis & 0x0000_FFFF_FFFF_FFFFL) << 16;
      msb |= 0x7000L; // version 7 in bits 12..15 of the low 16 bits
      msb |= (counter & 0x0FFFL);

      // lsb layout:
      // - 2 bits: variant (10)
      // - 62 bits: random (rand_b)
      long lsb = randB;
      lsb &= 0x3FFF_FFFF_FFFF_FFFFL; // clear variant bits
      lsb |= 0x8000_0000_0000_0000L; // set variant to 10

      // Mix randA into msb's timestamp+counter lower bits to improve distribution.
      msb ^= (randA & 0x0000_0000_0000_FFFFL);

      return new UUID(msb, lsb);
    }
  }
}

package com.ryan.persimmon.app.common.id;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class UuidV7GeneratorsTest {

  @Test
  void defaultGenerator_should_generate_uuidv7() {
    UuidV7Generator generator = UuidV7Generators.defaultGenerator();

    UUID id = generator.next();
    assertNotNull(id);
    assertEquals(7, id.version());
    assertEquals(2, id.variant());
  }

  @Test
  void defaultGenerator_should_generate_unique_values_in_small_sample() {
    UuidV7Generator generator = UuidV7Generators.defaultGenerator();
    Set<UUID> set = new HashSet<>();
    for (int i = 0; i < 5000; i++) {
      set.add(generator.next());
    }
    assertEquals(5000, set.size());
  }
}


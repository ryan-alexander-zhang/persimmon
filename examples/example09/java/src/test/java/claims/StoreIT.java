package claims;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;

class StoreIT {
  @Test void aDraftedClaimIsWrittenToARealContainerAndReadBack() throws Exception {
    try (GenericContainer<?> c = new GenericContainer<>("alpine:3.20").withCommand("sleep", "60")) {
      c.start();
      c.execInContainer("sh", "-c", "echo c-e1 > /tmp/claim");
      assertEquals("c-e1", c.execInContainer("cat", "/tmp/claim").getStdout().trim());
    }
  }
}

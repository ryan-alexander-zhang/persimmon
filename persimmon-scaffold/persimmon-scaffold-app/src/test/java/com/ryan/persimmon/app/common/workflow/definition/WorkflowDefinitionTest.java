package com.ryan.persimmon.app.common.workflow.definition;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class WorkflowDefinitionTest {

  @Test
  void constructor_validatesInputs() {
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition(null, 1, List.of("s1")));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition(" ", 1, List.of("s1")));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition("demo", 0, List.of("s1")));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition("demo", -1, List.of("s1")));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition("demo", 1, null));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition("demo", 1, List.of()));
    assertThrows(IllegalArgumentException.class, () -> new WorkflowDefinition("demo", 1, List.of("s1", " ")));
  }

  @Test
  void stepTypes_areDefensivelyCopied() {
    List<String> stepTypes = new ArrayList<>(List.of("s1", "s2"));
    WorkflowDefinition def = new WorkflowDefinition("demo", 1, stepTypes);

    stepTypes.set(0, "hacked");
    assertEquals("s1", def.stepTypeAt(0));
  }

  @Test
  void navigation_works() {
    WorkflowDefinition def = new WorkflowDefinition("demo", 1, List.of("s1", "s2"));

    assertEquals("demo", def.workflowType());
    assertEquals(1, def.version());
    assertEquals(2, def.size());
    assertEquals("s1", def.stepTypeAt(0));
    assertEquals("s2", def.stepTypeAt(1));
    assertEquals(true, def.hasNext(0));
    assertEquals(false, def.hasNext(1));
    assertEquals(1, def.nextSeq(0));
    assertThrows(IndexOutOfBoundsException.class, () -> def.stepTypeAt(2));
  }
}


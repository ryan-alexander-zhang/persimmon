package claims;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class ClaimTest {
  @Test void aMealsLineOf30WithoutAReceiptIsNotComplete() {
    assertFalse(new Claim("e1", List.of(new Claim.Line(30, "meals", null))).complete());
  }
  @Test void aPerDiemLineNeedsNoReceipt() {
    assertTrue(new Claim("e1", List.of(new Claim.Line(60, "per-diem", null))).complete());
  }
  @Test void draftingAClaimRecordsEachLine() {
    assertEquals(List.of(new Claim.Line(12, "taxi", null)), new Claim("e1", List.of(new Claim.Line(12, "taxi", null))).lines);
  }
  @Test void aTaxiLineOf25WithoutAReceiptIsNotComplete() {
    assertFalse(new Claim("e1", List.of(new Claim.Line(25, "taxi", null))).complete());
  }
  @Test void attachingAReceiptToAnotherEmployeesClaimIsRefusedAndLogged() {
    Claim c = new Claim("e1", List.of(new Claim.Line(30, "meals", null)));
    assertFalse(c.attachReceipt("/claims/c-e1/r1", "e2"));
    assertEquals(List.of("refused /claims/c-e1/r1 by e2"), c.log);
  }
}

package claims;

import java.util.ArrayList;
import java.util.List;

/** The Claim aggregate (the worked example's T-1): lines, receipts, completeness under BR-2. */
public final class Claim {
  public static final int RECEIPT_THRESHOLD = 25;

  public record Line(int amount, String category, String receipt) {}

  public final String id;
  public final String employee;
  public final List<Line> lines;
  public final List<String> log = new ArrayList<>();

  public Claim(String employee, List<Line> lines) {
    this.id = "c-" + employee;
    this.employee = employee;
    this.lines = new ArrayList<>(lines);
  }

  public static boolean lineComplete(Line line) {
    return line.category().equals("per-diem") || line.amount() < RECEIPT_THRESHOLD || line.receipt() != null;
  }

  public boolean complete() {
    return lines.stream().allMatch(Claim::lineComplete);
  }

  public boolean attachReceipt(String url, String by) {
    if (!url.contains("/claims/" + id + "/") || !by.equals(employee)) {
      log.add("refused " + url + " by " + by);
      return false;
    }
    Line first = lines.get(0);
    lines.set(0, new Line(first.amount(), first.category(), url));
    return true;
  }
}

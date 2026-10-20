package claims;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class Server {
  static final String PAGE = "<!doctype html><title>Claims</title><form id=\"f\"><input id=\"amount\" value=\"30\"><select id=\"category\"><option>meals</option><option>per-diem</option></select><button>Check</button></form><p id=\"out\"></p>"
      + "<script>document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); const r = await fetch('/claims', { method: 'POST', body: JSON.stringify({ employee: 'e1', lines: [{ amount: Number(amount.value), category: category.value }] }) }); out.textContent = (await r.json()).complete ? 'complete' : 'incomplete' }</script>";
  static final Pattern LINE = Pattern.compile("\"amount\"\\s*:\\s*(\\d+)\\s*,\\s*\"category\"\\s*:\\s*\"([^\"]+)\"");

  public static void main(String[] args) throws IOException {
    HttpServer s = HttpServer.create(new InetSocketAddress(Integer.parseInt(args[0])), 0);
    s.createContext("/", ex -> {
      String body;
      if (ex.getRequestMethod().equals("GET")) body = PAGE;
      else {
        Matcher m = LINE.matcher(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        Claim c = new Claim("e1", m.find() ? List.of(new Claim.Line(Integer.parseInt(m.group(1)), m.group(2), null)) : List.of());
        body = "{\"complete\":" + c.complete() + "}";
        ex.getResponseHeaders().add("content-type", "application/json");
      }
      byte[] b = body.getBytes(StandardCharsets.UTF_8);
      ex.sendResponseHeaders(200, b.length);
      ex.getResponseBody().write(b);
      ex.close();
    });
    s.start();
  }
}

import { describe, expect, it } from "vitest";
import { ELEMENT_TYPES, type ElementType } from "./elements";
import { isValidConnection, resolveRelation } from "./relations";

// The single source of truth for the connection-rule table (design-00001 §2),
// expressed as valid (source, relation, target) triples.
const VALID: Array<[ElementType, string, ElementType]> = [
  ["actor", "issues", "command"],
  // An outside system can be the one asking, not only the one we call
  // (decision-00003 Process grammar, issue-00037).
  ["externalSystem", "issues", "command"],
  ["command", "produces", "domainEvent"],
  ["command", "constrainedBy", "constraint"],
  ["command", "handledBy", "aggregate"],
  ["command", "handledBy", "externalSystem"],
  ["aggregate", "emits", "domainEvent"],
  ["externalSystem", "emits", "domainEvent"],
  ["domainEvent", "triggers", "policy"],
  ["policy", "invokes", "command"],
  ["domainEvent", "updates", "readModel"],
  ["readModel", "informs", "actor"],
];

describe("connection rules", () => {
  it.each(VALID)("%s -> %s resolves to %s", (source, relation, target) => {
    expect(resolveRelation(source, target)).toBe(relation);
    expect(isValidConnection(source, target)).toBe(true);
  });

  it("keeps the two directions between a Command and an External System apart [issue-00037]", () => {
    // the outside system asks us to do something...
    expect(resolveRelation("externalSystem", "command")).toBe("issues");
    // ...and we call out to it; direction is what tells them apart.
    expect(resolveRelation("command", "externalSystem")).toBe("handledBy");
  });

  it("lets a hotspot annotate any element type", () => {
    for (const target of ELEMENT_TYPES) {
      expect(resolveRelation("hotspot", target)).toBe("annotates");
    }
  });

  it("lets an opportunity highlight any element type [us-00013-AC-1.1]", () => {
    for (const target of ELEMENT_TYPES) {
      expect(resolveRelation("opportunity", target)).toBe("highlights");
    }
  });

  it("rejects connections not in the rule table", () => {
    // actor -> domainEvent (us-00002-AC-2.1), and other unlisted pairs
    expect(resolveRelation("actor", "domainEvent")).toBeNull();
    expect(isValidConnection("actor", "domainEvent")).toBe(false);
    // a Command now produces a Domain Event directly, but the reverse is still invalid
    expect(resolveRelation("domainEvent", "command")).toBeNull();
    expect(resolveRelation("readModel", "command")).toBeNull();
    expect(resolveRelation("constraint", "command")).toBeNull(); // constraint has no outgoing rule
  });

  it("only allows the valid pairs (exhaustive over the type matrix)", () => {
    const allowed = new Set(VALID.map(([s, , t]) => `${s}->${t}`));
    for (const target of ELEMENT_TYPES) allowed.add(`hotspot->${target}`);
    for (const target of ELEMENT_TYPES) allowed.add(`opportunity->${target}`);

    for (const source of ELEMENT_TYPES) {
      for (const target of ELEMENT_TYPES) {
        const expected = allowed.has(`${source}->${target}`);
        expect(isValidConnection(source, target)).toBe(expected);
      }
    }
  });
});

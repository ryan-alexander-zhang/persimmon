// Event Storming element types (canvas node types) and their sticky-note colors.
// Colors follow the ddd-crew convention; elements are also distinguishable by
// label/icon, not color alone.

import { elements, type ElementType } from "./grammar";

export const ELEMENT_TYPES = elements;
export type { ElementType };

export interface ElementDefinition {
  type: ElementType;
  label: string;
  color: string;
}

export const ELEMENT_DEFINITIONS: Record<ElementType, ElementDefinition> = {
  domainEvent: { type: "domainEvent", label: "Domain Event", color: "#F6A623" },
  command: { type: "command", label: "Command", color: "#4A90E2" },
  actor: { type: "actor", label: "Actor", color: "#F8E71C" },
  constraint: { type: "constraint", label: "Constraint", color: "#4DB6AC" },
  aggregate: { type: "aggregate", label: "Aggregate", color: "#F5D76E" },
  policy: { type: "policy", label: "Policy", color: "#B39DDB" },
  readModel: { type: "readModel", label: "Read Model", color: "#7ED321" },
  externalSystem: { type: "externalSystem", label: "External System", color: "#F48FB1" },
  hotspot: { type: "hotspot", label: "Hotspot", color: "#FF4081" },
  opportunity: { type: "opportunity", label: "Opportunity", color: "#00C853" },
};

// Fixed row-bands, top→bottom. Actors and External Systems share the top band.
export const BAND_ORDER = [
  "actorSystem",
  "command",
  "constraint",
  "aggregate",
  "domainEvent",
  "policy",
  "readModel",
  "hotspot",
  "opportunity",
] as const;

export type Band = (typeof BAND_ORDER)[number];

export const ELEMENT_BAND: Record<ElementType, Band> = {
  actor: "actorSystem",
  externalSystem: "actorSystem",
  command: "command",
  constraint: "constraint",
  aggregate: "aggregate",
  domainEvent: "domainEvent",
  policy: "policy",
  readModel: "readModel",
  hotspot: "hotspot",
  opportunity: "opportunity",
};

export const bandIndex = (type: ElementType): number =>
  BAND_ORDER.indexOf(ELEMENT_BAND[type]);

/**
 * Layered architecture rules (Must).
 *
 * <p>This package contains the strict layered dependency policy for the project:
 *
 * <ul>
 *   <li>{@code adapter -> app -> domain}
 *   <li>{@code infra -> domain} (implements ports)
 *   <li>{@code start} wires everything and is the only layer that may reference {@code infra}
 * </ul>
 *
 * <p>These rules are mandatory and represent the core architecture contract.
 */
package com.ryan.persimmon.arch.layer;

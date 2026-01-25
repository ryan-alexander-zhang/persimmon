/**
 * Layered architecture rules (Must).
 *
 * <p>This package contains the strict layered dependency policy for the project:</p>
 * <ul>
 *   <li>{@code adapter -> app -> domain}</li>
 *   <li>{@code infra -> domain} (implements ports)</li>
 *   <li>{@code start} wires everything and is the only layer that may reference {@code infra}</li>
 * </ul>
 *
 * <p>These rules are mandatory and represent the core architecture contract.</p>
 */
package com.ryan.persimmon.arch.layer;


/**
 * Assemblers for command-side mapping in the {@code biz} context.
 *
 * <p>Assemblers convert between command DTOs and domain objects (aggregates, value objects) while
 * keeping mapping rules explicit and centralized.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Avoid spreading mapping code across handlers.
 *   <li>Prefer creating domain value objects here to enforce type safety.
 * </ul>
 */
package com.ryan.persimmon.app.biz.command.assembler;

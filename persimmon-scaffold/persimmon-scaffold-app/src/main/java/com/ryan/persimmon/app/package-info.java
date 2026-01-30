/**
 * Application module root package.
 *
 * <p>This module orchestrates use cases. It coordinates domain objects, manages transactions at a
 * use-case level, and adapts inbound requests into domain operations. It should not contain
 * infrastructure implementations nor web concerns.
 *
 * <h2>Structure rule</h2>
 *
 * <p><strong>BC-first</strong>: all business use cases live under {@code
 * com.ryan.persimmon.app.biz.*}. Only cross-cutting, non-business utilities belong under {@code
 * com.ryan.persimmon.app.common}.
 */
package com.ryan.persimmon.app;

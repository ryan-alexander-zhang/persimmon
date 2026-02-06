/**
 * Business policies for the {@code biz} context.
 *
 * <p>Policies represent business rules that are often configurable or that may vary by scenario
 * (e.g. eligibility rules, pricing decisions, risk checks). Policies can be modeled as strategies
 * or rule objects invoked by domain services/aggregates.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Keep policies expressed in domain language, not technical jargon.
 *   <li>Prefer explicit inputs/outputs to reduce hidden coupling.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.domain.biz.policy;

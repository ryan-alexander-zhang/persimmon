/**
 * Adapter module root package (inbound adapters).
 *
 * <p>This module contains inbound delivery mechanisms such as HTTP controllers, RPC providers,
 * message consumers, and scheduled jobs. Adapters translate external requests into application
 * commands/queries and map application responses back to external representations.
 *
 * <h2>Structure rule</h2>
 *
 * <p><strong>BC-first</strong>: organize adapters by business context under the corresponding
 * transport type (web/rpc/mq/scheduler). {@code adapter.web.common} is the only shared inbound
 * package.
 */
package com.acme.persimmon.demo.tenantprovisioning.adapter;

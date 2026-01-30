/**
 * RPC inbound adapter (optional).
 *
 * <p>RPC endpoints expose operations for other services. They translate RPC calls into application
 * use cases (commands/queries) and map results back to RPC DTOs.
 *
 * <p><strong>Optional:</strong> use this adapter when the system offers RPC APIs (gRPC, Dubbo,
 * etc.) in addition to or instead of HTTP.
 */
package com.ryan.persimmon.adapter.rpc;

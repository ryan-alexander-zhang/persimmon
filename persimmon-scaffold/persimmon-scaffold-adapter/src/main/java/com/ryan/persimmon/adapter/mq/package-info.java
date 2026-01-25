/**
 * Message queue inbound adapter (optional).
 *
 * <p>Contains consumers that react to incoming messages and translate them into application use cases.
 * This adapter is responsible for message decoding, validation, idempotency concerns, and retry/ack
 * behavior (implemented with the chosen MQ framework).</p>
 *
 * <p><strong>Optional:</strong> use when the system consumes events/commands from a message broker.</p>
 */
package com.ryan.persimmon.adapter.mq;


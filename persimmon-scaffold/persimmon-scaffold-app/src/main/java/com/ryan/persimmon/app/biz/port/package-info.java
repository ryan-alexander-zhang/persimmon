/**
 * Application ports for the {@code biz} context.
 *
 * <p>This package groups optional application-layer ports when you want to keep read-side ports in
 * the application module (for example, query DAOs used by query services). If your architecture uses
 * a dedicated contracts module, keep ports there instead.</p>
 *
 * <p><strong>Optional:</strong> use this when query services need an abstraction over a read store and
 * you want to keep that abstraction at the application boundary rather than in infrastructure.</p>
 */
package com.ryan.persimmon.app.biz.port;


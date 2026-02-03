package com.ryan.persimmon.app.common.runtime;

/** Provides a node/process identity string used for database leases/locks. */
@FunctionalInterface
public interface WorkerIdProvider {
  String workerId();
}


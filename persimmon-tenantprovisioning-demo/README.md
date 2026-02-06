# Features

## persimmon-scaffold
- [x] Multi-module Maven scaffold (domain/app/adapter/infra/start)
- [x] Local PostgreSQL (Docker Compose) for development/testing

## persimmon-scaffold-domain
- [x] DDD building blocks: `AggregateRoot`, `EntityBase`, `ValueObject`, `Versioned`
- [x] Uncommitted domain events recording + pull/peek lifecycle (`HasDomainEvents`)
- [x] Domain event invariants validation (UUIDv7 `eventId`, non-null `occurredAt`)
- [x] Strongly-typed UUIDv7 identifiers (`TypedId`, `UuidV7Id`) to prevent ID mixing
- [x] Domain invariant helpers (`DomainAssertions`) and domain exceptions
- [x] Unit tests for `domain.common` components

## persimmon-scaffold-app
- [x] CQRS application-layer package layout scaffold (command/query/event/port/assembler)
- [x] Bounded-context-first (`biz`) + shared (`common`) package separation

## persimmon-scaffold-adapter
- [x] Inbound adapter package layout scaffold: `web`, `rpc`, `mq`, `scheduler`
- [x] Spring Web dependency included for REST endpoints
- [x] Bean Validation dependency included for request validation

## persimmon-scaffold-infra
- [x] PostgreSQL integration (JDBC driver)
- [x] Flyway migrations enabled and wired (`db/migration`)
- [x] MyBatis-Plus integration and configuration
- [x] Optimistic locking support (`row_version` + MyBatis-Plus optimistic locker interceptor)
- [x] Soft delete support (`deletedAt` + MyBatis-Plus logic delete config)
- [x] Audit columns base model (`BasePO`: created/updated/deleted timestamps, createdBy/updatedBy)
- [x] Auto-fill timestamps on insert/update (`AutoFillObjectHandler`)
- [x] UUID database type handler for Postgres (`UuidTypeHandler`)
- [x] Demo repository artifacts (`TenantPO`, `TenantMapper`) + init schema and partial unique index
- [x] MyBatis-Plus repository test coverage for CRUD + optimistic lock + logic delete

## persimmon-scaffold-start
- [x] Spring Boot application bootstrap (`Application`)
- [x] Centralized MyBatis mapper scanning for infra repository/query modules
- [x] Profile-based configuration (`application.yaml`, `application-local.yaml`)
- [x] Spring Boot Actuator enabled
- [x] ArchUnit architecture guardrails (layer rules + dependency cycle checks + structural checks)

# Persimmon Project DDD Implementation Guidelines

You are an expert Java Software Architect specializing in Domain-Driven Design (DDD) and Hexagonal Architecture. You must strictly follow the "BC-first" (Bounded Context First) package structure defined below for all code generation and refactoring tasks.

## 1. Core Architecture Principles
- **BC-First Strategy**: All business-semantic types must live under a specific Bounded Context (`<bc>`).
- **Dependency Rule**: Dependencies must flow inwards.
    - `Domain` is pure and depends on nothing.
    - `App` depends on `Domain`.
    - `Adapter` and `Infra` depend on `App` and `Domain`.
- **Interface Segregation**: Repositories and Gateways MUST be defined as interfaces in the `Domain` layer and implemented in the `Infra` layer.

## 2. Package Mapping & Structure

### A. Domain Module (Pure Domain Logic)
- **Base**: `com.ryan.persimmon.domain.<bc>`
- **Sub-packages**:
    - `.model.aggregate`: Aggregate Roots.
    - `.model.entity`: Local Entities.
    - `.model.vo`: Value Objects.
    - `.model.enums`: Domain-specific Enums.
    - `.repository`: Port interfaces for persistence.
    - `.gateway`: Port interfaces for external systems (e.g., PaymentGateway).
    - `.service`: Domain Services (stateless business logic).
    - `.event`: Domain Events.
    - `.exception`: Domain-specific business exceptions.
    - `.factory / .policy / .specification`: DDD building blocks.
- **Common**: `com.ryan.persimmon.domain.common` (Only for `AggregateRoot`, `EntityBase`, etc.)

### B. App Module (Orchestration & Use Cases)
- **Base**: `com.ryan.persimmon.app.<bc>`
- **Sub-packages**:
    - `.command.dto / .command.handler`: Write operations.
    - `.query.dto / .query.service`: Read operations (CQRS).
    - `.command.assembler`: Converts DTOs/Commands to Domain Objects.
    - `.event.handler / .event.publisher`: Application-level event logic.

### C. Adapter Module (Inbound Adapters)
- **Base**: `com.ryan.persimmon.adapter.<type>.<bc>`
- **Types**:
    - `web`: Controllers, WebDTOs, Assemblers (WebDTO <-> Command).
    - `rpc`: Provider implementations and DTOs.
    - `mq`: Message consumers.
    - `scheduler`: Job definitions.

### D. Infra Module (Outbound Adapters & Tech Details)
- **Base**: `com.ryan.persimmon.infra`
- **Sub-packages**:
    - `repository.<bc>.impl`: Implements `domain.<bc>.repository`.
    - `repository.<bc>.po`: Persistent Objects (Database entities).
    - `repository.<bc>.mapper`: MyBatis/JPA mappers.
    - `gateway.<system>.impl`: Implements `domain.<bc>.gateway`.
    - `config / cache / lock`: Technical configurations.

## 3. Coding Standards & Constraints

- **Object Naming**:
    - Domain: `Order`, `OrderItem` (Entities/VOs).
    - App: `OrderCreateCommand`, `OrderDTO`.
    - Infra: `OrderPO`.
    - Adapter: `OrderRequest`, `OrderResponse`.
- **Conversion**:
    - Use `Assembler` classes in `Adapter` or `App` layers to map objects between layers.
    - Keep Domain objects clean; do not use `PO` or `DTO` inside the Domain layer.
- **No God Packages**: Do not create cross-BC packages like `com.ryan.persimmon.domain.models`. Always use the `<bc>` name.

## 4. Workflow for New Features
When I ask for a new feature:
1. Identify the Bounded Context.
2. Define Domain models and Repository ports.
3. Implement the App-layer Command and Handler.
4. Implement the Infra-layer Repository (PO, Mapper, Impl).
5. Create the Adapter-layer Controller.
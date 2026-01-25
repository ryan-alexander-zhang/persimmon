## Domain module (pure domain)

Base package: `com.ryan.persimmon.domain`

> Rule: **BC-first**. All business-semantic types live under `com.ryan.persimmon.domain.<bc>.*`.
> Only non-business abstractions may live under `com.ryan.persimmon.domain.common`.

* `com.ryan.persimmon.domain.common`
    * Shared, non-business abstractions only:
        * `AggregateRoot`, `EntityBase`, `ValueObject`, `DomainEvent`, `Identifier`, `DomainException` (or keep exception in each BC if you prefer)

For each `<bc>` (e.g., `order`, `inventory`, `user`):

* `com.ryan.persimmon.domain.<bc>.model.aggregate`
* `com.ryan.persimmon.domain.<bc>.model.entity`
* `com.ryan.persimmon.domain.<bc>.model.vo`
* `com.ryan.persimmon.domain.<bc>.model.enums`
* `com.ryan.persimmon.domain.<bc>.service`
* `com.ryan.persimmon.domain.<bc>.policy`
* `com.ryan.persimmon.domain.<bc>.specification`
* `com.ryan.persimmon.domain.<bc>.event`
* `com.ryan.persimmon.domain.<bc>.factory`
* `com.ryan.persimmon.domain.<bc>.repository` (ports)
* `com.ryan.persimmon.domain.<bc>.gateway` (ports)
* `com.ryan.persimmon.domain.<bc>.exception`

---

## App module (use cases / orchestration)

Base package: `com.ryan.persimmon.app`

> Rule: **BC-first** as well. No cross-BC “god packages” except `app.common`.

For each `<bc>`:

* `com.ryan.persimmon.app.<bc>.command.dto`
* `com.ryan.persimmon.app.<bc>.command.handler`
* `com.ryan.persimmon.app.<bc>.command.assembler`
* `com.ryan.persimmon.app.<bc>.query.dto`
* `com.ryan.persimmon.app.<bc>.query.service`

Optional ports (if you keep query ports in app; otherwise use a separate `contracts` module):

* `com.ryan.persimmon.app.<bc>.port.out` (e.g., `OrderReadDao`)

Events / transactions / exceptions:

* `com.ryan.persimmon.app.<bc>.event.publisher`
* `com.ryan.persimmon.app.<bc>.event.handler`
* `com.ryan.persimmon.app.<bc>.exception`

Shared app-level utilities (non-business):

* `com.ryan.persimmon.app.common` (pagination, response wrappers, etc.)

---

## Adapter module (inbound adapters: HTTP/RPC/MQ/Job)

Base package: `com.ryan.persimmon.adapter`

> Rule: **BC-first**. `adapter.web.common` is the only shared inbound package.

Web:

* `com.ryan.persimmon.adapter.web.common` (global exception handling, auth interceptors, validation)
* For each `<bc>`:

    * `com.ryan.persimmon.adapter.web.<bc>.controller`
    * `com.ryan.persimmon.adapter.web.<bc>.dto`
    * `com.ryan.persimmon.adapter.web.<bc>.assembler`

RPC (optional):

* For each `<bc>`:

    * `com.ryan.persimmon.adapter.rpc.<bc>.provider`
    * `com.ryan.persimmon.adapter.rpc.<bc>.dto`

MQ inbound (optional):

* For each `<bc>`:

    * `com.ryan.persimmon.adapter.mq.<bc>.consumer`
    * `com.ryan.persimmon.adapter.mq.<bc>.message`

Scheduler (optional):

* For each `<bc>`:

    * `com.ryan.persimmon.adapter.scheduler.<bc>.job`

---

## Infra module (outbound adapters: implementations + technical details)

Base package: `com.ryan.persimmon.infra`

> Rule: **BC-first for persistence/query**, and **system-first for external integrations** (payment/risk/etc.).
> If you prefer everything BC-first, place gateway implementations under `infra.<bc>.gateway.<system>.*` instead.

Repository implementations (implements `domain.<bc>.repository.*`):

* For each `<bc>`:

    * `com.ryan.persimmon.infra.repository.<bc>.po`
    * `com.ryan.persimmon.infra.repository.<bc>.mapper` (MyBatis) OR `.jpa` (JPA)
    * `com.ryan.persimmon.infra.repository.<bc>.converter`
    * `com.ryan.persimmon.infra.repository.<bc>.impl`

Gateway implementations (implements `domain.<bc>.gateway.*`), by external system:

* For each `<system>` (e.g., `payment`, `risk`):

    * `com.ryan.persimmon.infra.gateway.<system>.client`
    * `com.ryan.persimmon.infra.gateway.<system>.dto`
    * `com.ryan.persimmon.infra.gateway.<system>.impl`

CQRS read side (optional):

* For each `<bc>`:

    * `com.ryan.persimmon.infra.query.<bc>.mapper`
    * `com.ryan.persimmon.infra.query.<bc>.dto`
    * `com.ryan.persimmon.infra.query.<bc>.impl`

Events/outbox (optional):

* `com.ryan.persimmon.infra.event.outbox`
* `com.ryan.persimmon.infra.event.mq`

Technical configuration:

* `com.ryan.persimmon.infra.config`
* `com.ryan.persimmon.infra.cache`
* `com.ryan.persimmon.infra.lock`
* `com.ryan.persimmon.infra.common`

---

## Start module (bootstrap / wiring)

Base package: `com.ryan.persimmon.start`

* `com.ryan.persimmon.start.bootstrap` (Spring Boot `Application` main)
* `com.ryan.persimmon.start.config.bean` (wiring: bind ports to implementations)
* `com.ryan.persimmon.start.config.scan` (component scan boundaries)
* `com.ryan.persimmon.start.profile` (optional)

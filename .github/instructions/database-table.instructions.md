---
description: PostgreSQL table template + partial unique index (soft delete).
applyTo: "src/main/resources/db/migration/**/*.sql,src/main/resources/mapper/**/*.xml,src/main/java/**/*Mapper.java"
---

### Table template
```sql
-- NOTE:
-- 1) uuidv7() requires PostgreSQL 18+. If not available, generate UUID in app or use gen_random_uuid().

create table <table_name>
(
    id          uuid primary key     default uuidv7(),
    status      varchar(64) not null,
    row_version int         not null default 0,

--  audit columns
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    created_by  uuid,
    updated_by  uuid,
    deleted_at  timestamptz,
    constraint ck_demo_status check (status in ('CREATING', 'ACTIVE', 'FAILED', 'UPDATING', 'DELETING', 'DELETED'))
);

```

### Unique indexes (soft delete)
```sql
create unique index uk_<table_name>_<column_name> on public.<table_name> (<column_name>) where deleted_at is null;
```
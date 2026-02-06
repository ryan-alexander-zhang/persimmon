create table if not exists public.tenant
(
    id          uuid primary key,
    status      varchar(64) not null,
    row_version int         not null default 0,
    name        text        not null,
    email       text        not null,
    plan        varchar(64) not null,

--  audit columns
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    created_by  uuid,
    updated_by  uuid,
    deleted_at  timestamptz,
    constraint ck_tenant_status check (status in ('PROVISIONING', 'ACTIVE', 'FAILED'))
);

create unique index if not exists uk_tenant_email on public.tenant (email) where deleted_at is null;

create index if not exists idx_tenant_status on public.tenant (status);


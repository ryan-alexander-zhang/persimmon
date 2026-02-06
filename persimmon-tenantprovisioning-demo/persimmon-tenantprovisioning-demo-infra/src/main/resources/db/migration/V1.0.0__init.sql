create table if not exists public.demo_biz
(
    id          uuid primary key     default uuidv7(),
    status      varchar(64) not null,
    row_version int         not null default 0,
    name        text        not null,

--  audit columns
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    created_by  uuid,
    updated_by  uuid,
    deleted_at  timestamptz,
    constraint ck_demo_biz_status check (status in ('CREATING', 'ACTIVE', 'FAILED', 'UPDATING', 'DELETING', 'DELETED'))
    );

create unique index if not exists uk_emo_biz_name on public.demo_biz (name) where deleted_at is null;

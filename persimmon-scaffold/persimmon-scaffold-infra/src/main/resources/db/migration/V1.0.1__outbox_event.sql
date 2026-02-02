create table if not exists public.outbox_event
(
    event_id       uuid primary key,
    occurred_at    timestamptz not null,

    aggregate_type text        not null,
    aggregate_id   uuid        not null,
    event_type     text        not null,

    payload        text        not null,
    headers        text,

    status         varchar(16) not null,
    attempts       int         not null default 0,
    next_retry_at  timestamptz,
    sent_at        timestamptz,

    locked_by      text,
    locked_until   timestamptz,
    last_error     text,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

create index if not exists idx_outbox_event_status_retry
    on public.outbox_event (status, next_retry_at, occurred_at);

create index if not exists idx_outbox_event_lock
    on public.outbox_event (locked_until);

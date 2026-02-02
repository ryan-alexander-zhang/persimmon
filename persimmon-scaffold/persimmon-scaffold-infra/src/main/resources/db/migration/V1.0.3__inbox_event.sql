create table if not exists public.inbox_event
(
    id            uuid primary key,
    event_id      uuid        not null,
    consumer_name text        not null,
    event_type    text        not null,
    occurred_at   timestamptz not null,
    aggregate_type text       not null,
    aggregate_id  uuid        not null,
    processed_at  timestamptz not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create unique index if not exists uk_inbox_event_consumer_event
    on public.inbox_event (consumer_name, event_id);


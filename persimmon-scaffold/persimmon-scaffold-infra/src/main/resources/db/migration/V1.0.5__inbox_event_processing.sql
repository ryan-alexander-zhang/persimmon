alter table public.inbox_event
    add column if not exists status varchar(16),
    add column if not exists started_at timestamptz,
    add column if not exists last_error text;

alter table public.inbox_event
    alter column processed_at drop not null;

update public.inbox_event
set status     = 'PROCESSED',
    started_at = processed_at
where status is null;

alter table public.inbox_event
    alter column status set not null,
    alter column started_at set not null;

alter table public.inbox_event
    add constraint ck_inbox_event_status
        check (status in ('PROCESSING', 'PROCESSED', 'FAILED'));


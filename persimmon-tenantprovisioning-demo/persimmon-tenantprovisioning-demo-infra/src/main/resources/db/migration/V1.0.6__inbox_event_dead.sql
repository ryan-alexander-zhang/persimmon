alter table public.inbox_event
    add column if not exists dead_at timestamptz;

alter table public.inbox_event
    drop constraint if exists ck_inbox_event_status;

alter table public.inbox_event
    add constraint ck_inbox_event_status
        check (status in ('PROCESSING', 'PROCESSED', 'FAILED', 'DEAD'));


alter table public.outbox_event
    add column if not exists dead_at timestamptz;

-- Status model normalization (for existing environments)
update public.outbox_event
set status = 'READY'
where status in ('NEW', 'FAILED');


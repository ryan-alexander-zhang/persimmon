create table if not exists public.workflow_instance
(
    instance_id       uuid primary key,
    biz_key           text        not null,
    workflow_type     text        not null,
    workflow_version  int         not null,
    status            varchar(32) not null,
    current_step_seq  int         not null,
    current_step_type text        not null,
    context_json      text,
    started_at        timestamptz not null,
    completed_at      timestamptz,
    failed_at         timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint ck_workflow_instance_status
        check (status in ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELED'))
);

create unique index if not exists uk_workflow_instance_biz_key_running
    on public.workflow_instance (biz_key)
    where status = 'RUNNING';

create index if not exists idx_workflow_instance_biz_key
    on public.workflow_instance (biz_key);

create table if not exists public.workflow_step
(
    instance_id        uuid        not null,
    step_seq           int         not null,
    step_type          text        not null,
    status             varchar(16) not null,
    attempts           int         not null default 0,
    max_attempts       int         not null default 10,
    next_run_at        timestamptz,
    waiting_event_type text,
    deadline_at        timestamptz,
    locked_by          text,
    locked_until       timestamptz,
    last_error         text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    primary key (instance_id, step_seq),
    constraint ck_workflow_step_status
        check (status in ('PENDING', 'READY', 'RUNNING', 'WAITING', 'DONE', 'DEAD'))
);

create index if not exists idx_workflow_step_ready
    on public.workflow_step (status, next_run_at);

create index if not exists idx_workflow_step_waiting_deadline
    on public.workflow_step (status, deadline_at);

create index if not exists idx_workflow_step_lock
    on public.workflow_step (locked_until);

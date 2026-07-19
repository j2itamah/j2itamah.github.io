-- Build A / QuantPulse validation-contract foundation.
--
-- Purpose:
--   Keep legacy Build A research rows diagnostic-only while creating a current
--   Build 1/2-style trusted path. Historical `research_valid=true` rows are
--   not promoted by this migration. Trusted metrics may only read
--   `trade_outcome_v2` rows with `validation_status='VALIDATED'`.
--
-- Safety:
--   Append-only schema addition. No deletes, no resets, no historical rewrites.
--   RLS is enabled with no public policies so the validation table is
--   fail-closed until a service-side validator/writer is deliberately wired.

create table if not exists public.v2_trade_validations (
  id bigserial primary key,
  trade_intent_id bigint not null references public.v2_trade_intents(id) on delete restrict,
  validator_version text not null,
  validation_status text not null check (validation_status in ('VALIDATED','PENDING','QUARANTINED','AMBIGUOUS')),
  validation_reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_trade_validations_unique_version unique (trade_intent_id, validator_version)
);

alter table public.v2_trade_validations enable row level security;

create index if not exists v2_trade_validations_trade_intent_idx
  on public.v2_trade_validations(trade_intent_id);

create index if not exists v2_trade_validations_status_version_idx
  on public.v2_trade_validations(validation_status, validator_version, created_at desc);

create or replace view public.v2_trusted_trade_intents
with (security_invoker = true)
as
select ti.*,
       tv.validator_version,
       tv.validation_status,
       tv.validation_reason,
       tv.evidence as validation_evidence,
       tv.created_at as validated_at
from public.v2_trade_intents ti
join public.v2_trade_validations tv
  on tv.trade_intent_id = ti.id
where tv.validator_version = 'trade_outcome_v2'
  and tv.validation_status = 'VALIDATED';

comment on table public.v2_trade_validations is
  'Append-only Build A validation contract foundation. Historical research_valid rows are not trusted; only current validator_version=trade_outcome_v2 VALIDATED rows may feed trusted metrics.';

comment on view public.v2_trusted_trade_intents is
  'Trusted-only Build A view. Uses security_invoker and returns only trade_outcome_v2 VALIDATED rows; currently expected to be empty until a validator writes evidence.';

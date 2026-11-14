-- 0001_schema.sql — النموذج المنطقي للبيانات (الخطة §8)
-- لا ON DELETE CASCADE على السجلات الانتخابية: الأرشفة/الإلغاء بدل الحذف.

-- ملاحظة: لا نعتمد pgcrypto؛ نستخدم sha256() وgen_random_uuid() المدمجتين (PG ≥ 13).

create type election_type   as enum ('leadership', 'name_proposals', 'referendum');
create type box_status      as enum ('draft', 'scheduled', 'open', 'paused', 'closed', 'cancelled');
create type results_status  as enum ('none', 'under_review', 'approved', 'published');
create type privacy_level   as enum ('strong_anonymous', 'restricted_administrative');
create type section_kind    as enum ('top_n', 'explicit_roles', 'single', 'multi', 'ranked', 'stars', 'yes_no');
create type candidate_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type admin_role      as enum ('super_admin', 'election_manager', 'auditor', 'results_officer', 'privacy_approver');
create type results_visibility as enum ('hidden_until_published', 'live');
create type tie_policy      as enum ('runoff', 'declare_tie');
create type conflict_policy as enum ('separate', 'cumulative');

-- ───────── الطلاب والمشرفون ─────────
create table allowed_students (
  university_id text primary key check (university_id ~ '^[0-9A-Za-z-]{2,32}$'),
  full_name     text,
  status        text not null default 'active' check (status in ('active', 'frozen')),
  created_at    timestamptz not null default now()
);

create table admin_users (
  user_id      uuid primary key references auth.users (id),
  display_name text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table admin_roles (
  user_id uuid not null references admin_users (user_id),
  role    admin_role not null,
  primary key (user_id, role)
);

-- ───────── الانتخابات ─────────
create table elections (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(btrim(title)) > 0),
  description        text,
  type               election_type not null,
  box_status         box_status not null default 'draft',
  results_status     results_status not null default 'none',
  privacy_level      privacy_level not null,
  results_visibility results_visibility not null default 'hidden_until_published',
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  tie_policy         tie_policy not null default 'runoff',
  conflict_policy    conflict_policy not null default 'separate',
  min_turnout        integer check (min_turnout is null or min_turnout >= 0),
  runoff_of          uuid references elections (id),
  runoff_reason      text,
  runoff_approved_by uuid references admin_users (user_id),
  locked_at          timestamptz,
  created_by         uuid references admin_users (user_id),
  created_at         timestamptz not null default now(),
  check (ends_at > starts_at),
  check (runoff_of is null or runoff_reason is not null)
);

create table election_sections (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references elections (id),
  title         text not null,
  kind          section_kind not null,
  display_order integer not null default 0,
  allow_abstain boolean not null default false,
  allow_other   boolean not null default false,
  min_choices   integer not null default 1 check (min_choices >= 0),
  max_choices   integer check (max_choices is null or max_choices >= 1),
  seats         integer not null default 1 check (seats >= 1),
  unique (id, election_id),
  check (max_choices is null or max_choices >= min_choices)
);

create table candidates (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null,
  section_id    uuid not null,
  name          text not null check (length(btrim(name)) > 0),
  bio           text,
  image_url     text,
  proposed_by   text references allowed_students (university_id),
  status        candidate_status not null default 'approved',
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  foreign key (section_id, election_id) references election_sections (id, election_id),
  unique (id, section_id),
  unique (id, election_id)
);

create table proposal_reviews (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates (id),
  reviewer     uuid not null references admin_users (user_id),
  decision     candidate_status not null check (decision in ('approved', 'rejected')),
  reason       text not null,
  created_at   timestamptz not null default now()
);

create table election_revisions (
  id          uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections (id),
  revision_no integer not null,
  snapshot    jsonb not null,
  sha256      text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (election_id, revision_no)
);

-- ───────── المشاركة وأوراق الاقتراع ─────────
-- سجل المشاركة: يثبت أن الرقم شارك، ولا يحوي أي اختيار.
-- الوقت مقرّب إلى الساعة عمداً. مفتاح Idempotency يحفظ مُجزّأً هنا فقط.
create table voter_participation (
  election_id     uuid not null references elections (id),
  university_id   text not null references allowed_students (university_id),
  idempotency_hash text not null,
  participated_hour timestamptz not null default date_trunc('hour', now()),
  primary key (election_id, university_id)
);

-- ورقة الاقتراع: معرّف عشوائي، بلا توقيت ولا هوية. الإيصال مُجزّأ.
create table ballot_sheets (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references elections (id),
  receipt_hash text not null unique,
  unique (id, election_id)
);

-- الربط الهوية↔الورقة: يُملأ فقط في السرية الإدارية المحدودة.
create table ballot_identity_links (
  sheet_id      uuid primary key,
  election_id   uuid not null,
  university_id text not null references allowed_students (university_id),
  foreign key (sheet_id, election_id) references ballot_sheets (id, election_id),
  unique (election_id, university_id)
);

create table ballot_choices (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null,
  election_id  uuid not null,
  section_id   uuid not null,
  candidate_id uuid,
  role         text check (role in ('president', 'vice')),
  rating       smallint check (rating between 1 and 5),
  rank         smallint check (rank >= 1),
  other_text   text check (other_text is null or length(other_text) <= 200),
  abstain      boolean not null default false,
  foreign key (sheet_id, election_id) references ballot_sheets (id, election_id),
  foreign key (section_id, election_id) references election_sections (id, election_id),
  foreign key (candidate_id, section_id) references candidates (id, section_id),
  -- كل صف: امتناع، أو مرشح، أو نص "أخرى" — واحد فقط
  check (num_nonnulls(candidate_id, other_text) + abstain::int = 1),
  check (not abstain or (role is null and rating is null and rank is null))
);
create unique index ballot_choices_unique_candidate
  on ballot_choices (sheet_id, section_id, candidate_id, coalesce(role, ''))
  where candidate_id is not null;
create unique index ballot_choices_unique_abstain
  on ballot_choices (sheet_id, section_id) where abstain;
create index ballot_choices_election_idx on ballot_choices (election_id, section_id);

-- ───────── النتائج والتدقيق ─────────
create table election_results (
  id             uuid primary key default gen_random_uuid(),
  election_id    uuid not null references elections (id),
  rules_version  text not null,
  result         jsonb not null,
  report_sha256  text not null,
  status         results_status not null default 'under_review',
  submitted_by   uuid not null,
  approved_by    uuid,
  published_by   uuid,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  published_at   timestamptz,
  check (approved_by is null or approved_by <> submitted_by)
);

create table admin_audit_logs (
  id          bigserial primary key,
  actor       uuid,
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- الوصول الاستثنائي (Break-glass) — السرية الإدارية فقط
create table identity_access_requests (
  id           uuid primary key default gen_random_uuid(),
  election_id  uuid not null references elections (id),
  requested_by uuid not null references admin_users (user_id),
  reason       text not null check (length(btrim(reason)) >= 10),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired', 'used')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '24 hours'
);

create table identity_access_approvals (
  request_id uuid not null references identity_access_requests (id),
  approver   uuid not null references admin_users (user_id),
  approve    boolean not null,
  note       text,
  decided_at timestamptz not null default now(),
  primary key (request_id, approver)
);

create table incident_log (
  id          uuid primary key default gen_random_uuid(),
  election_id uuid references elections (id),
  kind        text not null check (kind in ('outage', 'technical_error', 'complaint', 'procedural_correction', 'impersonation_report')),
  description text not null,
  created_by  uuid references admin_users (user_id),
  created_at  timestamptz not null default now()
);

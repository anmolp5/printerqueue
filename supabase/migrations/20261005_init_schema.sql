-- Enable necessary extensions
create extension if not exists "uuid-ossp";
create extension if not exists btree_gist;

-- Enum Types
create type user_role as enum ('user', 'admin');
create type booking_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'canceled_late',
  'canceled_user',
  'canceled_admin'
);

-- Profiles Table (Synced from Microsoft Entra Login)
create table public.profiles (
  id uuid primary key default uuid_generate_v4(),
  microsoft_oid text unique not null,
  email text unique not null check (email like '%@illinois.edu'),
  full_name text not null,
  role user_role default 'user'::user_role,
  created_at timestamptz default now()
);

-- Seed initial admin(s)
insert into public.profiles (microsoft_oid, email, full_name, role)
values ('manual-init-admin-oid', 'admin@illinois.edu', 'Lab Admin', 'admin')
on conflict (email) do update set role = 'admin';

-- Bookings Table
create table public.bookings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_email text not null,
  file_name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_minutes integer not null default 10,
  
  -- Timing boundaries
  start_time timestamptz not null,
  -- end_time includes the mandatory 10 min buffer: start_time + duration + 10 mins
  end_time timestamptz not null,
  
  status booking_status not null default 'scheduled',
  late_warned boolean not null default false,
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Range Overlap Exclusion Constraint: Prevents double-booking overlapping active blocks
-- Active statuses: 'scheduled', 'in_progress'
alter table public.bookings
add constraint prevent_booking_overlap
exclude using gist (
  tstzrange(start_time, end_time, '[)') with &&
)
where (status in ('scheduled', 'in_progress'));

-- Indexes for performance
create index idx_bookings_time_status on public.bookings (start_time, end_time, status);
create index idx_bookings_user_id on public.bookings (user_id);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.bookings enable row level security;

-- Profiles RLS
create policy "Allow read access to authenticated profiles"
  on public.profiles for select
  using (true);

create policy "Allow admins to update roles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Bookings RLS
create policy "Anyone authenticated can view bookings"
  on public.bookings for select
  using (true);

create policy "Users can insert their own bookings"
  on public.bookings for insert
  with check (
    auth.uid() = user_id and
    user_email like '%@illinois.edu'
  );

create policy "Users can modify their own pending bookings or admins can modify all"
  on public.bookings for update
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

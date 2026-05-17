-- Run this in Supabase SQL Editor

create table public.users (
  discord_id text primary key,
  display_name text,
  avatar text,
  created_at timestamptz default now()
);

create table public.user_holdings (
  discord_id text references public.users(discord_id) on delete cascade,
  region text not null,
  port_type text not null,
  holdings jsonb not null default '[]',
  updated_at timestamptz default now(),
  primary key (discord_id, region, port_type)
);

create table public.user_wildcards (
  discord_id text references public.users(discord_id) on delete cascade,
  region text not null,
  port_type text not null,
  wildcards jsonb not null default '[]',
  updated_at timestamptz default now(),
  primary key (discord_id, region, port_type)
);

create table public.user_projections (
  discord_id text references public.users(discord_id) on delete cascade,
  region text not null,
  port_type text not null,
  start_bal numeric default 0,
  annual_dep numeric default 7000,
  years int default 30,
  return_pct numeric default 9,
  target_goal numeric default 1000000,
  updated_at timestamptz default now(),
  primary key (discord_id, region, port_type)
);

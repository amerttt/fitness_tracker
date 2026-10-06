-- One table per IndexedDB store. Row body lives in `data` (jsonb) so app fields can evolve
-- without migrations; id / updated_at / deleted are real columns for sync and indexing.
create or replace function public.reject_stale_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- last-write-wins: an older client copy never overwrites a newer server row
  if new.updated_at < old.updated_at then return null; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['exercises','workouts','sets','nutrition','metrics','measurements','days',
    'day_exercises','exercise_notes','profile','programs','phases','goals','cardio']
  loop
    execute format($f$
      create table public.%1$I (
        user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        id text not null,
        updated_at bigint not null,
        deleted smallint not null default 0,
        data jsonb not null default '{}'::jsonb,
        primary key (user_id, id)
      )$f$, t);
    execute format('create index %I on public.%I (user_id, updated_at)', t || '_sync_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.reject_stale_update()', t || '_stale', t);
  end loop;
end $$;

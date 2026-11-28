create or replace function public.same_day_pass(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.student_id = p_student and b.lesson_date = public.local_today()
      and b.status = 'cancelled'
      and b.cancel_reason in ('day_closed', 'transfer_declined', 'transfer_expired', 'admin')
  ) and not exists (
    select 1 from public.bookings b
    where b.student_id = p_student and b.lesson_date = public.local_today()
      and b.status not in ('cancelled', 'support_absent')
  )
$$;

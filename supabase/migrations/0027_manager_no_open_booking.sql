create or replace function public.admin_clear_rebook(p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  update public.bookings set rebook_from = null
  where student_id = p_student and rebook_from is not null;
  perform public.log_audit('user.rebook_open', 'user', p_student::text,
    jsonb_build_object('name', public.name_of(p_student)));
end $$;

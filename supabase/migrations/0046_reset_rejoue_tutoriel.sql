-- 0046 — Réinitialiser sa progression permet de rejouer le tutoriel.
-- Additive et idempotente ; aucun reset lors de son application.
-- Ne touche ni au solde cadeau, ni au claim, ni aux autres comptes.
create or replace function public.reset_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_draws integer := 0;
  v_scene integer := 0;
begin
  -- Authentification obligatoire : on n'efface que sa propre partie.
  if v_user is null then
    raise exception 'reinitialisation : connecte-toi d''abord' using errcode = 'P0001';
  end if;

  -- Conserver le comportement de reset_progress (0017).
  delete from public.pack_state where user_id = v_user;
  delete from public.pack_draws where user_id = v_user;
  get diagnostics v_draws = row_count;
  delete from public.pack_scene where user_id = v_user;
  get diagnostics v_scene = row_count;
  delete from public.last_packs where user_id = v_user;

  -- Rejouer le tutoriel du seul compte connecté. Le cadeau et son journal
  -- restent intacts : une réinitialisation ne crée aucune récompense.
  insert into public.onboarding_state(user_id, tutorial_completed_at)
    values(v_user, null)
    on conflict(user_id) do update set tutorial_completed_at = null;

  return jsonb_build_object(
    'status', 'reset',
    'draws', v_draws,
    'scene', v_scene
  );
end;
$$;

revoke all on function public.reset_progress() from public, anon;
grant execute on function public.reset_progress() to authenticated;

-- 0045 — le claim cadeau est idempotent pour qu'un nouvel appel ouvre
-- simplement un booster restant, sans recréditer le cadeau.
create or replace function public.onboarding_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid := auth.uid();
  v_done boolean;
  v_remaining integer;
  v_claimed boolean;
begin
  if v_user is null then
    raise exception 'tutoriel : connecte-toi' using errcode='P0001';
  end if;
  insert into public.onboarding_state(user_id) values(v_user) on conflict do nothing;
  select tutorial_completed_at is not null into v_done
    from public.onboarding_state where user_id=v_user;
  select boosters_remaining, claimed_at is not null
    into v_remaining, v_claimed from public.return_gifts where user_id=v_user;
  return jsonb_build_object(
    'tutorial_completed',coalesce(v_done,false),
    'gift_available',coalesce(v_done,false) and coalesce(v_remaining,0)>0,
    'gift_claimed',coalesce(v_claimed,false),
    'gift_remaining',coalesce(v_remaining,0),
    'message','Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.'
  );
end $$;

revoke all on function public.onboarding_status() from public,anon;
grant execute on function public.onboarding_status() to authenticated;

create or replace function public.claim_return_gift()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid := auth.uid();
  v_done boolean;
  v_gift public.return_gifts;
begin
  if v_user is null then
    raise exception 'cadeau : connecte-toi' using errcode='P0001';
  end if;
  select tutorial_completed_at is not null into v_done
    from public.onboarding_state where user_id=v_user for update;
  if not coalesce(v_done,false) then
    raise exception 'cadeau : termine le tutoriel avant de le réclamer' using errcode='P0001';
  end if;
  select * into v_gift from public.return_gifts where user_id=v_user for update;
  if v_gift.user_id is null or v_gift.boosters_remaining < 1 then
    raise exception 'cadeau : déjà réclamé ou indisponible' using errcode='P0001';
  end if;
  -- Une relance ne modifie pas le stock : elle confirme seulement le claim
  -- déjà acquis afin que le client puisse ouvrir le booster suivant.
  if v_gift.claimed_at is not null then
    return jsonb_build_object(
      'claimed',true,'already_claimed',true,
      'boosters_remaining',v_gift.boosters_remaining,
      'message','Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.'
    );
  end if;
  update public.return_gifts set claimed_at=now()
    where user_id=v_user returning * into v_gift;
  return jsonb_build_object(
    'claimed',true,'already_claimed',false,
    'boosters_remaining',v_gift.boosters_remaining,
    'message','Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.'
  );
end $$;

revoke all on function public.claim_return_gift() from public,anon;
grant execute on function public.claim_return_gift() to authenticated;

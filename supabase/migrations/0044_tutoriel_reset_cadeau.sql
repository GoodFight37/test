-- 0044 — remise a zero globale, tutoriel et cadeau de reprise.
-- La ligne singleton rend l'effet de reset unique meme si le script est rejoue.
-- Aucun identifiant de compte, profil, ami, vente conclue ou echange resolu n'est supprime.

create table if not exists public.progression_reset_markers (
  id text primary key check (id = 'tutoriel-cadeau-2026'),
  applied_at timestamptz not null default now()
);
revoke all on table public.progression_reset_markers from public, anon, authenticated;

create table if not exists public.onboarding_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tutorial_completed_at timestamptz
);
alter table public.onboarding_state enable row level security;
revoke all on table public.onboarding_state from public, anon, authenticated;
drop policy if exists "lecture onboarding personnel" on public.onboarding_state;
create policy "lecture onboarding personnel" on public.onboarding_state for select to authenticated using (auth.uid()=user_id);

create table if not exists public.return_gifts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  boosters_remaining integer not null default 5 check (boosters_remaining between 0 and 5),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.return_gifts enable row level security;
revoke all on table public.return_gifts from public, anon, authenticated;
drop policy if exists "lecture cadeau personnel" on public.return_gifts;
create policy "lecture cadeau personnel" on public.return_gifts for select to authenticated using (auth.uid()=user_id);

create table if not exists public.return_gift_draws (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  drawn_at timestamptz not null default now(),
  cards jsonb not null check (jsonb_array_length(cards) = 5)
);
create index if not exists return_gift_draws_user_idx on public.return_gift_draws(user_id, drawn_at desc);
alter table public.return_gift_draws enable row level security;
revoke all on table public.return_gift_draws from public, anon, authenticated;
drop policy if exists "lecture tirages cadeau personnel" on public.return_gift_draws;
create policy "lecture tirages cadeau personnel" on public.return_gift_draws for select to authenticated using (auth.uid()=user_id);
revoke all on sequence public.return_gift_draws_id_seq from public, anon, authenticated;

-- Le tirage cadeau est auditable dans le journal canonique, tout en restant
-- exclu du pity et des Last Packs de la réserve payante.
alter table public.pack_draws add column if not exists kind text not null default 'live';
create or replace function public._last_pack_publish()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind='gift' then return new; end if;
  insert into public.last_packs(user_id,drawn_at,expires_at,cards) values(new.user_id,new.drawn_at,new.drawn_at+interval '10 minutes',new.cards);
  delete from public.last_packs where user_id=new.user_id and expires_at<now()-interval '1 hour';
  return new;
end $$;

create or replace function public.onboarding_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_done boolean; v_remaining integer;
begin
  if v_user is null then raise exception 'tutoriel : connecte-toi' using errcode='P0001'; end if;
  insert into public.onboarding_state(user_id) values(v_user) on conflict do nothing;
  select tutorial_completed_at is not null into v_done from public.onboarding_state where user_id=v_user;
  select boosters_remaining into v_remaining from public.return_gifts where user_id=v_user;
  return jsonb_build_object('tutorial_completed',coalesce(v_done,false),'gift_available',coalesce(v_done,false) and coalesce(v_remaining,0)>0,'gift_remaining',coalesce(v_remaining,0),'gift_claimed',coalesce(v_remaining,0)=0,'message','Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.');
end $$;

revoke all on function public.onboarding_status() from public,anon;
grant execute on function public.onboarding_status() to authenticated;

create or replace function public.complete_tutorial()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_at timestamptz := now();
begin
  if v_user is null then raise exception 'tutoriel : connecte-toi' using errcode='P0001'; end if;
  insert into public.onboarding_state(user_id,tutorial_completed_at) values(v_user,v_at)
  on conflict(user_id) do update set tutorial_completed_at=coalesce(public.onboarding_state.tutorial_completed_at,excluded.tutorial_completed_at);
  return public.onboarding_status();
end $$;

revoke all on function public.complete_tutorial() from public,anon;
grant execute on function public.complete_tutorial() to authenticated;

create or replace function public.claim_return_gift()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_done boolean; v_gift public.return_gifts;
begin
  if v_user is null then raise exception 'cadeau : connecte-toi' using errcode='P0001'; end if;
  select tutorial_completed_at is not null into v_done from public.onboarding_state where user_id=v_user for update;
  if not coalesce(v_done,false) then raise exception 'cadeau : termine le tutoriel avant de le réclamer' using errcode='P0001'; end if;
  select * into v_gift from public.return_gifts where user_id=v_user for update;
  if v_gift.user_id is null or v_gift.boosters_remaining < 1 then raise exception 'cadeau : déjà réclamé ou indisponible' using errcode='P0001'; end if;
  if v_gift.claimed_at is not null then raise exception 'cadeau : déjà réclamé' using errcode='P0001'; end if;
  update public.return_gifts set claimed_at=now() where user_id=v_user returning * into v_gift;
  return jsonb_build_object('claimed',true,'boosters_remaining',v_gift.boosters_remaining,'message','Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.');
end $$;

revoke all on function public.claim_return_gift() from public,anon;
grant execute on function public.claim_return_gift() to authenticated;

-- Tirage cadeau : meme moteur/poids/anti-doublons que open_pack, avec garantie
-- standard (pas d'economie d'ouverture). Les triggers economiques ignorent
-- gift; le journal reste separe et la collection/provenance est ecrite serveur.
create or replace function public.open_return_gift_pack()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_gift public.return_gifts; v_now timestamptz:=now();
  v_rare boolean; v_pity integer; v_weights jsonb; v_live text[];
  v_used text[]:='{}'; v_drawn jsonb[]:='{}'; v_cards jsonb:='[]';
  v_i integer; v_slug text; v_rarity text; v_variant text; v_card jsonb; v_save public.saves;
begin
  if v_user is null then raise exception 'cadeau : connecte-toi' using errcode='P0001'; end if;
  select * into v_gift from public.return_gifts where user_id=v_user for update;
  if v_gift.user_id is null or v_gift.claimed_at is null or v_gift.boosters_remaining < 1 then raise exception 'cadeau : réclame le cadeau disponible' using errcode='P0001'; end if;
  if not exists (select 1 from public.onboarding_state where user_id=v_user and tutorial_completed_at is not null) then raise exception 'cadeau : termine le tutoriel avant de l''ouvrir' using errcode='P0001'; end if;
  select count(*)::integer into v_pity
    from public.pack_draws d
   where d.user_id=v_user and d.kind='live'
     and d.id > coalesce((select max(legendary.id) from public.pack_draws legendary where legendary.user_id=v_user and legendary.kind='live' and exists (select 1 from jsonb_array_elements(legendary.cards) c where c->>'rarity'='legendary')),0);
  v_live:=public._direct_live_logins();
  v_rare:=v_pity + 1 >= 12 or public._pack_random_int(1000)<1;
  for v_i in 1..5 loop
    if v_rare then v_weights:='{"epic":82,"legendary":18}'::jsonb;
    elsif v_i<=2 then v_weights:='{"common":42,"uncommon":30,"rare":18,"epic":8,"legendary":2}'::jsonb;
    elsif v_i=3 then v_weights:='{"common":34,"uncommon":32,"rare":22,"epic":10,"legendary":2}'::jsonb;
    elsif v_i=4 then v_weights:='{"common":20,"uncommon":34,"rare":28,"epic":15,"legendary":3}'::jsonb;
    else v_weights:='{"rare":82,"epic":15,"legendary":3}'::jsonb; end if;
    if v_i=5 and (v_pity+1>=12 or v_rare) then
      if v_pity+1>=12 then v_weights:='{"legendary":1}'::jsonb; else v_weights:='{"epic":82,"legendary":18}'::jsonb; end if;
    end if;
    v_slug:=public._pack_choose_creator(v_weights,v_used); v_used:=v_used||v_slug;
    select c.rarity into v_rarity from public.creators c where c.slug=v_slug;
    v_variant:=case when v_i=5 and v_slug=any(coalesce(v_live,'{}'::text[])) then 'live' else public._pack_choose_variant(v_rarity,v_rare,v_slug=any(coalesce(v_live,'{}'::text[]))) end;
    v_card:=jsonb_build_object('id',gen_random_uuid()::text,'obtainedAt',(extract(epoch from v_now)*1000)::bigint,'creatorSlug',v_slug,'rarity',v_rarity,'variant',v_variant,'rareDrop',v_rare);
    v_drawn:=v_drawn||v_card;
  end loop;
  for v_i in 1..array_length(v_drawn,1) loop v_cards:=v_cards||v_drawn[v_i]; end loop;
  insert into public.return_gift_draws(user_id,drawn_at,cards) values(v_user,v_now,v_cards);
  perform public.card_claim_add(v_user,v_cards,'cadeau');
  update public.return_gifts set boosters_remaining=boosters_remaining-1 where user_id=v_user returning * into v_gift;
  -- Ajouter les cartes avec un helper dédié au cadeau préserve tous les
  -- compteurs ordinaires. Le helper des boosters normaux reste inchangé.
  v_save:=public._save_add_gift_cards(v_user,v_cards,coalesce((select packs from public.pack_state where user_id=v_user),2),coalesce((select last_regen_at from public.pack_state where user_id=v_user),v_now),coalesce((select openings from public.pack_state where user_id=v_user),0),v_now);
  return jsonb_build_object('cards',v_cards,'gift_remaining',v_gift.boosters_remaining,'save',to_jsonb(v_save));
end $$;

revoke all on function public.open_return_gift_pack() from public,anon;
grant execute on function public.open_return_gift_pack() to authenticated;

-- Helper réservé au cadeau : ajouter les cartes sans changer les compteurs
-- de réserve/ouvertures, ni remplacer le helper des boosters ordinaires.
create or replace function public._save_add_gift_cards(
  p_user uuid, p_cards jsonb, p_packs integer, p_last_regen timestamptz,
  p_openings integer, p_now timestamptz
)
returns public.saves language plpgsql security definer set search_path=public as $$
declare v_save public.saves; v_state jsonb; v_ms bigint := (extract(epoch from p_now)*1000)::bigint;
begin
  select * into v_save from public.saves where user_id=p_user for update;
  if v_save.user_id is null then
    v_state:=jsonb_build_object('version',9,'playerId',p_user::text,'createdAt',v_ms,'updatedAt',v_ms,'level',1,'xp',0,'points',40,'hourglasses',2,'packs',2,'lastPackRegen',v_ms,'openings',0,'cards','[]'::jsonb,'claimedTiers','{}'::jsonb,'claimedMilestones','[]'::jsonb,'themeId','default','tokens',0,'streamer',jsonb_build_object('subscribers',0,'lastSeenAt',v_ms,'tokensDay','','tokensToday',0,'video',null,'event',null,'setup','[]'::jsonb,'guests','[]'::jsonb,'raid',null),'pityCounter',0,'missionDay',to_char(p_now-interval '6 hours','YYYY-MM-DD'),'missions','{}'::jsonb,'streakDay','','streak',0,'streakJackpot',false,'sceneDay','','tribunal',jsonb_build_object('day','','verdicts','{}'::jsonb,'claimed',false));
    insert into public.saves(user_id,state,save_version,device_updated_at,state_checksum,updated_at) values(p_user,v_state,9,v_ms,md5(v_state::text),p_now) returning * into v_save;
  end if;
  v_state:=jsonb_set(v_save.state,'{cards}',coalesce(v_save.state->'cards','[]'::jsonb)||coalesce(p_cards,'[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{updatedAt}',to_jsonb(v_ms),true);
  update public.saves set state=v_state,state_checksum=md5(v_state::text),device_updated_at=v_ms,updated_at=p_now where user_id=p_user returning * into v_save;
  return v_save;
end $$;

revoke all on function public._save_add_gift_cards(uuid,jsonb,integer,timestamptz,integer,timestamptz) from public,anon,authenticated;

-- Une seule transaction applique la remise a zero et preprovisionne un cadeau
-- par compte existant. Le marqueur est pose dans la meme transaction.
do $$
declare v_apply boolean;
begin
  insert into public.progression_reset_markers(id) values('tutoriel-cadeau-2026') on conflict do nothing;
  get diagnostics v_apply = row_count;
  if not v_apply then return; end if;
  insert into public.onboarding_state(user_id) select id from auth.users on conflict do nothing;
  insert into public.return_gifts(user_id) select id from auth.users on conflict do nothing;
  update public.trades set status='cancelled',resolved_at=now() where status='open';
  delete from public.market_listings where status='open';
  delete from public.last_pack_steals;
  delete from public.last_packs;
  delete from public.pack_scene;
  delete from public.pack_draws;
  delete from public.pack_state;
  delete from public.user_cards;
  delete from public.card_claims;
  update public.wallets set points=40,updated_at=now();
  delete from public.token_ledger;
  update public.tokens set tokens=0,updated_at=now();
  delete from public.arena_entries;
  delete from public.arena_drafts;
  delete from public.arena_claims;
  delete from public.streamer_setup;
  delete from public.streamer_channels;
  delete from public.streamer_videos;
  delete from public.streamer_guests;
  delete from public.streamer_raids;
  delete from public.streamer_sacrifices;
  delete from public.wallet_ledger where kind <> 'sell';
  -- No personal rewards can be claimed after reset; historical sales ledger
  -- entries are deliberately preserved (only progression-kind rows removed).
  update public.saves set state=state||jsonb_build_object('updatedAt',(extract(epoch from now())*1000)::bigint,'level',1,'xp',0,'points',40,'hourglasses',2,'packs',2,'lastPackRegen',(extract(epoch from now())*1000)::bigint,'openings',0,'cards','[]'::jsonb,'claimedTiers','{}'::jsonb,'claimedMilestones','[]'::jsonb,'themeId','default','tokens',0,'streamer',jsonb_build_object('subscribers',0,'lastSeenAt',(extract(epoch from now())*1000)::bigint,'tokensDay','','tokensToday',0,'video',null,'event',null,'setup','[]'::jsonb,'guests','[]'::jsonb,'raid',null),'pityCounter',0,'missionDay',to_char(now()-interval '6 hours','YYYY-MM-DD'),'missions','{}'::jsonb,'streakDay','','streak',0,'streakJackpot',false,'sceneDay','','tribunal',jsonb_build_object('day','','verdicts','{}'::jsonb,'claimed',false)),state_checksum=md5((state||jsonb_build_object('updatedAt',(extract(epoch from now())*1000)::bigint,'level',1,'xp',0,'points',40,'hourglasses',2,'packs',2,'lastPackRegen',(extract(epoch from now())*1000)::bigint,'openings',0,'cards','[]'::jsonb,'claimedTiers','{}'::jsonb,'claimedMilestones','[]'::jsonb,'themeId','default','tokens',0,'streamer',jsonb_build_object('subscribers',0,'lastSeenAt',(extract(epoch from now())*1000)::bigint,'tokensDay','','tokensToday',0,'video',null,'event',null,'setup','[]'::jsonb,'guests','[]'::jsonb,'raid',null),'pityCounter',0,'missionDay',to_char(now()-interval '6 hours','YYYY-MM-DD'),'missions','{}'::jsonb,'streakDay','','streak',0,'streakJackpot',false,'sceneDay','','tribunal',jsonb_build_object('day','','verdicts','{}'::jsonb,'claimed',false)))::text),device_updated_at=(extract(epoch from now())*1000)::bigint,updated_at=now();
  update public.stats set unique_creators=0,total_cards=0,legendary_cards=0,epic_cards=0,gold_cards=0,holo_cards=0,level=1,points=40,verified=true,updated_at=now();
end $$;

create or replace function public._wallet_on_draw()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kind = 'gift' then return new; end if;
  perform public._wallet_apply(
    new.user_id,
    case when new.kind = 'scene' then 10 else 12 end,
    case when new.kind = 'scene' then 'scene' else 'pack' end,
    new.id::text
  );
  if new.kind <> 'scene' then
    perform public._tokens_apply(
      new.user_id,
      public._tokens_per_pack(new.drawn_at),
      'pack',
      new.id::text
    );
  end if;
  return new;
end $$;

revoke all on function public.onboarding_status() from public,anon;
grant execute on function public.onboarding_status() to authenticated;
revoke all on function public.complete_tutorial() from public,anon;
grant execute on function public.complete_tutorial() to authenticated;
revoke all on function public.claim_return_gift() from public,anon;
grant execute on function public.claim_return_gift() to authenticated;
revoke all on function public.open_return_gift_pack() from public,anon;
grant execute on function public.open_return_gift_pack() to authenticated;

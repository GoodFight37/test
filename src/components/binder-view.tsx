"use client";

/**
 * L'écran **Binder** : le classeur, ses milles cartes, la recherche, le tri et
 * les filtres — collés sous la barre pendant qu'on feuillette.
 */
import { useMemo, useState, type CSSProperties } from "react";

import { ArrowDownWideNarrow, BookOpen, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { CreatorCard } from "@/components/creator-card";

import { CardInspectModal } from "@/components/card-inspect-modal";
import { SEASON_BY_ID } from "@/lib/seasons";
import { BINDER_SORTS, sortBinder, type BinderSort } from "@/lib/binder-sort";

import { useNow } from "@/hooks/use-game";

import { useBackHandler } from "@/hooks/use-back-handler";
import { useLive } from "@/hooks/use-live";
import { CATALOG_SIZE, CREATORS, RETIRED_BY_SLUG, RETIRED_CREATORS, type CardVariant, type Creator, type Rarity } from "@/lib/catalog";

import { liveFor } from "@/lib/live";

import { craftQuote, type GameView } from "@/lib/game-engine";


type CollectionFilter = "all" | "owned" | "missing" | "live" | "retired" | Rarity;

const RARITY_COUNTS = CREATORS.reduce<Record<Rarity, number>>(
  (acc, creator) => {
    acc[creator.rarity] += 1;
    return acc;
  },
  { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
);


export function CollectionView({
  game,
  themeStyle,
  onCraft,
  onGoDrop,
}: {
  game: GameView;
  themeStyle?: CSSProperties;
  /** Rejoindre un créateur manquant : dit `true` quand c'est payé. */
  onCraft: (slug: string) => Promise<boolean>;
  onGoDrop?: () => void;
}) {
  // Le classeur s'ouvre sur **ce qu'on possède**. Une première collection vide
  // reçoit une invitation à ouvrir un booster et un accès explicite au catalogue.
  const [filter, setFilter] = useState<CollectionFilter>("owned");
  const [pageGoal, setPageGoal] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BinderSort>("catalog");
  const [page, setPage] = useState(0);
  const [crafting, setCrafting] = useState<string | null>(null);
  const [inspect, setInspect] = useState<{
    creator: Creator;
    count: number;
    variant: CardVariant;
    liveStream: ReturnType<typeof liveFor>;
  } | null>(null);
  // Le bouton retour d'Android ferme la fiche ouverte avant tout le reste :
  // c'est l'écran du dessus, et c'est ce que le doigt attend.
  useBackHandler(inspect !== null, () => setInspect(null));
  const live = useLive();
  // L'heure ne sert qu'à juger la fraîcheur du direct : une minute de précision
  // suffit (au-delà de dix minutes, tout disparaît de toute façon).
  const now = useNow(60_000);
  // Une page reste courte et tourne vite au pouce : 12 pochettes (3 × 4),
  // sans présenter tout le catalogue vide au premier regard.
  const perPage = 12;

  const owned = useMemo(() => {
    const map = new Map<
      string,
      {
        count: number;
        bestVariant: CardVariant;
        variants: Set<CardVariant>;
        /* La copie la plus récente : l'ordre « Dernières obtenues » la lit. */
        latestAt: number;
      }
    >();
    const variantScore: Record<CardVariant, number> = {
      standard: 1,
      live: 2,
      holo: 3,
      gold: 4,
    };
    for (const card of game.cards) {
      const value = map.get(card.creatorSlug) ?? {
        count: 0,
        bestVariant: "standard" as CardVariant,
        variants: new Set<CardVariant>(),
        latestAt: 0,
      };
      value.count += 1;
      value.latestAt = Math.max(value.latestAt, card.obtainedAt);
      value.variants.add(card.variant);
      if (variantScore[card.variant] > variantScore[value.bestVariant]) {
        value.bestVariant = card.variant;
      }
      map.set(card.creatorSlug, value);
    }
    return map;
  }, [game.cards]);

  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase("fr").trim();
    // Les Sortants que le joueur possède : ils s'affichent à la fin du classeur
    // (leur rang n'est plus comparable aux autres, et ils ne sont plus
    // tirables). Sans filtre « Sortants », ils restent visibles — une carte
    // possédée qui disparaîtrait de son propre classeur serait un bug.
    const retiredCards = RETIRED_CREATORS.filter((creator) => owned.has(creator.slug));
    const goalSlugs = pageGoal ? new Set(SEASON_BY_ID.get(pageGoal)?.slugs ?? []) : null;
    const matches = (creator: Creator) => {
      if (goalSlugs && !goalSlugs.has(creator.slug)) return false;
      if (q) {
        const hay = `${creator.displayName} ${creator.login} ${creator.category} #${creator.rank}`.toLocaleLowerCase("fr");
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    if (filter === "retired") return retiredCards.filter(matches);
    const current = CREATORS.filter((creator) => {
      if (!matches(creator)) return false;
      if (filter === "owned") return owned.has(creator.slug);
      if (filter === "missing") return !owned.has(creator.slug);
      if (filter === "live") return liveFor(live, creator.login, now) !== null;
      if (filter !== "all") return creator.rarity === filter;
      return true;
    });
    // Le tri s'applique à ce qui reste, puis la pagination coupe : chercher,
    // filtrer et trier donne la même première page, quel que soit l'ordre des
    // gestes. Les Sortants gardent leur place à la fin du classeur : leur rang
    // n'est plus comparable aux autres, et ils ne sont plus tirables.
    const sorted = sortBinder(
      current,
      sort,
      (slug) => owned.get(slug)?.count ?? 0,
      (slug) => owned.get(slug)?.latestAt ?? 0,
    );
    return filter === "all" ? [...sorted, ...retiredCards] : sorted;
  }, [filter, live, now, owned, pageGoal, query, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const showPager = filtered.length > perPage;
  const safePage = Math.min(page, totalPages - 1);
  const visibleCreators = filtered.slice(
    safePage * perPage,
    (safePage + 1) * perPage,
  );
  const progress = Math.floor((game.stats.uniqueCreators / CREATORS.length) * 100);
  const nextPages = useMemo(() => game.seasons
    .filter((season) => season.owned > 0 && season.owned < season.total)
    .sort((a, b) => (a.total - a.owned) - (b.total - b.owned) || (b.owned / b.total) - (a.owned / a.total) || a.id.localeCompare(b.id))
    .slice(0, 3), [game.seasons]);
  const activePage = pageGoal ? game.seasons.find((season) => season.id === pageGoal) : null;

  // Combien de cartes du classeur ne sont plus tirables : ce sont les Sortants
  // du joueur, et c'est ce que le filtre compte.
  const retiredOwned = useMemo(
    () => [...owned.keys()].filter((slug) => RETIRED_BY_SLUG.has(slug)).length,
    [owned],
  );

  return (
    <div className="view collection-view" style={themeStyle}>
      <section className="page-title-row">
        <div>
          <span className="drop-section-kicker">LES NOMS QUE TU GARDES</span>
          <h1>Mon classeur</h1>
        </div>
        <div className="collection-score">
          {game.stats.uniqueCreators ? (
            <><strong>{progress}%</strong><span>complété</span></>
          ) : (
            <><strong>À toi</strong><span>ta première carte</span></>
          )}
        </div>
      </section>

      {game.stats.uniqueCreators ? (
        <>
          <div className="progress-track large">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="collection-meta">
            <span>{game.stats.uniqueCreators} / {CREATORS.length} streameurs découverts</span>
            <span>{game.stats.totalCards} cartes obtenues</span>
          </div>
        </>
      ) : null}

      {game.stats.uniqueCreators > 0 ? (
        <div className="binder-quick-views" aria-label="Parcourir ma collection">
          <button type="button" aria-pressed={sort === "recent" && filter === "owned" && !pageGoal && !query} onClick={() => {
            setSort("recent"); setFilter("owned"); setPageGoal(null); setQuery(""); setPage(0);
          }}>Dernières reçues <ChevronRight size={15} /></button>
          <span>{game.stats.duplicates} doublon{game.stats.duplicates > 1 ? "s" : ""} recyclable{game.stats.duplicates > 1 ? "s" : ""}</span>
        </div>
      ) : null}

      {nextPages.length > 0 ? (
        <section className="binder-next-pages" aria-label="Pages à compléter">
          <div className="drop-section-label"><span>UNE PAGE À COMPLÉTER</span><BookOpen size={16} /></div>
          {nextPages.slice(0, 1).map((season) => (
            <button key={season.id} type="button" aria-pressed={pageGoal === season.id}
              onClick={() => { setPageGoal(season.id); setFilter("missing"); setQuery(""); setPage(0); }}>
              <span className="binder-page-number">{season.id.replace("S", "")}</span>
              <span className="binder-page-title"><strong>{season.name}</strong><small>{season.owned} / {season.total} noms réunis</small></span>
              <span className="binder-page-left">Encore <b>{season.total - season.owned}</b></span>
              <ChevronRight size={16} />
            </button>
          ))}
          {nextPages.length > 1 ? (
            <details className="binder-other-pages">
              <summary>Les autres pages en cours <ChevronRight size={15} /></summary>
              {nextPages.slice(1).map((season) => (
                <button key={season.id} type="button" aria-pressed={pageGoal === season.id}
                  onClick={() => { setPageGoal(season.id); setFilter("missing"); setQuery(""); setPage(0); }}>
                  <span className="binder-page-title"><strong>{season.name}</strong><small>{season.owned} / {season.total} noms réunis</small></span>
                  <span className="binder-page-left">Encore <b>{season.total - season.owned}</b></span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </details>
          ) : null}
        </section>
      ) : null}

      {/* La recherche, le tri et les filtres restent **collés sous la barre**
          pendant qu'on feuillette : chercher un créateur après avoir descendu
          trois pages ne devrait pas demander de remonter trois pages. */}
      <div className="binder-tools">
          <label className="search-field">
            <Search size={17} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={`Rechercher un streameur, rang (#1 à #${CATALOG_SIZE}) ou jeu…`}
            aria-label="Rechercher un créateur"
          />
          {query ? (
            <button
              onClick={() => {
                setQuery("");
                setPage(0);
              }}
              aria-label="Effacer la recherche"
            >
              <X size={15} />
            </button>
          ) : null}
        </label>

        <label className="sort-field">
          <ArrowDownWideNarrow size={17} />
          <span className="sort-label">Trier</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as BinderSort);
              setPage(0);
            }}
            aria-label="Trier le classeur"
          >
            {BINDER_SORTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-chips" aria-label="Filtres de collection">
          {(
            [
              ["all", `Toutes (${CREATORS.length})`],
              ["owned", `Obtenues (${game.stats.uniqueCreators})`],
              ["missing", "À découvrir"],
              // Les Sortants n'apparaissent que s'il y en a : un filtre vide n'a
              // rien à faire dans la barre.
              ...(retiredOwned
                ? ([["retired", `Sortants (${retiredOwned})`]] as [CollectionFilter, string][])
                : []),
              // Le direct n'apparaît que si l'app sait vraiment qui streame : un
              // filtre qui ne peut rien donner n'a rien à faire là.
              ...(live.configured && live.count && !live.stale
                ? ([["live", `En direct (${live.count})`]] as [CollectionFilter, string][])
                : []),
              ["legendary", `Légendaires (${RARITY_COUNTS.legendary})`],
              ["epic", `Épiques (${RARITY_COUNTS.epic})`],
              ["rare", `Rares (${RARITY_COUNTS.rare})`],
              ["uncommon", `Peu communes (${RARITY_COUNTS.uncommon})`],
              ["common", `Communes (${RARITY_COUNTS.common})`],
            ] as [CollectionFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => {
                // **Aucun son.** Le joueur a demandé le 8 octobre 2026 au soir
                // de retirer les deux derniers sons de déplacement, le filtre
                // et la page : changer de filtre, c'est aller ailleurs.
                setFilter(value);
                setPageGoal(null);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>


      {activePage ? (
        <div className="binder-active-page" role="status">
          <span>À découvrir · <strong>{activePage.name}</strong></span>
          <button type="button" aria-label="Retirer le filtre de page" onClick={() => { setPageGoal(null); setPage(0); }}><X size={17} /></button>
        </div>
      ) : null}

      {showPager ? <div className="binder-pager">
        <button
          onClick={() => {
            // **Aucun son** : tourner une page, c'est se déplacer (retiré le
            // 8 octobre 2026 au soir, comme le filtre ci-dessus).
            setPage((p) => Math.max(0, p - 1));
          }}
          disabled={safePage <= 0}
        >
          <ChevronLeft size={15} />
          <span>Précédent</span>
        </button>
        <span>
          Page <strong>{safePage + 1}</strong> sur {totalPages} · {filtered.length} cartes
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePage >= totalPages - 1}
        >
          <span>Suivant</span>
          <ChevronRight size={15} />
        </button>
      </div> : null}

      <div className="binder-page">
        <div className="collection-grid">
          {visibleCreators.map((creator) => {
            const item = owned.get(creator.slug);
            const currentLive = liveFor(live, creator.login, now);
            return (
              <div className="binder-pocket" key={creator.slug}>
                <CreatorCard
                  creator={creator}
                  variant={item?.bestVariant ?? "standard"}
                  locked={!item}
                  compact
                  liveStream={currentLive}
                  onClick={() => setInspect({
                    creator,
                    count: item?.count ?? 0,
                    variant: item?.bestVariant ?? "standard",
                    liveStream: currentLive,
                  })}
                />
                {item && item.count > 1 ? (
                  <span className="pocket-count">×{item.count}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        {!filtered.length ? (
          <div className="binder-empty-state">
            {filter === "owned" && game.stats.uniqueCreators === 0 && !query ? (
              <>
                <strong>Ta collection commence avec le prochain booster.</strong>
                <span>Les cartes que tu découvres apparaîtront ici.</span>
                {onGoDrop ? <button type="button" className="binder-first-drop" onClick={onGoDrop}>Retour au Drop <ChevronRight size={16} /></button> : null}
                <button type="button" onClick={() => { setFilter("all"); setPageGoal(null); setPage(0); }}>Voir les créateurs à découvrir</button>
              </>
            ) : (
              <span>Aucune carte ne correspond à cette recherche.</span>
            )}
          </div>
        ) : null}
      </div>

      {inspect ? (
        <CardInspectModal
          creator={inspect.creator}
          ownedCount={inspect.count}
          variant={inspect.variant}
          liveStream={inspect.liveStream}
          quote={craftQuote({ cards: game.cards }, inspect.creator.slug)}
          balance={game.player.points}
          crafting={crafting === inspect.creator.slug}
          onCraft={async (slug) => {
            setCrafting(slug);
            try {
              // Le prix et la règle viennent du moteur (`craftQuote`) : la modale
              // ne décide rien, elle demande.
              if (await onCraft(slug)) setInspect(null);
            } finally {
              setCrafting(null);
            }
          }}
          onClose={() => setInspect(null)}
        />
      ) : null}
    </div>
  );
}


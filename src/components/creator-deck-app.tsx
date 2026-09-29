"use client";
import { useCallback, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ClipboardCopy,
  ClipboardPaste,
  Clock3,
  Coins,
  Gem,
  Home,
  Hourglass,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Volume2,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { Card3D } from "@/components/card3d";
import { CreatorCard } from "@/components/creator-card";
import { PackArtwork } from "@/components/pack-artwork";
import { PackOpening } from "@/components/pack-opening";
import { useGame, useNow } from "@/hooks/use-game";
import { useSoundSettings } from "@/hooks/use-sound-settings";
import { useTestMode } from "@/hooks/use-test-mode";
import {
  CREATORS,
  CREATOR_BY_SLUG,
  PACKS,
  RARITY_META,
  type CardVariant,
  type Creator,
  type PackType,
  type Rarity,
} from "@/lib/catalog";
import { getGameView, type GameView } from "@/lib/game-engine";
import { gameStore } from "@/lib/game-store";
import { soundSettings } from "@/lib/sound-settings";
import { testModeStore } from "@/lib/test-mode";

type GameState = GameView;
type Tab = "home" | "collection" | "missions" | "profile";
type CollectionFilter = "all" | "owned" | Rarity;

const RARITY_COUNTS = CREATORS.reduce<Record<Rarity, number>>(
  (acc, creator) => {
    acc[creator.rarity] += 1;
    return acc;
  },
  { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
);

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatCountdown(date: number | null, now: number) {
  if (!date) return "Réserve pleine";
  const remaining = Math.max(0, date - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function LoadingScreen() {
  return (
    <main className="app-shell loading-screen">
      <div className="brand-mark large" aria-hidden="true">
        <span>CD</span>
      </div>
      <LoaderCircle className="spin" size={26} />
      <p>Préparation du Top 500 Twitch FR…</p>
    </main>
  );
}

function TopBar({ game }: { game: GameState }) {
  const levelBase = Math.max(0, (game.player.level - 1) * 100);
  const levelProgress = Math.min(
    100,
    ((game.player.xp - levelBase) / Math.max(100, game.player.xpNext - levelBase)) * 100,
  );
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span>CD</span>
        </div>
        <div>
          <strong>CreatorDeck</strong>
          <small>Top 500 Twitch FR · S01</small>
        </div>
      </div>
      <div className="top-actions">
        <div className="currency-chip" title="Sabliers">
          <Hourglass size={14} />
          <b>{game.player.hourglasses}</b>
        </div>
        <div className="currency-chip warm" title="Points de collection">
          <Coins size={14} />
          <b>{formatNumber(game.player.points)}</b>
        </div>
        <div className="level-chip" title={`Niveau ${game.player.level}`}>
          <span>{game.player.level}</span>
          <i style={{ width: `${levelProgress}%` }} />
        </div>
      </div>
    </header>
  );
}

function HomeView({
  game,
  selectedPack,
  onOpen,
  onUseHourglass,
  opening,
  usingHourglass,
  testMode,
  now,
}: {
  game: GameState;
  selectedPack: PackType;
  onOpen: () => void;
  onUseHourglass: () => void;
  opening: boolean;
  usingHourglass: boolean;
  testMode: boolean;
  now: number;
}) {
  const pack = PACKS[selectedPack];
  const stock =
    selectedPack === "live" ? game.player.livePacks : game.player.archivePacks;
  const nextAt =
    selectedPack === "live" ? game.player.nextLiveAt : game.player.nextArchiveAt;
  const latest = [...game.cards].sort((a, b) => b.obtainedAt - a.obtainedAt).slice(0, 4);

  return (
    <div className="view home-view">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">ÉDITION TOP 500 FR</p>
          <h1>Prêt pour un nouveau drop&nbsp;?</h1>
        </div>
        <div className="season-badge">
          <Trophy size={15} />
          <span>500 Cartes</span>
        </div>
      </section>

      {/* Onglets de choix de booster retirés : un seul booster pour
          l'instant (le second concept reviendra plus tard). */}

      <section className={`pack-stage stage-${selectedPack}`}>
        <div className="stage-glow" />
        <div className="pack-shadow" />
        <PackArtwork packType={selectedPack} />
        <div className="pack-copy">
          <p>{pack.eyebrow}</p>
          <h2>{pack.label}</h2>
          <span>{pack.description}</span>
        </div>
      </section>

      <section className="open-panel">
        {testMode ? (
          <p className="testmode-banner" role="status">
            <Zap size={13} />
            Mode test : ouvertures illimitées, ta collection n&apos;est pas modifiée
          </p>
        ) : null}
        <div className="stock-row">
          <div>
            <span>Disponibles</span>
            <strong>
              {testMode ? (
                <>
                  ∞<small> illimité</small>
                </>
              ) : (
                <>
                  {stock}<small>/{pack.max}</small>
                </>
              )}
            </strong>
          </div>
          <div className="timer-copy">
            <Clock3 size={14} />
            <span>{formatCountdown(nextAt, now)}</span>
          </div>
        </div>
        <button
          className="primary-action"
          onClick={onOpen}
          disabled={(!testMode && stock <= 0) || opening}
        >
          {opening ? <LoaderCircle className="spin" size={19} /> : <Zap size={19} />}
          <span>{testMode || stock > 0 ? "Ouvrir le booster" : "Recharge en cours"}</span>
          {testMode || stock > 0 ? <ChevronRight size={19} /> : null}
        </button>
        <button
          className="secondary-action"
          onClick={onUseHourglass}
          disabled={
            testMode ||
            stock >= pack.max ||
            game.player.hourglasses <= 0 ||
            usingHourglass
          }
        >
          <Hourglass size={15} />
          <span>
            Utiliser 1 sablier ({game.player.hourglasses} disp.) · retire{" "}
            {selectedPack === "live" ? "15 min" : "1 h"}
          </span>
        </button>
        <div className="guarantee-row">
          <ShieldCheck size={14} />
          <span>
            {selectedPack === "live"
              ? "1 variante Live garantie · aucun doublon interne"
              : "1 Rare ou mieux garantie · chance de Gold"}
          </span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TON CLASSEUR</p>
            <h2>Dernières trouvailles</h2>
          </div>
          <span className="completion-pill">
            {game.stats.uniqueCreators}/{CREATORS.length}
          </span>
        </div>
        {latest.length ? (
          <div className="mini-card-row">
            {latest.map((card) => {
              const creator = CREATOR_BY_SLUG.get(card.creatorSlug);
              return creator ? (
                <CreatorCard
                  key={card.id}
                  creator={creator}
                  variant={card.variant}
                  compact
                />
              ) : null;
            })}
          </div>
        ) : (
          <div className="empty-collection">
            <Layers3 size={25} />
            <div>
              <strong>Ton classeur de 500 streameurs t’attend</strong>
              <span>Ouvre ton premier booster pour lancer la collection.</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CollectionView({ game }: { game: GameState }) {
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const perPage = 30;

  const owned = useMemo(() => {
    const map = new Map<
      string,
      { count: number; bestVariant: CardVariant; variants: Set<CardVariant> }
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
      };
      value.count += 1;
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
    return CREATORS.filter((creator) => {
      if (q) {
        const hay = `${creator.displayName} ${creator.login} ${creator.category} #${creator.rank}`.toLocaleLowerCase("fr");
        if (!hay.includes(q)) return false;
      }
      if (filter === "owned") return owned.has(creator.slug);
      if (filter !== "all") return creator.rarity === filter;
      return true;
    });
  }, [filter, owned, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const visibleCreators = filtered.slice(
    safePage * perPage,
    (safePage + 1) * perPage,
  );
  const progress = Math.round((game.stats.uniqueCreators / CREATORS.length) * 100);

  return (
    <div className="view collection-view">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">TOP 500 TWITCH FR</p>
          <h1>Mon classeur</h1>
        </div>
        <div className="collection-score">
          <strong>{progress}%</strong>
          <span>complété</span>
        </div>
      </section>

      <div className="progress-track large">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="collection-meta">
        <span>{game.stats.uniqueCreators} / {CREATORS.length} streameurs découverts</span>
        <span>{game.stats.totalCards} cartes obtenues</span>
      </div>

      <label className="search-field">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Rechercher un streameur, rang (#1 à #500) ou jeu…"
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

      <div className="filter-chips" aria-label="Filtres de collection">
        {(
          [
            ["all", `Toutes (${CREATORS.length})`],
            ["owned", `Obtenues (${game.stats.uniqueCreators})`],
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
            onClick={() => {
              setFilter(value);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="binder-pager">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage <= 0}
        >
          <ChevronLeft size={15} />
          <span>Précédent</span>
        </button>
        <span>
          Page <strong>{safePage + 1}</strong> / {totalPages} · {filtered.length} cartes
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePage >= totalPages - 1}
        >
          <span>Suivant</span>
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="collection-grid">
        {visibleCreators.map((creator) => (
          <BinderCard key={creator.slug} creator={creator} item={owned.get(creator.slug)} />
        ))}
      </div>
      {!filtered.length ? (
        <div className="no-results">Aucune carte ne correspond à ce filtre.</div>
      ) : null}
    </div>
  );
}

/**
 * Carte du classeur : inclinable au doigt (scroll vertical préservé) et
 * retournable au tap. Les cartes non obtenues restent plates — il n'y a rien à
 * retourner, le dos masquerait le cadenas.
 */
function BinderCard({
  creator,
  item,
}: {
  creator: Creator;
  item: { count: number; bestVariant: CardVariant } | undefined;
}) {
  const [faceUp, setFaceUp] = useState(true);
  if (!item) return <CreatorCard creator={creator} locked compact />;
  return (
    <Card3D
      rarity={creator.rarity}
      variant={item.bestVariant}
      faceUp={faceUp}
      mode="scroll-safe"
      onFlip={() => setFaceUp((value) => !value)}
      flipLabel={faceUp ? `Voir le dos de ${creator.displayName}` : `Voir ${creator.displayName}`}
      className="binder-card"
      face={
        <CreatorCard
          creator={creator}
          variant={item.bestVariant}
          count={item.count}
          compact
        />
      }
    />
  );
}

function MissionRow({
  icon,
  label,
  detail,
  progress,
  target,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  progress: number;
  target: number;
}) {
  const done = progress >= target;
  const percent = Math.min(100, Math.round((progress / target) * 100));
  return (
    <article className={`mission-row ${done ? "done" : ""}`}>
      <div className="mission-icon">{done ? <Check size={19} /> : icon}</div>
      <div className="mission-content">
        <div>
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <div className="mission-progress-copy">
          <b>{Math.min(progress, target)}</b>/{target}
        </div>
        <div className="progress-track">
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>
    </article>
  );
}

function MissionsView({ game }: { game: GameState }) {
  return (
    <div className="view missions-view">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">OBJECTIFS TOP 500</p>
          <h1>Progression</h1>
        </div>
        <div className="streak-pill">
          <Zap size={14} />
          <span>Niveau {game.player.level}</span>
        </div>
      </section>

      <section className="mission-hero">
        <div className="mission-hero-icon">
          <Trophy size={27} />
        </div>
        <div>
          <span>Collection Top 500 Twitch FR</span>
          <strong>{game.stats.uniqueCreators} / {CREATORS.length}</strong>
          <div className="progress-track">
            <i
              style={{
                width: `${Math.round((game.stats.uniqueCreators / CREATORS.length) * 100)}%`,
              }}
            />
          </div>
        </div>
      </section>

      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">PARCOURS</p>
          <h2>Objectifs du collectionneur</h2>
        </div>
      </div>
      <div className="mission-list">
        <MissionRow
          icon={<Layers3 size={19} />}
          label="Premier drop"
          detail="Ouvrir un booster"
          progress={game.stats.openings}
          target={1}
        />
        <MissionRow
          icon={<BookOpen size={19} />}
          label="Début du classeur"
          detail="Découvrir 25 streameurs du Top 500"
          progress={game.stats.uniqueCreators}
          target={25}
        />
        <MissionRow
          icon={<Gem size={19} />}
          label="Chasseur de cartes"
          detail="Découvrir 100 streameurs du Top 500"
          progress={game.stats.uniqueCreators}
          target={100}
        />
        <MissionRow
          icon={<Sparkles size={19} />}
          label="Maître du Twitch Game"
          detail="Compléter les 500 streameurs francophones"
          progress={game.stats.uniqueCreators}
          target={500}
        />
      </div>
    </div>
  );
}

function ProfileView({
  game,
  testMode,
  onNotice,
  onError,
}: {
  game: GameState;
  testMode: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const soundOn = useSoundSettings();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [exportText, setExportText] = useState<string | null>(null);

  async function handleExport() {
    const json = gameStore.exportSave();
    try {
      await navigator.clipboard.writeText(json);
      setExportText(null);
      onNotice("Sauvegarde copiée dans le presse-papiers.");
    } catch {
      // Presse-papiers indisponible (permission, WebView ancienne) : on affiche
      // le texte pour une copie manuelle.
      setExportText(json);
    }
  }

  function handleImport() {
    try {
      gameStore.importSave(importText);
      setImportText("");
      setImportOpen(false);
      onNotice("Sauvegarde importée. Bon retour dans ton classeur !");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Import impossible.");
    }
  }

  function handleReset() {
    if (!window.confirm("Réinitialiser la progression ? Toutes tes cartes seront perdues.")) {
      return;
    }
    gameStore.reset();
    setExportText(null);
    setImportOpen(false);
    onNotice("Nouvelle partie lancée.");
  }

  return (
    <div className="view profile-view">
      <section className="profile-card">
        <div className="profile-avatar">
          <span>{game.player.level}</span>
        </div>
        <div>
          <p className="eyebrow">COLLECTIONNEUR</p>
          <h1>Mon profil</h1>
          <span>Édition Top 500 Twitch FR</span>
        </div>
      </section>

      <div className="stats-grid">
        <article>
          <Layers3 size={18} />
          <strong>{game.stats.totalCards}</strong>
          <span>cartes</span>
        </article>
        <article>
          <BookOpen size={18} />
          <strong>{game.stats.uniqueCreators}/{CREATORS.length}</strong>
          <span>streameurs</span>
        </article>
        <article>
          <Zap size={18} />
          <strong>{game.stats.openings}</strong>
          <span>boosters</span>
        </article>
      </div>

      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">OUTILS</p>
          <h2>Outils et réglages</h2>
        </div>
      </div>
      <section className="settings-list" aria-label="Outils et réglages">
        <button
          type="button"
          className={`settings-row settings-action ${testMode ? "is-on" : ""}`}
          role="switch"
          aria-checked={testMode}
          onClick={() => testModeStore.set(!testMode)}
        >
          <span className="settings-icon purple"><Zap size={17} /></span>
          <div>
            <strong>Mode test — ouvertures illimitées</strong>
            <span>
              Rejoue l&apos;ouverture en boucle : ni booster consommé, ni carte,
              ni XP ajoutés. Ta vraie progression n&apos;est pas touchée.
            </span>
          </div>
          <span className="switch" aria-hidden="true"><i /></span>
        </button>
        <button
          type="button"
          className={`settings-row settings-action ${soundOn ? "is-on" : ""}`}
          role="switch"
          aria-checked={soundOn}
          onClick={() => soundSettings.set(!soundOn)}
        >
          <span className="settings-icon blue"><Volume2 size={17} /></span>
          <div>
            <strong>Son et vibrations de l&apos;ouverture</strong>
            <span>
              Crissement du foil, souffle des cartes, clic du retournement —
              tout est synthétisé, aucun fichier son n&apos;est embarqué.
            </span>
          </div>
          <span className="switch" aria-hidden="true"><i /></span>
        </button>
      </section>

      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">SAUVEGARDE</p>
          <h2>Ta progression reste sur cet appareil</h2>
        </div>
      </div>
      <section className="settings-list" aria-label="Gestion de la sauvegarde">
        <div className="settings-row">
          <span className="settings-icon green"><WifiOff size={17} /></span>
          <div>
            <strong>Jeu 100 % hors ligne</strong>
            <span>Aucun compte, aucune connexion : tout est stocké localement.</span>
          </div>
          <Check size={18} className="success-icon" />
        </div>
        <button type="button" className="settings-row settings-action" onClick={() => void handleExport()}>
          <span className="settings-icon blue"><ClipboardCopy size={17} /></span>
          <div>
            <strong>Copier ma sauvegarde</strong>
            <span>Pour la transférer sur un autre téléphone ou la garder au chaud.</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="settings-row settings-action"
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
        >
          <span className="settings-icon purple"><ClipboardPaste size={17} /></span>
          <div>
            <strong>Importer une sauvegarde</strong>
            <span>Colle le texte copié depuis l’autre appareil.</span>
          </div>
          <ChevronRight size={16} style={{ transform: importOpen ? "rotate(90deg)" : undefined }} />
        </button>
        {importOpen ? (
          <div className="save-editor">
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{ "version": 1, "playerId": "…" }'
              aria-label="Sauvegarde à importer"
              rows={5}
              spellCheck={false}
            />
            <button
              type="button"
              className="secondary-action"
              onClick={handleImport}
              disabled={!importText.trim()}
            >
              <ClipboardPaste size={15} />
              <span>Remplacer ma progression par cette sauvegarde</span>
            </button>
          </div>
        ) : null}
        {exportText ? (
          <div className="save-editor">
            <p>Copie manuelle : sélectionne tout le texte ci-dessous.</p>
            <textarea value={exportText} readOnly rows={5} aria-label="Sauvegarde exportée" onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
        <button type="button" className="settings-row settings-action danger" onClick={handleReset}>
          <span className="settings-icon red"><RotateCcw size={17} /></span>
          <div>
            <strong>Réinitialiser la progression</strong>
            <span>Repart de zéro avec les boosters de départ.</span>
          </div>
          <ChevronRight size={16} />
        </button>
      </section>
    </div>
  );
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Accueil", icon: <Home size={21} /> },
  { id: "collection", label: "Classeur (500)", icon: <BookOpen size={21} /> },
  { id: "missions", label: "Objectifs", icon: <Target size={21} /> },
  { id: "profile", label: "Profil", icon: <CircleUserRound size={21} /> },
];

export function CreatorDeckApp() {
  const state = useGame();
  const now = useNow(1_000);
  const [tab, setTab] = useState<Tab>("home");
  // Un seul booster pour l'instant : le second concept reviendra plus tard.
  const selectedPack: PackType = "live";
  const testMode = useTestMode();
  // Booster en cours d'ouverture : `null` = pas de cinématique à l'écran.
  const [cinemaPack, setCinemaPack] = useState<PackType | null>(null);
  const [usingHourglass, setUsingHourglass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Vue dérivée : la recharge passive est recalculée à chaque tick d'horloge,
  // donc les boosters « arrivent » à l'écran sans action de l'utilisateur.
  const game = useMemo(() => (state ? getGameView(state, now) : null), [state, now]);

  const showError = useCallback((message: string) => {
    setNotice(null);
    setError(message);
  }, []);
  const showNotice = useCallback((message: string) => {
    setError(null);
    setNotice(message);
  }, []);

  /**
   * Ouvre la cinématique. Le tirage n'a PAS lieu ici : il est déclenché par la
   * cinématique au moment où la déchirure aboutit, pour que le suspense précède
   * réellement la consommation du booster.
   */
  function handleOpenPack() {
    if (!game || cinemaPack) return;
    const stock = selectedPack === "live" ? game.player.livePacks : game.player.archivePacks;
    if (!testMode && stock <= 0) {
      showError("Aucun booster disponible pour le moment.");
      return;
    }
    setError(null);
    setCinemaPack(selectedPack);
  }

  const drawCinemaPack = useCallback(() => {
    if (!cinemaPack) throw new Error("Aucun booster à ouvrir.");
    // Mode test : même tirage, mais rien n'est écrit dans la sauvegarde.
    return testMode ? gameStore.previewPack(cinemaPack) : gameStore.openPack(cinemaPack);
  }, [cinemaPack, testMode]);

  function handleUseHourglass() {
    if (!game || usingHourglass) return;
    setUsingHourglass(true);
    setError(null);
    try {
      gameStore.useHourglass(selectedPack);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Impossible d'utiliser un sablier.");
    } finally {
      setUsingHourglass(false);
    }
  }

  if (!game) return <LoadingScreen />;

  return (
    <main className="app-shell">
      <TopBar game={game} />
      <div className="app-content">
        {tab === "home" ? (
          <HomeView
            game={game}
            selectedPack={selectedPack}
            onOpen={handleOpenPack}
            onUseHourglass={handleUseHourglass}
            opening={cinemaPack !== null}
            usingHourglass={usingHourglass}
            testMode={testMode}
            now={now}
          />
        ) : null}
        {tab === "collection" ? <CollectionView game={game} /> : null}
        {tab === "missions" ? <MissionsView game={game} /> : null}
        {tab === "profile" ? (
          <ProfileView
            game={game}
            testMode={testMode}
            onNotice={showNotice}
            onError={showError}
          />
        ) : null}
      </div>

      <nav className="bottom-nav" aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {error ? (
        <div className="toast-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fermer"><X size={15} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast-error toast-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Fermer"><X size={15} /></button>
        </div>
      ) : null}
      {cinemaPack ? (
        <PackOpening
          packType={cinemaPack}
          onDraw={drawCinemaPack}
          onClose={() => setCinemaPack(null)}
          onError={showError}
          onSelectPackType={setCinemaPack}
        />
      ) : null}
    </main>
  );
}

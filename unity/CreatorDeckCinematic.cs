using System;
using System.Collections;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

/// <summary>
/// Passerelle Unity → React : appelle `window.CreatorDeckUnity.notify(json)`.
/// En éditeur ou hors WebGL, les messages sont simplement journalisés.
/// </summary>
public static class CreatorDeckBridge
{
    public static void Notify(string json)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        CreatorDeckBridgeNotify(json);
#else
        Debug.Log("[CreatorDeck] " + json);
#endif
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void CreatorDeckBridgeNotify(string message);
#endif
}

/// <summary>
/// Cinématique d'ouverture de booster — côté Unity du contrat documenté dans
/// `public/unity/README.md` (dépôt CreatorDeck/test).
///
/// Contrat respecté à la lettre :
///   React → Unity : SendMessage("CreatorDeckCinematic", "StartOpening", packType)
///                   SendMessage("CreatorDeckCinematic", "SetCards", payloadJson)
///   Unity → React : window.CreatorDeckUnity.notify(json)
///     évènements : ready · tear-progress · tear-complete ·
///                   card-revealed · summary-shown · close · error
///
/// Le tirage est effectué PAR REACT, au message `tear-complete` : ce script
/// n'a qu'à afficher les cartes reçues dans `SetCards`. Aucune logique de jeu
/// ici — tout reste dans le moteur web.
///
/// Paramètres Animator attendus (noms modifiables dans l'Inspector) :
///   • float  <see cref="tearParam"/>   0 → 1 : avancement de la déchirure
///   • trigger <see cref="burstTrigger"/>   : cartes qui jaillissent
///   • trigger <see cref="pileTrigger"/>    : la pile se pose
///   • trigger <see cref="flipTrigger"/>    : retournement de la carte du dessus
///   • trigger <see cref="summaryTrigger"/> : récapitulatif
/// </summary>
public class CreatorDeckCinematic : MonoBehaviour
{
    [Header("Scène")]
    [Tooltip("Animator du pack (ou du conteneur de la cinématique).")]
    public Animator packAnimator;
    [Tooltip("Rectangle du pack pour calculer la déchirure (défaut : ce transform).")]
    public RectTransform packRect;
    [Tooltip("Cases facultatives des portraits dans le récapitulatif (5 max).")]
    public RawImage[] cardSlots;

    [Header("Noms des paramètres Animator")]
    public string tearParam = "tear";
    public string burstTrigger = "burst";
    public string pileTrigger = "pile";
    public string flipTrigger = "flip";
    public string summaryTrigger = "summary";

    [Header("Seuils — identiques à l'implémentation web")]
    [SerializeField] private float tearThreshold = 0.55f;     // 55 % de la largeur/hauteur
    [SerializeField] private float tearVelocityPxMs = 1.35f;  // ou un geste rapide
    [SerializeField] private float tapMaxPx = 10f;            // un tap termine aussi la déchirure

    [Header("Durées de la chorégraphie (secondes)")]
    [SerializeField] private float burstSeconds = 0.96f;      // burst 620 ms + pose 340 ms
    [SerializeField] private float flipSeconds = 0.6f;        // lift 240 ms + flip 500 ms
    [SerializeField] private float staggerSeconds = 0.35f;    // délai entre deux cartes

    private enum Phase { Idle, Sealed, Tearing, AwaitingCards, Playing, Done }

    private Phase phase = Phase.Idle;
    private Vector2 dragStart;
    private Vector2 lastPos;
    private float lastTime;
    private float bestProgress;
    private bool tearNotified;

    private void Start()
    {
        Notify("{\"type\":\"ready\"}");
    }

    /// <summary>Appelé par React dès que le build est prêt.</summary>
    public void StartOpening(string packType)
    {
        phase = Phase.Sealed;
        tearNotified = false;
        bestProgress = 0f;
        SetTear(0f);
        Debug.Log("[CreatorDeck] Ouverture démarrée : " + packType);
    }

    /// <summary>
    /// Appelé par React à la fin de la déchirure, avec le tirage déjà effectué
    /// ({"v":1,"packType":"live","cards":[{"id","slug","rarity","variant","isNew"}]}).
    /// </summary>
    public void SetCards(string payloadJson)
    {
        if (phase == Phase.Playing || phase == Phase.Done) return;
        DrawPayload payload;
        try
        {
            payload = JsonUtility.FromJson<DrawPayload>(payloadJson);
        }
        catch (Exception caught)
        {
            Fail("Tirage illisible : " + caught.Message);
            return;
        }
        if (payload == null || payload.cards == null || payload.cards.Length == 0)
        {
            Fail("Tirage vide.");
            return;
        }
        phase = Phase.Playing;
        StartCoroutine(PlaySequence(payload.cards));
    }

    private void Update()
    {
        if (phase != Phase.Sealed && phase != Phase.Tearing) return;

        // Doigt (mobile) ou souris (aperçu navigateur) : mêmes gestes.
        Vector2 pos;
        bool down, held, up;
        if (Input.touchCount > 0)
        {
            var touch = Input.GetTouch(0);
            pos = touch.position;
            down = touch.phase == TouchPhase.Began;
            held = touch.phase == TouchPhase.Moved || touch.phase == TouchPhase.Stationary;
            up = touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled;
        }
        else
        {
            pos = Input.mousePosition;
            down = Input.GetMouseButtonDown(0);
            held = Input.GetMouseButton(0);
            up = Input.GetMouseButtonUp(0);
        }

        if (down)
        {
            phase = Phase.Tearing;
            dragStart = pos;
            lastPos = pos;
            lastTime = Time.unscaledTime;
            return;
        }
        if (held && phase == Phase.Tearing)
        {
            // Le geste est en pixels écran, on compare à l'écran : la
            // cinématique occupe tout le canvas, comme au web.
            // Écrans Unity : y croît vers le haut → on remonte, comme au web.
            float progressY = (pos.y - dragStart.y) / Mathf.Max(1f, Screen.height);
            float progressX = Mathf.Abs(pos.x - dragStart.x) / Mathf.Max(1f, Screen.width);
            bestProgress = Mathf.Max(bestProgress, Mathf.Max(progressX, progressY));
            SetTear(Mathf.Clamp01(bestProgress));

            float now = Time.unscaledTime;
            if (now > lastTime)
            {
                float px = Vector2.Distance(pos, lastPos);
                float velocity = px / ((now - lastTime) * 1000f); // px/ms
                NotifyProgress();
                if (velocity >= tearVelocityPxMs && bestProgress > 0.05f)
                {
                    CompleteTear();
                    return;
                }
                lastPos = pos;
                lastTime = now;
            }
            NotifyProgress();
            return;
        }
        if (up && phase == Phase.Tearing)
        {
            float traveled = Vector2.Distance(pos, dragStart);
            if (traveled <= tapMaxPx || bestProgress >= tearThreshold)
            {
                CompleteTear(); // tap comme clavier d'accessibilité au web
            }
            else
            {
                phase = Phase.Sealed;
                bestProgress = 0f;
                SetTear(0f);
                Notify("{\"type\":\"tear-progress\",\"progress\":0}");
            }
        }
    }

    private void CompleteTear()
    {
        if (tearNotified) return;
        tearNotified = true;
        phase = Phase.AwaitingCards;
        SetTear(1f);
        // React tire les cartes maintenant, puis renvoie SetCards.
        Notify("{\"type\":\"tear-complete\"}");
    }

    private float lastNotifiedProgress = -1f;
    private void NotifyProgress()
    {
        // Throttle : un message par centième suffit au pied de page web.
        float rounded = Mathf.Round(bestProgress * 100f) / 100f;
        if (Mathf.Approximately(rounded, lastNotifiedProgress)) return;
        lastNotifiedProgress = rounded;
        Notify("{\"type\":\"tear-progress\",\"progress\":" + rounded.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "}");
    }

    private IEnumerator PlaySequence(Card[] cards)
    {
        if (packAnimator != null)
        {
            packAnimator.SetTrigger(burstTrigger);
        }
        yield return new WaitForSecondsRealtime(burstSeconds);

        if (packAnimator != null) packAnimator.SetTrigger(pileTrigger);
        yield return new WaitForSecondsRealtime(staggerSeconds);

        for (int i = 0; i < cards.Length; i++)
        {
            if (packAnimator != null) packAnimator.SetTrigger(flipTrigger);
            if (cardSlots != null && i < cardSlots.Length && cardSlots[i] != null)
            {
                yield return StartCoroutine(LoadPortrait(cardSlots[i], cards[i].slug));
            }
            Notify("{\"type\":\"card-revealed\",\"index\":" + i + "}");
            yield return new WaitForSecondsRealtime(flipSeconds);
        }

        if (packAnimator != null) packAnimator.SetTrigger(summaryTrigger);
        Notify("{\"type\":\"summary-shown\"}");
        phase = Phase.Done;

        // Un tap sur la scène ferme la cinématique (le bouton X de React
        // fonctionne aussi, il est toujours affiché au-dessus du canvas).
        while (!TapDetected()) yield return null;
        Notify("{\"type\":\"close\"}");
    }

    private bool TapDetected()
    {
        if (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began) return true;
        return Input.GetMouseButtonDown(0);
    }

    /// <summary>
    /// Portrait optionnel : /creators/{slug}.jpg servi par le même origine que
    /// la page. Échec silencieux (carte sans portrait = placeholder uni).
    /// </summary>
    private IEnumerator LoadPortrait(RawImage target, string slug)
    {
        string origin;
        try
        {
            var uri = new Uri(Application.absoluteURL);
            origin = uri.GetLeftPart(UriPartial.Authority);
        }
        catch
        {
            yield break;
        }
        using (var request = UnityWebRequestTexture.GetTexture(origin + "/creators/" + slug + ".jpg"))
        {
            yield return request.SendWebRequest();
            if (request.result == UnityWebRequest.Result.Success)
            {
                target.texture = DownloadHandlerTexture.GetContent(request);
            }
            else
            {
                Debug.LogWarning("[CreatorDeck] Portrait introuvable : " + slug);
            }
        }
    }

    private bool tearParamVerified;

    private void SetTear(float value)
    {
        if (packAnimator == null) return;
        if (!tearParamVerified)
        {
            // Vérification UNE fois : évite la API HasParameter (Unity 2022.2+).
            tearParamVerified = true;
            bool found = false;
            foreach (var parameter in packAnimator.parameters)
            {
                if (parameter.type == AnimatorControllerParameterType.Float && parameter.name == tearParam)
                {
                    found = true;
                    break;
                }
            }
            if (!found)
            {
                Debug.LogWarning("[CreatorDeck] Paramètre Animator manquant : " + tearParam);
                packAnimator = null;
                return;
            }
        }
        packAnimator.SetFloat(tearParam, value);
    }

    private void Fail(string message)
    {
        Notify("{\"type\":\"error\",\"message\":\"" + message.Replace("\"", "'") + "\"}");
    }

    private void Notify(string json) => CreatorDeckBridge.Notify(json);

    // ── Payload reçu de React (JsonUtility) ──────────────────────────────
    [Serializable]
    private class DrawPayload
    {
        public int v;
        public string packType;
        public Card[] cards;
    }

    [Serializable]
    private class Card
    {
        public string id;
        public string slug;
        public string rarity;
        public string variant;
        public bool isNew;
    }
}

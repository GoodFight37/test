// Passerelle WebGL : C# appelle CreatorDeckBridgeNotify("…") →
// window.CreatorDeckUnity.notify("…") côté React.
// Ce fichier se place dans Assets/Plugins/ du projet Unity.
var CreatorDeckBridge = {
  CreatorDeckBridgeNotify: function (messagePtr) {
    var message = UTF8ToString(messagePtr);
    if (
      typeof window !== "undefined" &&
      window.CreatorDeckUnity &&
      typeof window.CreatorDeckUnity.notify === "function"
    ) {
      window.CreatorDeckUnity.notify(message);
    }
    // Sinon : React n'est pas encore prêt ou la cinématique est fermée —
    // le message est silencieusement ignoré (jamais fatal, contrat public).
  },
};

mergeInto(LibraryManager.library, CreatorDeckBridge);

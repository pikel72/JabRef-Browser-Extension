// Service workers lack `window`. Polyfill it so translator code
// (e.g. BibTeX export) doesn't throw ReferenceError.
if (typeof window === "undefined") {
  globalThis.window = globalThis;
}

globalThis.Zotero = {
  isConnector: true,
  isBrowserExt: true,
  locale: "en-US",
  logError: console.error.bind(console),
  debug: console.debug.bind(console),
  Prefs: {
    get(key) {
      switch (key) {
        case "automaticSnapshots":
          return false;
        case "downloadAssociatedFiles":
          return false;
        case "reportTranslationFailure":
          return true;
        default:
          throw new Error(`Unknown preference ${key}`);
      }
    },
  },
  Utilities: {},
  isManifestV3: true,
  Connector_Browser: {
    setKeepServiceWorkerAlive(_val) {
      // No-op in this context
    },
  },
  Messaging: {
    sendMessage() {
      // No-op in this context
    },
  },
};

globalThis.OS = {
  Path: {
    basename: (path) => path.split(/[\\/]/).pop(),
  },
};

console.debug("[offscreen] started");

// Provide a minimal compatibility shim: if `browser` is missing, alias it to `chrome`.
if (typeof browser === "undefined" && typeof chrome !== "undefined") {
  globalThis.browser = chrome;
}

// Proxy all HTTP requests through the background script.
// The offscreen document lacks declarativeNetRequest and other extension-only APIs
// that the Zotero HTTP module expects; routing through the service worker avoids this.
Zotero.isInject = true;
let currentTranslationTabId = null;
let currentTranslationURL = null;
Zotero.COHTTP = {
  request: async (method, url, options = {}) => {
    const response = await browser.runtime.sendMessage({
      type: "COHTTP.request",
      method,
      url,
      options,
      tabId: currentTranslationTabId,
      documentURL: currentTranslationURL,
    });
    response.getAllResponseHeaders = () => response.responseHeaders;
    response.getResponseHeader = function (name) {
      let match = response.responseHeaders.match(new RegExp(`^${name}: (.*)$`, "mi"));
      return match ? match[1] : null;
    };
    let isArrayBuffer = Array.isArray(response.response) && response.responseType === "arraybuffer";
    if (isArrayBuffer) {
      response.response = new Uint8Array(response.response).buffer;
    } else {
      response.responseText = response.response;
    }
    return response;
  },
};

// Override saveItems to simply collect items (same as content script does).
// Must run after all modules are loaded, as translate_item.js defines a
// throwing stub that would otherwise be called.
Zotero.Translate.ItemSaver.prototype.saveItems = async function (jsonItems, _attachmentCallback, _itemsDoneCallback) {
  this.items = (this.items || []).concat(jsonItems);
  return jsonItems;
};

function withDocumentLocation(doc, url) {
  const locationUrl = new URL(url);
  try { doc.location = locationUrl; } catch (_) {}
  try { doc.URL = url; } catch (_) {}
  try { Object.defineProperty(doc, "documentURI", { get: () => url, configurable: true }); } catch (_) {}
  try { Object.defineProperty(doc, "baseURI", { get: () => url, configurable: true }); } catch (_) {}
  if (doc.location) return doc;
  try { Object.defineProperty(doc, "location", { get: () => locationUrl, configurable: true }); } catch (_) {}
  try { Object.defineProperty(doc, "URL", { get: () => url, configurable: true }); } catch (_) {}
  try {
    let base = doc.querySelector("base[href]");
    if (!base) {
      base = doc.createElement("base");
      doc.head?.prepend(base);
    }
    base.href = url;
  } catch (_) {}
  return doc;
}

function createTranslator(info) {
  if (!info?.path) {
    throw new Error(`Translator ${info?.label ?? "unknown"} is missing a path`);
  }
  const path = info.path;
  const translator = new Zotero.Translator(info);
  translator.file = { path };
  return translator;
}

function resolveAttachmentURL(url, baseURL) {
  try {
    return new URL(url, baseURL).href;
  } catch {
    return url;
  }
}

async function prepareForExport(items, baseURL) {
  const { takeSnapshots } = await browser.storage.sync.get({ takeSnapshots: false });

  for (const item of items) {
    if (!Array.isArray(item.attachments)) continue;
    for (const attachment of item.attachments) {
      const attachmentURL = attachment.url
        ? resolveAttachmentURL(attachment.url, item.url || baseURL)
        : null;
      const isLink =
        attachment.mimeType === "text/html" || attachment.mimeType === "application/xhtml+xml";
      if (isLink && attachment.snapshot !== false) {
        if (takeSnapshots && attachmentURL) {
          attachment.localPath = attachmentURL;
        }
      } else if (attachmentURL) {
        attachment.localPath = attachmentURL;
      }
    }

    if (item.accessDate) {
      item.accessDate = new Date().toISOString();
    }
  }
}

browser.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (!msg || msg.type !== "runTranslators") return;
  const { url, pageURL, translatorsInfo } = msg;
  const translationURL = pageURL || url;
  currentTranslationTabId = msg.tabId || null;
  currentTranslationURL = translationURL;

  const fail = async (step, err) => {
    await browser.runtime.sendMessage({ type: "offscreenResult", url, error: `[${step}] ${String(err)}\n${err?.stack || ""}` });
  };

  try {
    let html;
    if (typeof msg.html === "string" && msg.html.length) {
      html = msg.html;
    } else {
      let resp;
      try { resp = await fetch(url, { credentials: "include" }); } catch (e) { return fail("fetch", e); }
      try { html = await resp.text(); } catch (e) { return fail("text", e); }
    }
    if (!Array.isArray(translatorsInfo) || translatorsInfo.length === 0) {
      return fail("validate", new Error("No translators"));
    }

    let parsedDocument;
    try {
      const parser = new DOMParser();
      const rawDoc = parser.parseFromString(html, "text/html");
      parsedDocument = withDocumentLocation(rawDoc, translationURL);
    } catch (e) { return fail("parse", e); }

    let translateEngine;
    try { translateEngine = await createTranslateEngine(translationURL); } catch (e) { return fail("createEngine", e); }

    const translators = translatorsInfo.map(createTranslator);

    let result;
    try { result = await translateEngine.translate(parsedDocument, translators, translationURL); } catch (e) { return fail("translate", e); }

    if (!result?.items?.length) {
      await browser.runtime.sendMessage({ type: "offscreenResult", url, items: null });
      sendResponse({ ok: true, result: null });
      return true;
    }

    // Export to BibTeX here to avoid service worker import() restrictions.
    const mode = msg.exportMode || "bibtex";

    let bibtexString;
    try {
      await prepareForExport(result.items, translationURL);
      bibtexString = await exportItems(result.items, mode);
    } catch (e) { return fail("export", e); }

    await browser.runtime.sendMessage({ type: "offscreenResult", url, items: result.items, bibtexString, mode });
    sendResponse({ ok: true });
  } catch (e) {
    await browser.runtime.sendMessage({ type: "offscreenResult", url, error: `[outer] ${String(e)}` });
    sendResponse({ ok: false, error: String(e) });
  }
  return true;
});

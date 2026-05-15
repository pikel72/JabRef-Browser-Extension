import { defineBackground } from "wxt/utils/define-background";

const browserAction = browser.pageAction || browser.action;
browserAction.show = browserAction.show || browserAction.enable;

export default defineBackground({
  type: "module",
  main() {
    var tabInfo = new Map();

    function hasTabId(tab) {
      return Number.isInteger(tab?.id);
    }

    /*
    Show/hide import button for all tabs (when add-on is loaded).
    */
    browser.tabs.query({}).then((tabs) => {
      console.log("JabRef: Inject into open tabs %o", tabs);
      for (let tab of tabs) {
        if (!hasTabId(tab)) continue;
        installInTab(tab);
      }
    });

    /*
    Show/hide import button for the currently active tab, whenever the user navigates.
*/
    browser.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
      if (!changeInfo.url) {
        return;
      }
      browser.tabs
        .query({
          active: true,
          currentWindow: true,
        })
        .then((tabs) => {
          const tab = tabs.find((tab) => tab.id === tabId);
          if (!hasTabId(tab)) {
            return;
          }
          installInTab(tab);
        });
    });

    /*
    Remove translator information when tab is closed.
*/
    browser.tabs.onRemoved.addListener((tabId, _removeInfo) => {
      tabInfo.delete(tabId);
    });

    /*
    Disable add-on for special browser pages
*/
    function isDisabledForURL(url) {
      return (
        !url ||
        url.includes("chrome://") ||
        url.includes("edge://") ||
        url.includes("about:") ||
        (url.includes("-extension://") && !url.includes("/test/"))
      );
    }

    function isProbablyPdfTab(tab) {
      if (!tab?.url) return false;
      try {
        const url = new URL(tab.url);
        return (
          url.pathname.toLowerCase().endsWith(".pdf") ||
          /^\/pdf(\/|$)/.test(url.pathname.toLowerCase())
        );
      } catch (_e) {
        return false;
      }
    }

    /*
    Searches for translators for the given tab and shows/hides the import button accordingly.

    Zotero.Connector_Browser.onPageLoad is the original function from the Zotero Connector,
    see https://github.com/zotero/zotero-connectors/blob/dac609fb9dea1e98dbcc73387b05f7af5ef7814d/src/browserExt/background.js#L968.
*/
    function installInTab(tab) {
      if (!hasTabId(tab)) {
        return;
      }
      if (isDisabledForURL(tab.url)) {
        return;
      }

      // Reset tab info
      tabInfo.set(tab.id, { url: tab.url });

      if (isProbablyPdfTab(tab)) {
        browserAction.show(tab.id);
        browserAction.setTitle({
          tabId: tab.id,
          title: "Import references into JabRef as PDF",
        });
        tabInfo.set(tab.id, { ...tabInfo.get(tab.id), isPDF: true });
        return;
      }

      tabInfo.set(tab.id, { ...tabInfo.get(tab.id), isPDF: false });
      lookForTranslators(tab);
    }

    /*
    Looks for potential translators for the given tab.
*/
    async function lookForTranslators(tab) {
      if (!hasTabId(tab)) {
        return [];
      }
      // Skip restricted URLs where content scripts can't run (edge://, chrome://, about:, etc.)
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
        return [];
      }
      console.log("JabRef: Searching for translators for tab %s: %s", tab.id, tab.url);

      try {
        await initContentScript(tab.id);
        console.log(
          "JabRef: Content script injected in tab %s, sending detectTranslators for %s",
          tab.id,
          tab.url,
        );
        const response = await browser.tabs.sendMessage(tab.id, {
          type: "detectTranslators",
          url: tab.url,
        });
        const translatorsInfo = response?.translatorsInfo || [];
        console.log(
          "JabRef: detectTranslators response for tab %s: %d translator(s) %o (content build: %s)",
          tab.id,
          translatorsInfo.length,
          translatorsInfo.map((translator) => translator.label),
          response?.buildMarker || "unknown",
        );
        if (response?.diagnostics) {
          console.log("JabRef: detectTranslators diagnostics for tab %s: %o", tab.id, response.diagnostics);
        }
        onTranslators(translatorsInfo, tab.id);
        return translatorsInfo;
      } catch (e) {
        console.debug("JabRef: Skipping tab %s (no host permission or injection failed): %s", tab.id, e.message);
        onTranslators([], tab.id);
        return [];
      }
    }

    async function evalInTab(tabsId, code) {
      try {
        const result = await browser.tabs.executeScript(tabsId, {
          code: code,
        });
        console.log(`JabRef: code executed with result ${result}`);
        return result;
      } catch (error) {
        console.log(`JabRef: Error executing script: ${error}`);
      }
    }

    function openErrorPage(message, details = "", stacktrace = "") {
      browser.tabs.create({
        url:
          "/error.html?message=" +
          encodeURIComponent(message) +
          "&details=" +
          encodeURIComponent(details ?? "") +
          "&stacktrace=" +
          encodeURIComponent(stacktrace ?? ""),
      });
    }

    async function getBaseUrl() {
      const settings = await browser.storage.sync.get({ httpPort: 23119 });
      return `http://localhost:${settings.httpPort}/`;
    }

    async function sendBibEntryHttp(bibtex) {
      const baseUrl = await getBaseUrl();

      const health = await fetch(baseUrl, { method: "GET", cache: "no-store" });
      if (!(health.ok || health.status === 404)) {
        throw new Error(`JabRef HTTP endpoint unavailable (${health.status})`);
      }

      const resp = await fetch(baseUrl + "libraries/current/entries", {
        method: "POST",
        headers: { "Content-Type": "application/x-bibtex" },
        body: bibtex,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${body ? `: ${body}` : ""}`);
      }
    }

    async function sendBibEntryNative(bibtex) {
      const response = await browser.runtime.sendNativeMessage("org.jabref.jabref", {
        text: bibtex,
      });
      if (response?.message === "ok") {
        return;
      }

      if (response?.message === "error") {
        console.error(
          `JabRef: Error connecting to JabRef: '${response.output}' at '${response.stacktrace}'`,
        );
        openErrorPage(response.output, "", response.stacktrace);
      }

      console.error(
        `JabRef: Error connecting to JabRef: '${response.message}' with details '${response.output}' at '${response.stacktrace}'`,
      );
      openErrorPage(response.message, response.output, response.stacktrace);
    }

    async function sendBibTexToJabRef(bibtex) {
      await browser.runtime.sendMessage({ onSendToJabRef: "sendToJabRefStarted" });
      console.log("JabRef: Send BibTeX to JabRef: %o", bibtex);

      try {
        await sendBibEntryHttp(bibtex);
        await browser.runtime.sendMessage({ popupClose: "close" });
        return;
      } catch (httpError) {
        console.warn("JabRef: HTTP send failed, falling back to native messaging", httpError);
      }

      await sendBibEntryNative(bibtex);
      await browser.runtime.sendMessage({ popupClose: "close" });
    }

    function saveAsWebpage(tab) {
      var title = tab.title || "";
      var url = tab.url || "";
      var date = new Date().toISOString();

      // Construct a manual Bibtex Entry for the webpage
      var bibtexString = `@misc{,\
		title={${title}},\
		url = {${url}},\
		urlDate={${date}},\
		}`;
      sendBibTexToJabRef(bibtexString);
    }

    function savePdf(tab) {
      var title = (tab.title || "").replace(".pdf", "");
      var url = tab.url || "";
      var urlEscaped = url.replace(":", "\\:");
      var date = new Date().toISOString();

      // Construct a manual Bibtex Entry for the PDF
      var bibtexString = `@misc{,\
		title={${title}},\
		file={:${urlEscaped}:PDF},\
		url = {${url}},\
		urlDate={${date}},\
		}`;
      sendBibTexToJabRef(bibtexString);
    }

    /*
    Is called after lookForTranslators found matching translators.
    We need to hide or show the page action accordingly.
*/
    function onTranslators(translatorsInfo, tabId) {
      if (!Number.isInteger(tabId)) {
        return;
      }
      if (!translatorsInfo || translatorsInfo.length === 0) {
        const url = tabInfo.get(tabId)?.url;
        console.log(`JabRef: Found no suitable translators for tab ${tabId}${url ? ` (${url})` : ""}`);
        tabInfo.set(tabId, { ...tabInfo.get(tabId), translatorsInfo });
        browserAction.show(tabId);
        browserAction.setTitle({
          tabId: tabId,
          title: "Import simple website reference into JabRef",
        });
      } else {
        console.log(
          `JabRef: Found translators for tab ${tabId}: %o`,
          translatorsInfo.map((translator) => translator.label),
        );
        tabInfo.set(tabId, { ...tabInfo.get(tabId), translatorsInfo });
        browserAction.show(tabId);
        browserAction.setTitle({
          tabId: tabId,
          title: "Import references into JabRef using " + translatorsInfo[0].label,
        });
      }
    }

    async function initOffscreenDocument() {
      if (!browser.offscreen) return false;
      const has = await browser.offscreen.hasDocument();
      if (has) return true;
      try {
        await browser.offscreen.createDocument({
          url: browser.runtime.getURL("offscreen.html"),
          reasons: ["DOM_PARSER"],
          justification: "Scraping the document for bibliographic data",
        });
        return true;
      } catch (e) {
        console.warn("Failed to create offscreen document", e);
        return false;
      }
    }

    async function initContentScript(tabId) {
      if (!Number.isInteger(tabId)) {
        throw new Error(`Invalid tab id: ${tabId}`);
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await browser.tabs.sendMessage(tabId, { type: "jabrefContentPing" });
          if (response?.ok) return;
        } catch (_e) {
          // The manifest content script may still be registering its message listener.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await browser.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"],
      });

      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const response = await browser.tabs.sendMessage(tabId, { type: "jabrefContentPing" });
          if (response?.ok) return;
        } catch (_e) {
          // Runtime injection may take a moment before message listeners are ready.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error("Content script did not become ready after injection");
    }

    async function initTranslateEngine(tab) {
      if (!hasTabId(tab)) {
        throw new Error("Invalid tab for initTranslateEngine");
      }
      // Always inject the content script into the tab.
      // The translators need access to the page DOM, which only the content script has.
      await initContentScript(tab.id);
    }

    async function onPopupOpened(tab, info) {
      if (!hasTabId(tab)) {
        throw new Error("Invalid tab for popupOpened");
      }
      if (!info.translatorsInfo.length) throw new Error("No translator paths provided");

      // Route through offscreen document - it has its own CSP allowing unsafe-eval,
      // which the original Zotero SandboxManager requires.
      const offscreenReady = await initOffscreenDocument();
      if (!offscreenReady) {
        throw new Error("Failed to initialize offscreen document for translator execution");
      }
      console.log("JabRef: Routing translator execution through offscreen document for tab %o", tab);
      const exportMode = await getConversionMode();
      await browser.runtime.sendMessage({
        type: "runTranslators",
        url: tab.url,
        translatorsInfo: info.translatorsInfo,
        exportMode,
      });
    }

    async function getConversionMode() {
      const cfg = await browser.storage.sync.get({ exportMode: "bibtex" });
      return cfg.exportMode || "bibtex";
    }

    async function prepareForExport(items) {
      const { takeSnapshots } = await browser.storage.sync.get({ takeSnapshots: false });

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        for (var j = 0; j < item.attachments.length; j++) {
          var attachment = item.attachments[j];

          var isLink =
            attachment.mimeType === "text/html" || attachment.mimeType === "application/xhtml+xml";
          if (isLink && attachment.snapshot !== false) {
            // Snapshot
            if (takeSnapshots && attachment.url) {
              attachment.localPath = attachment.url;
            } else {
              // Ignore
            }
          } else {
            // Normal file
            // Pretend we downloaded the file since otherwise it is not exported
            if (attachment.url) {
              attachment.localPath = attachment.url;
            }
          }
        }

        // Fix date string
        if (item.accessDate) {
          item.accessDate = new Date().toISOString();
        }
      }
    }

    browser.runtime.onMessage.addListener(async function (message, sender, _sendResponse) {
      try {
        if (!message) {
          return;
        }

        if (message.type === "popupOpened") {
          // The popup opened, i.e. the user clicked on the page action button
          console.log("JabRef: Popup opened confirmed");
          const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          const tab = tabs.find((tab) => hasTabId(tab));
          if (!tab) {
            throw new Error("No active tab found for popupOpened");
          }
          var info = tabInfo.get(tab.id);

          if (info?.isPDF && isProbablyPdfTab(tab)) {
            console.log("JabRef: Export PDF in tab %o", JSON.parse(JSON.stringify(tab)));
            savePdf(tab);
          } else {
            if (!info?.translatorsInfo?.length) {
              const translatorsInfo = await lookForTranslators(tab);
              info = {
                ...tabInfo.get(tab.id),
                translatorsInfo,
              };
            }
          }

          if (info?.translatorsInfo?.length) {
            console.log("JabRef: Start translation for tab %o", JSON.parse(JSON.stringify(tab)));
            await onPopupOpened(tab, info);
          } else if (!info?.isPDF) {
            console.warn(
              "JabRef: No translators for tab, not sending fallback BibTeX %o",
              JSON.parse(JSON.stringify(tab)),
            );
            openErrorPage(
              "No suitable translator found",
              `No Zotero translator was found for ${tab.url}. Nothing was sent to JabRef.`,
            );
          }

          return { ok: true };
        } else if (message.type === "COHTTP.request") {
          const { method, url, options } = message;
          console.debug(`JabRef: COHTTP request in background.js: ${method} ${url} %o`, options);
          const xhr = await Zotero.HTTP.request(method, url, options);
          // From upstream: https://github.com/zotero/zotero-connectors/blob/ea060a0aa2fea1267049b5fc880e53aa6c915eeb/src/common/messages.js#L302-L316
          let result = {
            response: xhr.response,
            responseType: xhr.responseType,
            status: xhr.status,
            statusText: xhr.statusText,
            responseHeaders: xhr.getAllResponseHeaders(),
            responseURL: xhr.responseURL,
          };
          return result;
        } else if (message.type === "offscreenResult") {
          console.debug("JabRef: offscreenResult in background.js: %o", message);
          if (message.error) {
            console.error("JabRef: Error in offscreen translator execution", message.error);
            return;
          }
          const { url, items, bibtexString } = message;

          // BibTeX export already done in offscreen (avoids service worker import() restriction)
          if (bibtexString) {
            console.debug("JabRef: Received pre-exported BibTeX from offscreen (%d chars)", bibtexString.length);
            await sendBibTexToJabRef(bibtexString);
            return;
          }

          // Fallback: export in background (older offscreen code)
          const conversionMode = await getConversionMode();
          await prepareForExport(items);
          await browser.runtime.sendMessage({ onConvertToBibtex: "convertStarted" });
          const bib = await exportItems(items, conversionMode);
          console.debug("JabRef: Exported BibTeX: %o", bib);
          await sendBibTexToJabRef(bib);
        } else if (message.eval && sender.tab?.id) {
          console.debug(
            "JabRef: eval in background.js: %o",
            JSON.parse(JSON.stringify(message.eval)),
          );
          return evalInTab(sender.tab.id, message.eval);
        } else if (Array.isArray(message) && message[0] === "Debug.log") {
          console.log(message[1]);
        } else if (Array.isArray(message) && message[0] === "Errors.log") {
          console.log(message[1]);
        } else {
          console.log(
            "JabRef: other message in background.js: %o",
            JSON.parse(JSON.stringify(message)),
          );
        }
      } catch (e) {
        console.error("JabRef: Error handling message in background.js", e);
        throw e;
      }
    });
  },
});

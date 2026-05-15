export default defineContentScript({
  matches: ["<all_urls>"],

  async main() {
    const BUILD_MARKER = "edge-translator-diagnostics-2026-05-15-01";
    console.log("[contentScript] started (%s)", BUILD_MARKER);

    browser.runtime.onMessage.addListener(async (msg, _sender, _sendResponse) => {
      console.log("[contentScript] received message: %o", msg);
      try {
        if (msg?.type === "jabrefContentPing") {
          return { ok: true };
        }

        if (msg?.type === "getPageSnapshot") {
          return {
            ok: true,
            url: document.location.href,
            title: document.title,
            html: document.documentElement?.outerHTML || "",
          };
        }

        Zotero.isInject = true;
        Zotero.COHTTP = {
          request: async (method, url, options = {}) => {
            const response = await browser.runtime.sendMessage({
              type: "COHTTP.request",
              method,
              url,
              options,
            });
            response.getAllResponseHeaders = () => response.responseHeaders;
            response.getResponseHeader = function (name) {
              let match = response.responseHeaders.match(new RegExp(`^${name}: (.*)$`, "mi"));
              return match ? match[1] : null;
            };
            let isArrayBuffer =
              Array.isArray(response.response) && response.responseType === "arraybuffer";
            if (isArrayBuffer) {
              response.response = await unpackArrayBuffer(response.response);
            } else {
              response.responseText = response.response;
            }
            return response;
          },
        };
        Zotero.Translate.ItemSaver.prototype.saveItems = async function (
          jsonItems,
          _attachmentCallback,
          _itemsDoneCallback,
        ) {
          return jsonItems;
        };

        if (!msg) return;
        const { url } = msg;

        console.log("[contentScript] Creating translate engine for URL: %s", url);
        const translateEngine = await createTranslateEngine(url);
        console.log("[contentScript] Translate engine created successfully");

        if (msg.type === "detectTranslators") {
          console.log("[contentScript] Running translator detection...");
          let translatorsInfo = await translateEngine.detect();
          const potentialTranslators = translatorsInfo.length
            ? []
            : await translateEngine.getPotentialTranslators();
          if (!translatorsInfo.length && potentialTranslators.length === 1) {
            console.warn(
              "[contentScript] Detection returned no translators, but URL matched one candidate. Falling back to %s.",
              potentialTranslators[0].label,
            );
            translatorsInfo = potentialTranslators;
          }
          console.log(
            "[contentScript] Detection result for %s: %d translator(s) %o",
            url,
            translatorsInfo.length,
            translatorsInfo.map((translator) => translator.label),
          );
          return {
            buildMarker: BUILD_MARKER,
            translatorsInfo,
            diagnostics: {
              url,
              pageURL: document.location.href,
              potentialTranslators: potentialTranslators.map((translator) => translator.label),
              forcedSingleCandidateFallback:
                !!potentialTranslators.length && potentialTranslators.length === 1,
            },
          };
        }

        if (msg.type !== "runTranslators") return;

        // Only handle tab-targeted messages (from tabs.sendMessage).
        // Runtime-broadcasted messages are handled by the offscreen document.
        if (!_sender.tab) return;

        const translators = msg.translatorsInfo.map((info) => {
          const path = info.path;
          if (!path) {
            throw new Error(`Translator ${info.label} is missing a path`);
          }
          const translator = new Zotero.Translator(info);
          translator.file = {
            path: path,
          };
          return translator;
        });
        console.log(
          "Content script received runTranslators message for url %o with translators %o",
          url,
          translators,
        );
        const result = await translateEngine.translate(document, translators);
        console.log("Content script obtained translation result %o", result);
        await browser.runtime.sendMessage({ type: "offscreenResult", url, items: result.items });
      } catch (e) {
        console.error("[contentScript] Error handling message: %o", e);
        throw e;
      }
    });
  },
});

import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Place source files in the `src` directory
  // https://wxt.dev/guide/essentials/project-structure.html#adding-a-src-directory
  srcDir: "src",
  targetBrowsers: ["chrome", "firefox", "opera", "edge"],
  manifestVersion: 3,
  manifest: {
    browser_specific_settings: {
      gecko: {
        id: "@jabfox",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Alt+Shift+J",
        },
      },
    },
    description:
      "The JabRef browser extension imports new bibliographic information directly from the browser into JabRef.",
    homepage_url: "http://www.jabref.org/",
    host_permissions: ["<all_urls>"],
    icons: {
      "16": "/JabRef-icon-16.png",
      "48": "/JabRef-icon-48.png",
      "96": "/JabRef-icon-96.png",
      "128": "/JabRef-icon-128.png",
    },
    name: "JabRef Browser Extension",
    permissions: [
      "scripting",
      "activeTab",
      "tabs",
      "storage",
      "nativeMessaging",
      "offscreen",
      "webRequest",
      "declarativeNetRequest",
    ],
    web_accessible_resources: [
      {
        matches: ["<all_urls>"],
        resources: ["sandbox.js", "translators/*.js", "translators/manifest.json"],
      },
    ],
  },
  webExt: {
    openDevtools: true,
    startUrls: [
      "https://ieeexplore.ieee.org/abstract/document/893874",
      "https://arxiv.org/a/diez_t_1.html",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      rollupOptions: {
        external: ["jsdom"],
      },
    },
  }),
});

// This file is used to share the Zotero sandbox environment with the extension's content scripts and translators.
// To enable this, the sandbox module must be shared with both context, and thus cannot be bundled/inlined.
// For this reason, this file is in `public` and will just be copied verbatim.

export let ZU;
export let Zotero;
export let Z;
export let requestJSON;
export let requestText;
export let requestDocument;
export let request;
export let text;
export let innerText;
export let attr;
export let xpath;
export let xpathText;
export let DOMParser;

export function documentHref(doc) {
  return doc?.location?.href
    || doc?.documentURI
    || doc?.URL
    || doc?.baseURI
    || "";
}

export function setSandbox(sandbox) {
  const utilities = sandbox.ZU || sandbox.Zotero?.Utilities || {};
  ZU = sandbox.ZU;
  Zotero = sandbox.Zotero;
  Z = sandbox.Zotero;
  requestJSON = sandbox.requestJSON || utilities.requestJSON?.bind?.(utilities);
  requestText = sandbox.requestText || utilities.requestText?.bind?.(utilities);
  requestDocument = sandbox.requestDocument || utilities.requestDocument?.bind?.(utilities);
  request = sandbox.request || utilities.request?.bind?.(utilities);
  text = sandbox.text;
  innerText = sandbox.innerText || utilities.innerText?.bind?.(utilities);
  attr = sandbox.attr;
  xpath = sandbox.xpath || utilities.xpath?.bind?.(utilities);
  xpathText = sandbox.xpathText || utilities.xpathText?.bind?.(utilities);
  DOMParser = sandbox.DOMParser || globalThis.DOMParser;
}

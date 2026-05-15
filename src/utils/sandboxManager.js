/**
 * Manages the translator sandbox
 */
class SandboxManager {
  constructor() {
    this.sandbox = {
      Zotero: {},
      Promise,
    };
  }

  /**
   * Evaluates code in the sandbox
   * @param {string} code Code to evaluate
   * @param {string[]} functions Functions to import into the sandbox (rather than leaving as inner functions)
   * @param {string?} path The source path of the code being evaluated
   */
  async eval(code, functions = [], path) {
    for (const fn of functions) {
      delete this.sandbox[fn];
    }

    if (path && typeof browser !== "undefined") {
      const { setSandbox } = await import(browser.runtime.getURL("sandbox.js"));
      setSandbox(this.sandbox);
      const modulePath = path;
      const module = await import(browser.runtime.getURL(modulePath));
      this.sandbox.ZOTERO_TRANSLATOR_INFO = module.ZOTERO_TRANSLATOR_INFO;
      for (const fn of functions) {
        if (fn === "detectExport") continue;
        if (module[fn]) this.sandbox[fn] = module[fn];
      }
      return;
    }

    throw new Error(`Translator module path is missing for ${path || "unknown translator"}`);
  }

  /**
   * Imports an object into the sandbox
   * @param {Object} object Object to be imported (under attachTo)
   * @param {Boolean|Object} passTranslateAsFirstArgument Whether the translate instance should be passed as the first argument to the function.
   * @param {Object} attachTo An item from this.sandbox to which the object will be attached; defaults to this.sandbox.Zotero
   */
  importObject(object, passTranslateAsFirstArgument, attachTo = this.sandbox.Zotero) {
    const source = object.__exposedProps__ ? object.__exposedProps__ : object;
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (Function.prototype[key]) continue;
      if (typeof object[key] === "function" || typeof object[key] === "object") {
        const fn = object[key];
        attachTo[key] = (...args) => {
          const callArgs = passTranslateAsFirstArgument
            ? [passTranslateAsFirstArgument, ...args]
            : [...args];
          return fn.apply(object, callArgs);
        };

        this.importObject(
          object[key],
          passTranslateAsFirstArgument ? passTranslateAsFirstArgument : null,
          attachTo[key],
        );
      } else {
        attachTo[key] = object[key];
      }
    }
  }

  isModuleLoaded(_path) {
    return false;
  }
}

Zotero.Translate.SandboxManager = SandboxManager;

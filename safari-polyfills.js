(function () {
  if (!URL.parse) {
    URL.parse = function parseUrl(url, base) {
      try {
        return base ? new URL(url, base) : new URL(url);
      } catch (_error) {
        return null;
      }
    };
  }

  if (!Promise.withResolvers) {
    Promise.withResolvers = function withResolvers() {
      var resolve;
      var reject;
      var promise = new Promise(function (res, rej) {
        resolve = res;
        reject = rej;
      });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }

  if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", {
      value: function at(index) {
        var length = this.length >>> 0;
        var relativeIndex = Number(index) || 0;
        var finalIndex = relativeIndex < 0 ? length + relativeIndex : relativeIndex;
        return finalIndex < 0 || finalIndex >= length ? undefined : this[finalIndex];
      },
    });
  }

  if (!String.prototype.replaceAll) {
    Object.defineProperty(String.prototype, "replaceAll", {
      value: function replaceAll(search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) throw new TypeError("replaceAll requires a global RegExp");
          return this.replace(search, replacement);
        }
        return this.split(String(search)).join(String(replacement));
      },
    });
  }

  if (!Array.prototype.findLast) {
    Object.defineProperty(Array.prototype, "findLast", {
      value: function findLast(callback, thisArg) {
        for (var index = this.length - 1; index >= 0; index -= 1) {
          if (callback.call(thisArg, this[index], index, this)) return this[index];
        }
        return undefined;
      },
    });
  }

  if (!Array.prototype.findLastIndex) {
    Object.defineProperty(Array.prototype, "findLastIndex", {
      value: function findLastIndex(callback, thisArg) {
        for (var index = this.length - 1; index >= 0; index -= 1) {
          if (callback.call(thisArg, this[index], index, this)) return index;
        }
        return -1;
      },
    });
  }

  if (typeof Response !== "undefined" && !Response.prototype.bytes) {
    Response.prototype.bytes = function bytes() {
      return this.arrayBuffer().then(function (buffer) {
        return new Uint8Array(buffer);
      });
    };
  }

  if (!Object.hasOwn) {
    Object.hasOwn = function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    };
  }

  if (typeof Element !== "undefined" && !Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function replaceChildren() {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (var index = 0; index < arguments.length; index += 1) {
        var child = arguments[index];
        this.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    };
  }
})();

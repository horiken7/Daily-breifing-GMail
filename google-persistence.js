// Google connection persistence helper
// app.js uses sessionStorage, which is often cleared by mobile tab discard/reload.
// This helper keeps only the Google connection flags in localStorage while app.js can continue using sessionStorage.
(function () {
  "use strict";

  const APP_TOKEN_VERSION = "calendar-all-v2";
  const TOKEN_KEYS = new Set([
    "dailyBriefingGoogleToken",
    "dailyBriefingGoogleTokenVersion",
    "dailyBriefingTasksTokenVersion",
    "dailyBriefingTasksFixVersion"
  ]);

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  const sessionStore = window.sessionStorage;
  const localStore = window.localStorage;

  function isSessionStorage(target) {
    return target === sessionStore;
  }

  function localGet(key) {
    try {
      return originalGetItem.call(localStore, key);
    } catch (_) {
      return null;
    }
  }

  function localSet(key, value) {
    try {
      originalSetItem.call(localStore, key, String(value));
      originalSetItem.call(localStore, "dailyBriefingGoogleConnectionSavedAt", String(Date.now()));
    } catch (_) {}
  }

  function localRemove(key) {
    try {
      originalRemoveItem.call(localStore, key);
    } catch (_) {}
  }

  function hasSavedGoogleToken() {
    return Boolean(localGet("dailyBriefingGoogleToken"));
  }

  function normalizeGoogleTokenVersion(value) {
    // tasks-fix.js stores tasks-enabled-v1, while app.js expects calendar-all-v2.
    // Treat both as compatible so app.js does not erase a valid saved connection on reload.
    if (value === "tasks-enabled-v1" || value === APP_TOKEN_VERSION) return APP_TOKEN_VERSION;
    if (!value && hasSavedGoogleToken()) return APP_TOKEN_VERSION;
    return value;
  }

  Storage.prototype.getItem = function (key) {
    if (isSessionStorage(this) && TOKEN_KEYS.has(key)) {
      const saved = localGet(key);
      if (key === "dailyBriefingGoogleTokenVersion") return normalizeGoogleTokenVersion(saved);
      if (saved !== null && saved !== undefined) return saved;
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (isSessionStorage(this) && TOKEN_KEYS.has(key)) {
      localSet(key, value);
    }
    return originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (isSessionStorage(this) && TOKEN_KEYS.has(key)) {
      localRemove(key);
    }
    return originalRemoveItem.call(this, key);
  };

  Storage.prototype.clear = function () {
    if (isSessionStorage(this)) {
      TOKEN_KEYS.forEach(localRemove);
    }
    return originalClear.call(this);
  };

  window.DailyBriefingGooglePersistence = {
    version: "google-persistence-storage-v1",
    enabled: true,
    mode: "localStorage-backed Google connection"
  };
})();

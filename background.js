/**
 * X Space Multi-Window Muter — Background Service Worker (`background.js`, v1.1.2)
 * Broadcasts real-time mute & solo state changes (`XSM_MUTE_STATE_CHANGED`) to all X tabs
 * so the in-page toolbar buttons always show the exact current state and icon (`🔊` vs `🔇`).
 */

const spaceMetadataByTab = new Map();
const customLabelByTab = new Map();

const DEFAULT_PREFS = {
  autoSoloFocusedWindow: false,
  onlyFilterSpaceTabs: false
};

function isXUrl(url) {
  if (!url || typeof url !== "string") return false;
  return (
    url.startsWith("https://x.com/") ||
    url.startsWith("https://twitter.com/") ||
    url.startsWith("https://pro.x.com/")
  );
}

function isLikelySpaceTab(tab, meta) {
  const url = tab.url || "";
  const title = tab.title || "";
  if (url.includes("/i/spaces/")) return true;
  if (meta && (meta.hasSpaceDock || meta.spaceTitle)) return true;
  if (tab.audible) return true;
  if (/🎙️|🔇|space|语音室|スペース/i.test(title)) return true;
  return false;
}

async function getPrefs() {
  const res = await chrome.storage.local.get("xsm_prefs");
  return { ...DEFAULT_PREFS, ...(res.xsm_prefs || {}) };
}

async function savePrefs(partial) {
  const current = await getPrefs();
  const next = { ...current, ...(partial || {}) };
  await chrome.storage.local.set({ xsm_prefs: next });
  await updateExtensionBadge();
  return next;
}

/**
 * Push current `muted` and `isSolo` state to all open X tabs so their in-page buttons update immediately.
 */
async function broadcastMuteStatesToAllXTabs() {
  const allTabs = await chrome.tabs.query({});
  const xTabs = allTabs.filter((t) => isXUrl(t.url));
  const unmutedTabs = xTabs.filter((t) => !(t.mutedInfo && t.mutedInfo.muted));
  const isSingleSolo = unmutedTabs.length === 1 && xTabs.length > 1;

  await Promise.all(
    xTabs.map(async (t) => {
      const muted = Boolean(t.mutedInfo && t.mutedInfo.muted);
      const isSolo = isSingleSolo && !muted;
      try {
        await chrome.tabs.sendMessage(t.id, {
          type: "XSM_MUTE_STATE_CHANGED",
          muted,
          isSolo
        });
      } catch (_) {}
    })
  );
}

async function probeTabSpaceMeta(tab, isSolo) {
  const muted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "XSM_QUERY_SPACE_META",
      muted,
      isSolo
    });
    if (res && res.ok && res.payload) {
      const prev = spaceMetadataByTab.get(tab.id) || {};
      const merged = { ...prev, ...res.payload, updatedAt: Date.now() };
      spaceMetadataByTab.set(tab.id, merged);
      return merged;
    }
  } catch (_) {}
  return spaceMetadataByTab.get(tab.id) || null;
}

async function getAllXWindowsAndTabs() {
  const allTabs = await chrome.tabs.query({});
  const xTabs = allTabs.filter((t) => isXUrl(t.url));
  const unmutedTabs = xTabs.filter((t) => !(t.mutedInfo && t.mutedInfo.muted));
  const isSingleSolo = unmutedTabs.length === 1 && xTabs.length > 1;

  await Promise.all(
    xTabs.map((t) => {
      const muted = Boolean(t.mutedInfo && t.mutedInfo.muted);
      return probeTabSpaceMeta(t, isSingleSolo && !muted);
    })
  );

  const focusedWin = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  const focusedWindowId = focusedWin ? focusedWin.id : null;

  const windowsMap = new Map();

  for (const tab of xTabs) {
    const meta = spaceMetadataByTab.get(tab.id) || null;
    const customLabel = customLabelByTab.get(tab.id) || "";
    const isMuted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
    const isAudible = Boolean(tab.audible);
    const isSpace = isLikelySpaceTab(tab, meta);

    if (!windowsMap.has(tab.windowId)) {
      windowsMap.set(tab.windowId, {
        windowId: tab.windowId,
        isFocusedWindow: tab.windowId === focusedWindowId,
        tabs: [],
        anyAudible: false,
        allMuted: true,
        anyUnmuted: false,
        spaceCount: 0
      });
    }

    const winGroup = windowsMap.get(tab.windowId);

    const cleanedTabTitle = (tab.title || "")
      .replace(/^[🎙️🔇]\s*/, "")
      .replace(/\s*—\s*X Space$/i, "")
      .replace(/^\([0-9]+\)\s*/, "")
      .replace(/\s*\/\s*X$/i, "")
      .trim();

    const displayTitle =
      customLabel ||
      (meta && meta.spaceTitle && !/^(Home|主页)$/i.test(meta.spaceTitle) ? meta.spaceTitle : "") ||
      cleanedTabTitle ||
      "X Space";

    const enrichedTab = {
      tabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: Boolean(tab.active),
      title: displayTitle,
      customLabel,
      rawTabTitle: tab.title || "",
      speakerInfo: (meta && meta.speakerInfo) || "",
      hasSpaceDock: Boolean(meta && meta.hasSpaceDock),
      inPageVolume: meta && typeof meta.volume === "number" ? meta.volume : 100,
      url: tab.url || "",
      audible: isAudible,
      muted: isMuted,
      isSpace
    };

    winGroup.tabs.push(enrichedTab);
    if (isAudible) winGroup.anyAudible = true;
    if (!isMuted) {
      winGroup.allMuted = false;
      winGroup.anyUnmuted = true;
    }
    if (isSpace) winGroup.spaceCount += 1;
  }

  const windowsList = Array.from(windowsMap.values()).sort((a, b) => {
    if (a.isFocusedWindow !== b.isFocusedWindow) return a.isFocusedWindow ? -1 : 1;
    if (a.anyAudible !== b.anyAudible) return a.anyAudible ? -1 : 1;
    return a.windowId - b.windowId;
  });

  await updateExtensionBadge(windowsList);
  return windowsList;
}

async function updateExtensionBadge(precomputedWindows) {
  try {
    const windowsList = precomputedWindows || (await getAllXWindowsAndTabs());
    let unmutedCount = 0;
    let audibleCount = 0;

    for (const win of windowsList) {
      for (const t of win.tabs) {
        if (!t.muted) unmutedCount++;
        if (t.audible && !t.muted) audibleCount++;
      }
    }

    if (windowsList.length === 0) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }

    const text = audibleCount > 0 ? `${audibleCount}🔊` : `${unmutedCount}`;
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({
      color: audibleCount > 0 ? "#7856ff" : unmutedCount > 0 ? "#00ba7c" : "#536471"
    });
  } catch (_) {}
}

async function setTabMute(tabId, muted) {
  await chrome.tabs.update(Number(tabId), { muted: Boolean(muted) });
  await broadcastMuteStatesToAllXTabs();
  return getAllXWindowsAndTabs();
}

async function setWindowMute(windowId, muted) {
  const tabs = await chrome.tabs.query({ windowId: Number(windowId) });
  await Promise.all(
    tabs.filter((t) => isXUrl(t.url)).map((t) => chrome.tabs.update(t.id, { muted: Boolean(muted) }))
  );
  await broadcastMuteStatesToAllXTabs();
  return getAllXWindowsAndTabs();
}

async function soloWindow(targetWindowId) {
  const allTabs = await chrome.tabs.query({});
  const targetId = Number(targetWindowId);
  await Promise.all(
    allTabs
      .filter((t) => isXUrl(t.url))
      .map((t) => chrome.tabs.update(t.id, { muted: t.windowId !== targetId }))
  );
  await broadcastMuteStatesToAllXTabs();
  return getAllXWindowsAndTabs();
}

async function soloTab(targetTabId) {
  const allTabs = await chrome.tabs.query({});
  const targetId = Number(targetTabId);
  await Promise.all(
    allTabs
      .filter((t) => isXUrl(t.url))
      .map((t) => chrome.tabs.update(t.id, { muted: t.id !== targetId }))
  );
  await broadcastMuteStatesToAllXTabs();
  return getAllXWindowsAndTabs();
}

async function setAllWindowsMute(muted) {
  const allTabs = await chrome.tabs.query({});
  await Promise.all(
    allTabs
      .filter((t) => isXUrl(t.url))
      .map((t) => chrome.tabs.update(t.id, { muted: Boolean(muted) }))
  );
  await broadcastMuteStatesToAllXTabs();
  return getAllXWindowsAndTabs();
}

async function focusWindowAndTab(windowId, tabId) {
  if (windowId !== undefined && windowId !== null) {
    await chrome.windows.update(Number(windowId), { focused: true });
  }
  if (tabId !== undefined && tabId !== null) {
    await chrome.tabs.update(Number(tabId), { active: true });
  }
  return getAllXWindowsAndTabs();
}

async function setInPageVolume(tabId, volume) {
  const numTabId = Number(tabId);
  const clamped = Math.max(0, Math.min(100, Number(volume)));
  try {
    await chrome.tabs.sendMessage(numTabId, {
      type: "XSM_SET_VOLUME",
      volume: clamped
    });
  } catch (_) {}

  const prev = spaceMetadataByTab.get(numTabId) || {};
  spaceMetadataByTab.set(numTabId, { ...prev, volume: clamped });

  if (clamped > 0) {
    await chrome.tabs.update(numTabId, { muted: false }).catch(() => {});
    await broadcastMuteStatesToAllXTabs();
  }
  return getAllXWindowsAndTabs();
}

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const prefs = await getPrefs();
  if (!prefs.autoSoloFocusedWindow) return;

  const tabsInFocused = await chrome.tabs.query({ windowId }).catch(() => []);
  // Only solo when the focused window actually hosts a Space; otherwise browsing X
  // in another window would silently mute the window playing the Space.
  const hasSpaceTab = tabsInFocused.some(
    (t) => isXUrl(t.url) && isLikelySpaceTab(t, spaceMetadataByTab.get(t.id))
  );
  if (hasSpaceTab) {
    await soloWindow(windowId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  spaceMetadataByTab.delete(tabId);
  customLabelByTab.delete(tabId);
  updateExtensionBadge();
});

chrome.commands.onCommand.addListener(async (command) => {
  const currentWin = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  if (!currentWin) return;

  if (command === "solo-current-window") {
    await soloWindow(currentWin.id);
  } else if (command === "toggle-mute-current-window") {
    const xTabs = (currentWin.tabs || []).filter((t) => isXUrl(t.url));
    const anyUnmuted = xTabs.some((t) => !(t.mutedInfo && t.mutedInfo.muted));
    await setWindowMute(currentWin.id, anyUnmuted);
  } else if (command === "mute-all-windows") {
    await setAllWindowsMute(true);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "XSM_REPORT_SPACE_META" && sender.tab && sender.tab.id) {
    const tabId = sender.tab.id;
    const prev = spaceMetadataByTab.get(tabId) || {};
    const enteredSpace = !prev.hasSpaceDock && Boolean(message.payload && message.payload.hasSpaceDock);
    spaceMetadataByTab.set(tabId, {
      ...prev,
      ...(message.payload || {}),
      updatedAt: Date.now()
    });

    (async () => {
      let allTabs = await chrome.tabs.query({}).catch(() => []);
      let currentTab = allTabs.find((t) => t.id === tabId);

      // Tab mute persists across navigation; if the user just joined a Space in a tab
      // that was muted earlier (solo / mute-all), unmute it so the Space is audible.
      if (enteredSpace && currentTab && currentTab.mutedInfo && currentTab.mutedInfo.muted) {
        await chrome.tabs.update(tabId, { muted: false }).catch(() => {});
        await broadcastMuteStatesToAllXTabs();
        allTabs = await chrome.tabs.query({}).catch(() => []);
        currentTab = allTabs.find((t) => t.id === tabId);
      }

      const xTabs = allTabs.filter((t) => isXUrl(t.url));
      const unmutedTabs = xTabs.filter((t) => !(t.mutedInfo && t.mutedInfo.muted));
      const isSingleSolo = unmutedTabs.length === 1 && xTabs.length > 1;

      const muted = Boolean(
        currentTab ? currentTab.mutedInfo && currentTab.mutedInfo.muted : sender.tab.mutedInfo && sender.tab.mutedInfo.muted
      );
      const isSolo = isSingleSolo && !muted;

      await updateExtensionBadge();
      return { ok: true, muted, isSolo };
    })()
      .then((res) => sendResponse(res))
      .catch(() => {
        const muted = Boolean(sender.tab.mutedInfo && sender.tab.mutedInfo.muted);
        sendResponse({ ok: true, muted, isSolo: false });
      });

    return true;
  }

  if (message.type === "XSM_SOLO_SELF_TAB" && sender.tab && sender.tab.id) {
    soloTab(sender.tab.id).then(() => {
      sendResponse({ ok: true, muted: false, isSolo: true });
    });
    return true;
  }

  if (
    (message.type === "XSM_SET_SELF_MUTE" || message.type === "XSM_TOGGLE_SELF_MUTE") &&
    sender.tab &&
    sender.tab.id
  ) {
    (async () => {
      let nextMuted;
      if (typeof message.muted === "boolean") {
        nextMuted = message.muted;
      } else {
        const freshTab = await chrome.tabs.get(sender.tab.id).catch(() => sender.tab);
        const currentlyMuted = Boolean(freshTab && freshTab.mutedInfo && freshTab.mutedInfo.muted);
        nextMuted = !currentlyMuted;
      }
      await setTabMute(sender.tab.id, nextMuted);
      return { ok: true, muted: nextMuted, isSolo: false };
    })()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "XSM_SET_CUSTOM_LABEL") {
    const tabId = Number(message.tabId);
    const label = String(message.label || "").trim();
    if (label) {
      customLabelByTab.set(tabId, label);
    } else {
      customLabelByTab.delete(tabId);
    }
    getAllXWindowsAndTabs().then((windows) => sendResponse({ ok: true, windows }));
    return true;
  }

  if (message.type === "XSM_GET_STATE") {
    Promise.all([getAllXWindowsAndTabs(), getPrefs()]).then(([windows, prefs]) => {
      sendResponse({ ok: true, windows, prefs });
    });
    return true;
  }

  if (message.type === "XSM_SET_TAB_MUTE") {
    setTabMute(message.tabId, message.muted).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SET_WINDOW_MUTE") {
    setWindowMute(message.windowId, message.muted).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SOLO_WINDOW") {
    soloWindow(message.windowId).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SOLO_TAB") {
    soloTab(message.tabId).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SET_ALL_MUTE") {
    setAllWindowsMute(message.muted).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_FOCUS_TARGET") {
    focusWindowAndTab(message.windowId, message.tabId).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SET_TAB_VOLUME") {
    setInPageVolume(message.tabId, message.volume).then((windows) => {
      sendResponse({ ok: true, windows });
    });
    return true;
  }

  if (message.type === "XSM_SAVE_PREFS") {
    savePrefs(message.prefs).then(async (prefs) => {
      const windows = await getAllXWindowsAndTabs();
      sendResponse({ ok: true, prefs, windows });
    });
    return true;
  }

  return false;
});

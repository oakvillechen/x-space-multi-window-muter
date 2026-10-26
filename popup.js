/**
 * X Space Multi-Window Muter — Popup Controller (`popup.js`, v1.1.0)
 */
(function () {
  "use strict";

  const containerEl = document.getElementById("windowsContainer");
  const summaryPillEl = document.getElementById("summaryPill");
  const autoSoloCheckbox = document.getElementById("autoSoloFocusedWindow");

  let latestWindows = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderWindows(windows, prefs) {
    latestWindows = windows || [];
    if (prefs) {
      autoSoloCheckbox.checked = Boolean(prefs.autoSoloFocusedWindow);
    }

    const totalWindows = latestWindows.length;
    let totalTabs = 0;
    let unmutedTabs = 0;

    latestWindows.forEach((w) => {
      totalTabs += w.tabs.length;
      w.tabs.forEach((t) => {
        if (!t.muted) unmutedTabs++;
      });
    });

    summaryPillEl.textContent = `${totalWindows} 窗口 / ${totalTabs} 空间 · ${unmutedTabs} 发声`;

    if (totalWindows === 0) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <div>当前没有检测到打开的 X (x.com) 页面。</div>
          <div style="font-size:11px;margin-top:4px;">打开 X Space 后，这里会自动显示每个 Space 的标题、主持人与发言人。</div>
        </div>
      `;
      return;
    }

    containerEl.innerHTML = latestWindows
      .map((win, idx) => {
        const isUnmuted = win.anyUnmuted;
        const winStatusBadge = win.anyAudible && isUnmuted
          ? `<span class="audible-pill">🔊 正在发声</span>`
          : isUnmuted
          ? `<span class="audible-pill">🔔 未静音</span>`
          : `<span class="muted-pill">🔇 已静音</span>`;

        const tabsHtml = win.tabs
          .map((t, tIdx) => {
            const subInfo = t.speakerInfo
              ? escapeHtml(t.speakerInfo)
              : t.audible
              ? "🎵 正在播放 Space 音频流"
              : "等待音频流 / 点击 ✏️ 可自定义备注名";

            return `
              <div class="tab-row" data-tab-id="${t.tabId}" data-win-id="${win.windowId}">
                <div class="tab-top">
                  <div class="tab-info-wrap">
                    <div class="tab-title-line">
                      <span class="tab-name" data-action="focus-tab" data-win-id="${win.windowId}" data-tab-id="${t.tabId}" title="点击跳转到该 Space 标签页">
                        ${t.isSpace ? "🟣 " : "#" + (tIdx + 1) + " "}${escapeHtml(t.title)}
                      </span>
                      <button type="button" class="edit-label-btn" data-action="rename-tab" data-tab-id="${t.tabId}" data-current="${escapeHtml(t.customLabel || t.title)}" title="自定义备注名称">
                        ✏️
                      </button>
                    </div>
                    <div class="tab-sub">${subInfo}</div>
                  </div>
                  <div class="win-actions">
                    <button type="button" class="mini-btn btn-solo" data-action="solo-tab" data-tab-id="${t.tabId}" title="仅收听此 Space，一键静音其他所有 Space">
                      独奏
                    </button>
                    <button type="button" class="mini-btn ${t.muted ? "muted-state" : "unmuted-state"}" data-action="toggle-tab-mute" data-tab-id="${t.tabId}" data-muted="${t.muted}">
                      ${t.muted ? "🔇 已静音" : "🔊 发声中"}
                    </button>
                  </div>
                </div>
                <div class="vol-row">
                  <span>音量</span>
                  <input type="range" class="vol-slider" min="0" max="100" value="${t.inPageVolume}" data-action="tab-volume" data-tab-id="${t.tabId}" />
                  <span class="vol-val">${t.inPageVolume}%</span>
                </div>
              </div>
            `;
          })
          .join("");

        return `
          <div class="window-card ${win.isFocusedWindow ? "focused-win" : ""}">
            <div class="win-header">
              <div class="win-title">
                <span>🪟 窗口 #${idx + 1}</span>
                ${win.isFocusedWindow ? `<span class="win-badge">当前窗口</span>` : ""}
                ${winStatusBadge}
              </div>
              <div class="win-actions">
                <button type="button" class="mini-btn btn-solo" data-action="solo-window" data-win-id="${win.windowId}">
                  🎧 独奏此窗口
                </button>
                <button type="button" class="mini-btn ${isUnmuted ? "unmuted-state" : "muted-state"}" data-action="toggle-window-mute" data-win-id="${win.windowId}" data-unmuted="${isUnmuted}">
                  ${isUnmuted ? "🔇 静音窗口" : "🔊 取消静音"}
                </button>
              </div>
            </div>
            ${tabsHtml}
          </div>
        `;
      })
      .join("");
  }

  function refreshState() {
    chrome.runtime.sendMessage({ type: "XSM_GET_STATE" }, (res) => {
      if (res && res.ok) {
        renderWindows(res.windows, res.prefs);
      }
    });
  }

  containerEl.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;

    const action = target.getAttribute("data-action");
    const winId = target.getAttribute("data-win-id");
    const tabId = target.getAttribute("data-tab-id");

    if (action === "rename-tab") {
      const currentName = target.getAttribute("data-current") || "";
      const nextName = window.prompt("为该 Space 设置自定义备注名称（留空恢复自动识别）：", currentName);
      if (nextName !== null) {
        chrome.runtime.sendMessage(
          { type: "XSM_SET_CUSTOM_LABEL", tabId: Number(tabId), label: nextName },
          (res) => {
            if (res && res.windows) renderWindows(res.windows);
          }
        );
      }
      return;
    }

    if (action === "solo-window") {
      chrome.runtime.sendMessage({ type: "XSM_SOLO_WINDOW", windowId: Number(winId) }, (res) => {
        if (res && res.windows) renderWindows(res.windows);
      });
    } else if (action === "toggle-window-mute") {
      const currentlyUnmuted = target.getAttribute("data-unmuted") === "true";
      chrome.runtime.sendMessage(
        { type: "XSM_SET_WINDOW_MUTE", windowId: Number(winId), muted: currentlyUnmuted },
        (res) => {
          if (res && res.windows) renderWindows(res.windows);
        }
      );
    } else if (action === "solo-tab") {
      chrome.runtime.sendMessage({ type: "XSM_SOLO_TAB", tabId: Number(tabId) }, (res) => {
        if (res && res.windows) renderWindows(res.windows);
      });
    } else if (action === "toggle-tab-mute") {
      const currentlyMuted = target.getAttribute("data-muted") === "true";
      chrome.runtime.sendMessage(
        { type: "XSM_SET_TAB_MUTE", tabId: Number(tabId), muted: !currentlyMuted },
        (res) => {
          if (res && res.windows) renderWindows(res.windows);
        }
      );
    } else if (action === "focus-tab") {
      chrome.runtime.sendMessage(
        { type: "XSM_FOCUS_TARGET", windowId: Number(winId), tabId: Number(tabId) },
        (res) => {
          if (res && res.windows) renderWindows(res.windows);
        }
      );
    }
  });

  containerEl.addEventListener("input", (e) => {
    const slider = e.target.closest('[data-action="tab-volume"]');
    if (!slider) return;
    const tabId = Number(slider.getAttribute("data-tab-id"));
    const vol = Number(slider.value);
    const label = slider.parentElement.querySelector(".vol-val");
    if (label) label.textContent = `${vol}%`;

    chrome.runtime.sendMessage({
      type: "XSM_SET_TAB_VOLUME",
      tabId,
      volume: vol
    });
  });

  document.getElementById("soloCurrentWinBtn").addEventListener("click", () => {
    const focused = latestWindows.find((w) => w.isFocusedWindow) || latestWindows[0];
    if (!focused) return;
    chrome.runtime.sendMessage({ type: "XSM_SOLO_WINDOW", windowId: focused.windowId }, (res) => {
      if (res && res.windows) renderWindows(res.windows);
    });
  });

  document.getElementById("muteAllBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "XSM_SET_ALL_MUTE", muted: true }, (res) => {
      if (res && res.windows) renderWindows(res.windows);
    });
  });

  document.getElementById("unmuteAllBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "XSM_SET_ALL_MUTE", muted: false }, (res) => {
      if (res && res.windows) renderWindows(res.windows);
    });
  });

  autoSoloCheckbox.addEventListener("change", () => {
    chrome.runtime.sendMessage(
      {
        type: "XSM_SAVE_PREFS",
        prefs: { autoSoloFocusedWindow: autoSoloCheckbox.checked }
      },
      (res) => {
        if (res && res.windows) renderWindows(res.windows, res.prefs);
      }
    );
  });

  refreshState();
  setInterval(refreshState, 2000);
})();

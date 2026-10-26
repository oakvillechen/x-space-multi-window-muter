/**
 * X Space Multi-Window Muter — Zero-Lag Content Script (`content.js`, v1.2.0)
 *
 * CRITICAL STABILITY GUARANTEES:
 * 1. NO `MutationObserver` (prevents infinite DOM mutation loops that freeze X.com).
 * 2. NEVER modifies X's `#react-root` tree or `document.title`.
 * 3. Renders a standalone `position: fixed` floating control pill directly under `document.body`
 *    ONLY when an active X Space is detected on the page.
 */
(function () {
  "use strict";

  let currentVolume = 100;
  let userAdjustedVolume = false;
  let selfMuted = false;
  let selfSoloActive = false;
  let floatingBarEl = null;

  function safeSendMessage(message, callback) {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
        if (typeof callback === "function") callback(null);
        return;
      }
      chrome.runtime.sendMessage(message, function (response) {
        const err = chrome.runtime.lastError;
        if (err) {
          if (typeof callback === "function") callback(null);
          return;
        }
        if (typeof callback === "function") {
          callback(response || null);
        }
      });
    } catch (_) {
      if (typeof callback === "function") callback(null);
    }
  }

  /**
   * Space audio stream watchdog:
   * X Spaces uses WebRTC mapped to `<audio>` elements (often with srcObject).
   * Feed videos use `<video>`.
   * When selfMuted is false, actively un-mute any stuck Space `<audio>` elements
   * and resume playback if blocked by Chrome autoplay policy.
   */
  function syncLocalMediaElements() {
    const ratio = Math.max(0, Math.min(100, Number(currentVolume))) / 100;
    const audioEls = document.querySelectorAll("audio");
    for (let i = 0; i < audioEls.length; i++) {
      const a = audioEls[i];
      try {
        if (selfMuted) {
          a.muted = true;
        } else {
          if (a.muted) a.muted = false;
          if (userAdjustedVolume) {
            if (a.volume !== ratio) a.volume = ratio;
          } else if (a.volume === 0) {
            a.volume = 1;
          }
          if (a.paused) {
            a.play().catch(function () {});
          }
        }
      } catch (_) {}
    }

    // For video elements in tweets, only touch volume if user explicitly dragged slider
    if (userAdjustedVolume) {
      const videoEls = document.querySelectorAll("video");
      for (let i = 0; i < videoEls.length; i++) {
        try {
          if (videoEls[i].volume !== ratio) videoEls[i].volume = ratio;
        } catch (_) {}
      }
    }
  }

  function applyVolumeToMediaElements(volPercent) {
    currentVolume = Math.max(0, Math.min(100, Number(volPercent)));
    userAdjustedVolume = currentVolume !== 100;
    if (!userAdjustedVolume) {
      // Restore full volume once, then stop touching elements.
      const mediaEls = document.querySelectorAll("audio, video");
      for (let i = 0; i < mediaEls.length; i++) {
        try {
          mediaEls[i].volume = 1;
        } catch (_) {}
      }
    }
    if (currentVolume > 0 && selfMuted) {
      selfMuted = false;
    }
    syncLocalMediaElements();
    renderFloatingPillState();
  }

  /**
   * Read-only inspection of the Space panel to get Space title and speaker info.
   * Never mutates anything inside X's React container.
   */
  function readSpaceInfoFromDOM() {
    const candidates = document.querySelectorAll('button, [role="button"]');
    let spaceContainer = null;

    for (let i = 0; i < candidates.length; i++) {
      const btn = candidates[i];
      const txt = (btn.textContent || "").trim();
      if (txt === "Leave" || txt === "离开" || txt === "退出" || txt === "退出空间") {
        let cur = btn.parentElement;
        for (let depth = 0; depth < 7 && cur && cur !== document.body; depth++) {
          if (cur.clientHeight >= 100) {
            spaceContainer = cur;
            break;
          }
          cur = cur.parentElement;
        }
        if (spaceContainer) break;
      }
    }

    if (!spaceContainer) {
      spaceContainer =
        document.querySelector('[data-testid="SpaceDock"]') ||
        document.querySelector('[data-testid="SpaceDockExpanded"]');
    }

    if (!spaceContainer) {
      return {
        hasSpaceDock: window.location.pathname.includes("/i/spaces/"),
        spaceTitle: "",
        speakerInfo: "",
        volume: currentVolume
      };
    }

    const rawLines = (spaceContainer.innerText || "")
      .split("\n")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    const IGNORE_SET = {
      "Leave": true,
      "离开": true,
      "退出": true,
      "REC": true,
      "● REC": true,
      "LIVE": true,
      "Host": true,
      "Speaker": true,
      "Listener": true,
      "Listeners": true,
      "主持人": true,
      "发言人": true,
      "听众": true,
      "正在发言": true,
      "Speaking": true,
      "Muted": true,
      "Join": true,
      "Share": true,
      "X Article": true,
      "Article": true
    };

    let isRecorded = false;
    let spaceTitle = "";
    let hostName = "";
    const speakers = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line === "REC" || line === "● REC") isRecorded = true;
      if ((line === "Host" || line === "主持人") && i > 0) {
        const prev = rawLines[i - 1].replace(/^@.*/, "").trim();
        if (prev && !IGNORE_SET[prev]) hostName = prev;
      } else if ((line === "Speaker" || line === "发言人" || line === "正在发言") && i > 0) {
        const prev = rawLines[i - 1].replace(/^@.*/, "").trim();
        if (prev && !IGNORE_SET[prev] && prev !== hostName && speakers.indexOf(prev) === -1) {
          speakers.push(prev);
        }
      }
    }

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (IGNORE_SET[line]) continue;
      if (/^[0-9]+$/.test(line)) continue;

      const nextLine = rawLines[i + 1] || "";
      if (/^(Host|Speaker|Listener|主持人|发言人|听众)$/i.test(nextLine)) {
        break;
      }
      if (line.charAt(0) === "@" || /@[A-Za-z0-9_]+/.test(line)) {
        break;
      }
      spaceTitle = line;
      break;
    }

    if (!spaceTitle && hostName) {
      spaceTitle = hostName + " 的 Space";
    }

    const roleParts = [];
    if (isRecorded) roleParts.push("🔴 REC");
    if (hostName) roleParts.push("主持人: " + hostName);
    if (speakers.length > 0) roleParts.push("发言: " + speakers.slice(0, 3).join(", "));

    return {
      hasSpaceDock: true,
      spaceTitle: spaceTitle,
      speakerInfo: roleParts.join(" · "),
      volume: currentVolume
    };
  }

  /**
   * Ensure a standalone floating control pill exists on `document.body` (outside React root)
   * when a Space is active on the page.
   */
  function ensureFloatingPill(visible, spaceTitle) {
    if (!visible) {
      if (floatingBarEl) {
        floatingBarEl.style.display = "none";
      }
      return;
    }

    if (!floatingBarEl) {
      floatingBarEl = document.createElement("div");
      floatingBarEl.id = "xsm-floating-controller";
      floatingBarEl.style.cssText = [
        "position:fixed",
        "bottom:18px",
        "right:18px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:7px 12px",
        "border-radius:999px",
        "background:rgba(15, 20, 25, 0.94)",
        "backdrop-filter:blur(10px)",
        "border:1.5px solid #00ba7c",
        "box-shadow:0 8px 24px rgba(0,0,0,0.45)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        "font-size:12px",
        "color:#e7e9ea",
        "user-select:none"
      ].join(";");

      floatingBarEl.innerHTML = [
        '<span class="xsm-pill-title" style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;color:#e7e9ea;">🎙️ Space</span>',
        '<button type="button" class="xsm-pill-solo" style="padding:4px 10px;border-radius:999px;border:1px solid #7856ff;background:rgba(120,86,255,0.2);color:#d2c4ff;font-size:11.5px;font-weight:700;cursor:pointer;">🎧 独奏此窗</button>',
        '<button type="button" class="xsm-pill-mute" style="padding:4px 10px;border-radius:999px;border:1px solid #00ba7c;background:#00ba7c;color:#ffffff;font-size:11.5px;font-weight:700;cursor:pointer;">🔊 发声中</button>'
      ].join("");

      const soloBtn = floatingBarEl.querySelector(".xsm-pill-solo");
      const muteBtn = floatingBarEl.querySelector(".xsm-pill-mute");

      soloBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        selfMuted = false;
        selfSoloActive = true;
        syncLocalMediaElements();
        renderFloatingPillState();

        safeSendMessage({ type: "XSM_SOLO_SELF_TAB" }, function (res) {
          if (res && typeof res.muted === "boolean") {
            selfMuted = res.muted;
            selfSoloActive = Boolean(res.isSolo);
            syncLocalMediaElements();
            renderFloatingPillState();
          }
        });
      });

      muteBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const nextMuted = !selfMuted;
        selfMuted = nextMuted;
        selfSoloActive = false;
        syncLocalMediaElements();
        renderFloatingPillState();

        safeSendMessage({ type: "XSM_SET_SELF_MUTE", muted: nextMuted }, function (res) {
          if (res && typeof res.muted === "boolean") {
            selfMuted = res.muted;
            selfSoloActive = Boolean(res.isSolo);
            syncLocalMediaElements();
            renderFloatingPillState();
          }
        });
      });

      document.body.appendChild(floatingBarEl);
    }

    floatingBarEl.style.display = "flex";
    const titleEl = floatingBarEl.querySelector(".xsm-pill-title");
    if (titleEl) {
      titleEl.textContent = (selfMuted ? "🔇 " : "🎙️ ") + (spaceTitle || "X Space");
    }
    renderFloatingPillState();
  }

  function renderFloatingPillState() {
    if (!floatingBarEl) return;
    const soloBtn = floatingBarEl.querySelector(".xsm-pill-solo");
    const muteBtn = floatingBarEl.querySelector(".xsm-pill-mute");
    const titleEl = floatingBarEl.querySelector(".xsm-pill-title");

    if (selfMuted) {
      floatingBarEl.style.borderColor = "#f4212e";
      if (titleEl) {
        titleEl.textContent = titleEl.textContent.replace(/^[🎙️🔊🔇]\s*/, "🔇 ");
      }
      if (muteBtn) {
        muteBtn.textContent = "🔇 已静音 (点此恢复)";
        muteBtn.style.background = "#f4212e";
        muteBtn.style.borderColor = "#f4212e";
        muteBtn.style.color = "#ffffff";
      }
    } else {
      floatingBarEl.style.borderColor = "#00ba7c";
      if (titleEl) {
        titleEl.textContent = titleEl.textContent.replace(/^[🎙️🔊🔇]\s*/, "🔊 ");
      }
      if (muteBtn) {
        muteBtn.textContent = "🔊 发声中 (点此静音)";
        muteBtn.style.background = "#00ba7c";
        muteBtn.style.borderColor = "#00ba7c";
        muteBtn.style.color = "#ffffff";
      }
    }

    if (soloBtn) {
      if (selfSoloActive && !selfMuted) {
        soloBtn.textContent = "🎧 正在独奏 ✓";
        soloBtn.style.background = "#7856ff";
        soloBtn.style.color = "#ffffff";
      } else {
        soloBtn.textContent = "🎧 独奏此窗";
        soloBtn.style.background = "rgba(120,86,255,0.2)";
        soloBtn.style.color = "#d2c4ff";
      }
    }
  }

  function periodicTick() {
    const info = readSpaceInfoFromDOM();
    ensureFloatingPill(info.hasSpaceDock, info.spaceTitle);
    safeSendMessage(
      {
        type: "XSM_REPORT_SPACE_META",
        payload: info
      },
      function (res) {
        if (res && typeof res.muted === "boolean") {
          selfMuted = res.muted;
          if (typeof res.isSolo === "boolean") {
            selfSoloActive = res.isSolo;
          }
          syncLocalMediaElements();
          renderFloatingPillState();
        }
      }
    );
  }

  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!message || typeof message !== "object") return false;

        if (message.type === "XSM_MUTE_STATE_CHANGED") {
          selfMuted = Boolean(message.muted);
          selfSoloActive = Boolean(message.isSolo);
          syncLocalMediaElements();
          renderFloatingPillState();
          sendResponse({ ok: true });
          return false;
        }

        if (message.type === "XSM_SET_VOLUME") {
          applyVolumeToMediaElements(message.volume);
          const payload = readSpaceInfoFromDOM();
          sendResponse({ ok: true, volume: currentVolume, payload: payload });
          return false;
        }

        if (message.type === "XSM_QUERY_SPACE_META") {
          if (typeof message.muted === "boolean") {
            selfMuted = message.muted;
            selfSoloActive = Boolean(message.isSolo);
            syncLocalMediaElements();
          }
          const payload = readSpaceInfoFromDOM();
          ensureFloatingPill(payload.hasSpaceDock, payload.spaceTitle);
          sendResponse({ ok: true, payload: payload });
          return false;
        }

        return false;
      });
    }
  } catch (_) {}

  // Resume blocked autoplay on user gesture
  document.addEventListener("click", function () {
    if (!selfMuted) {
      syncLocalMediaElements();
    }
  }, { passive: true });

  // Gentle 2.5s polling — ZERO MutationObserver, ZERO lag on X.com
  setTimeout(periodicTick, 600);
  setInterval(periodicTick, 2500);
})();

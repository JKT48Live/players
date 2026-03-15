import {
  getProxyChain,
  createProxyLoader,
  formatAbsoluteDate,
  formatNumber,
  loadIdnChatRoomId,
  loadLivePayload,
  loadShowroomLiveInfo
} from "./shared.js?v=20260316m";

const query = new URLSearchParams(window.location.search);

const elements = {
  backHomeLink: document.querySelector("#back-home-link"),
  playerTitle: document.querySelector("#player-title"),
  playerRoomLink: document.querySelector("#player-room-link"),
  playerMeta: document.querySelector("#player-meta"),
  mainPlayer: document.querySelector("#main-player"),
  mainPlayerFrame: document.querySelector("#main-player-frame"),
  primaryPlayerPanel: document.querySelector("#primary-player-panel"),
  rotateMainPlayer: document.querySelector("#rotate-main-player"),
  commentsPanel: document.querySelector("#comments-panel"),
  commentsTitle: document.querySelector("#comments-title"),
  commentsStatus: document.querySelector("#comments-status"),
  commentsFeed: document.querySelector("#comments-feed"),
  commentsEmpty: document.querySelector("#comments-empty"),
  railTitle: document.querySelector("#rail-title"),
  railPanel: document.querySelector(".rail-panel"),
  watchLayout: document.querySelector(".watch-layout"),
  streamRail: document.querySelector("#stream-rail"),
  multiViewPanel: document.querySelector("#multiview"),
  multiViewPicker: document.querySelector("#multiview-picker"),
  multiviewGrid: document.querySelector("#multiview-grid"),
  clearMultiview: document.querySelector("#clear-multiview")
};

function syncPageTitle() {
  document.title =
    query.get("mode") === "multi"
      ? "Multi-view • JKT48 Live Player"
      : "Single • JKT48 Live Player";
}

function withCurrentQuery(path, extraParams = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function appendRefreshToken(url) {
  if (!url) {
    return url;
  }

  try {
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("_r", String(Date.now()));
    return nextUrl.toString();
  } catch (error) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}_r=${Date.now()}`;
  }
}

const state = {
  streams: [],
  proxies: {
    showroom: null,
    idn: null
  },
  currentStreamId: query.get("id"),
  multiViewIds: []
};

let mainPlayerController = null;
const multiViewControllers = new Map();
const multiViewSlots = new Map();
let mainPlayerRotation = 0;
let commentSocket = null;
let commentPingInterval = null;
let commentReconnectTimer = null;
let activeCommentStreamId = null;
let idnCommentHealthInterval = null;
let idnLastPingKey = "";
let pendingRotateAfterFullscreen = false;
let vidstackReadyPromise = null;
let mainVidstackProvider = null;

function getCurrentStream() {
  return state.streams.find((item) => item.id === state.currentStreamId) ?? null;
}

function getPreferredProxyChain(stream) {
  const preferredProxy =
    stream?.platformKey === "idn" ? state.proxies.idn : null;

  return preferredProxy ? getProxyChain(preferredProxy) : [];
}

function getMainPlayerMedia() {
  return elements.mainPlayer?.querySelector("video") ?? null;
}

function waitForFrames(count = 1) {
  return new Promise((resolve) => {
    const step = () => {
      if (count <= 0) {
        resolve();
        return;
      }

      count -= 1;
      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

function ensureVidstackReady() {
  if (!vidstackReadyPromise) {
    vidstackReadyPromise = Promise.all([
      customElements.whenDefined("media-player"),
      customElements.whenDefined("media-provider")
    ]);
  }

  return vidstackReadyPromise;
}

function recreateMainPlayerElement() {
  const currentPlayer = elements.mainPlayer;
  if (!currentPlayer) {
    return null;
  }

  try {
    currentPlayer.pause?.();
  } catch (error) {
    console.error(error);
  }

  const nextPlayer = document.createElement("media-player");
  nextPlayer.id = "main-player";
  nextPlayer.setAttribute("view-type", "video");
  nextPlayer.setAttribute("stream-type", "live");
  nextPlayer.setAttribute("playsinline", "");
  nextPlayer.innerHTML = `
    <media-provider></media-provider>
    <media-video-layout></media-video-layout>
  `;

  currentPlayer.replaceWith(nextPlayer);
  elements.mainPlayer = nextPlayer;
  mainVidstackProvider = null;
  return nextPlayer;
}

function stopMainPlayer() {
  if (!elements.mainPlayer) {
    return;
  }

  try {
    elements.mainPlayer.pause?.();
  } catch (error) {
    console.error(error);
  }
}

function syncMainPlayerViewport(attempt = 0) {
  const media = getMainPlayerMedia();

  if (media) {
    syncViewportToVideo(media, elements.mainPlayerFrame);
    requestAnimationFrame(syncCommentsFeedHeight);
    return;
  }

  if (attempt < 20) {
    requestAnimationFrame(() => syncMainPlayerViewport(attempt + 1));
  }
}

function applyProviderConfig(provider, stream) {
  if (!provider || !stream) {
    return;
  }

  try {
    provider.library = window.Hls;
  } catch (error) {
    console.error(error);
  }

  try {
    const proxyChain = getPreferredProxyChain(stream);
    provider.config = {
      lowLatencyMode: true,
      enableWorker: true,
      loader: proxyChain.length > 0 ? createProxyLoader(proxyChain) : window.Hls.DefaultConfig.loader
    };
  } catch (error) {
    console.error(error);
  }
}

function setupMainVidstackPlayer() {
  if (!elements.mainPlayer || elements.mainPlayer.dataset.vidstackReady === "true") {
    return;
  }

  elements.mainPlayer.dataset.vidstackReady = "true";
  elements.mainPlayer.setAttribute("load", "eager");
  elements.mainPlayer.setAttribute("autoplay", "");
  elements.mainPlayer.addEventListener("provider-change", (event) => {
    const provider = event.detail;
    const stream = getCurrentStream();

    if (!provider || !stream) {
      return;
    }

    mainVidstackProvider = provider;
    applyProviderConfig(provider, stream);
    syncMainPlayerViewport();
    requestAnimationFrame(syncMainPlayerRotation);
  });

  elements.mainPlayer.addEventListener("fullscreen-change", () => {
    requestAnimationFrame(() => {
      syncMainPlayerFullscreenState();
      syncMainPlayerViewport();
      if (isMainPlayerFullscreen()) {
        resetMainPlayerRotation();
      } else if (pendingRotateAfterFullscreen) {
        pendingRotateAfterFullscreen = false;
        mainPlayerRotation = (mainPlayerRotation + 90) % 360;
        syncMainPlayerRotation();
      } else {
        syncMainPlayerRotation();
      }
    });
  });

  document.addEventListener("fullscreenchange", () => {
    requestAnimationFrame(() => {
      syncMainPlayerFullscreenState();
      syncMainPlayerViewport();
      if (isMainPlayerFullscreen()) {
        resetMainPlayerRotation();
      } else if (pendingRotateAfterFullscreen) {
        pendingRotateAfterFullscreen = false;
        mainPlayerRotation = (mainPlayerRotation + 90) % 360;
        syncMainPlayerRotation();
      } else {
        syncMainPlayerRotation();
      }
    });
  });
}

function setupMultiViewVidstackPlayer(player, slot, stream) {
  if (!player || player.dataset.vidstackReady === "true") {
    return;
  }

  player.dataset.vidstackReady = "true";
  player.setAttribute("load", "eager");
  player.setAttribute("autoplay", "");
  player.addEventListener("provider-change", (event) => {
    const provider = event.detail;
    const activeStream = state.streams.find((item) => item.id === slot.dataset.streamId) ?? stream;

    if (!provider || !activeStream) {
      return;
    }

    applyProviderConfig(provider, activeStream);

    const syncSlotViewport = (attempt = 0) => {
      const media = getPlayerMedia(player);

      if (media) {
        syncViewportToVideo(media, slot);
        return;
      }

      if (attempt < 20) {
        requestAnimationFrame(() => syncSlotViewport(attempt + 1));
      }
    };

    syncSlotViewport();
  });
}

function destroyController(controller) {
  if (!controller) {
    return;
  }

  if (controller.player) {
    try {
      controller.player.pause?.();
    } catch (error) {
      console.error(error);
    }

    try {
      controller.player.src = null;
    } catch (error) {
      console.error(error);
    }
  }

  if (controller.hls) {
    controller.hls.destroy();
  }

  if (controller.video) {
    controller.video.pause();
    controller.video.removeAttribute("src");
    controller.video.load();
  }
}

function getPlayerMedia(player) {
  return player?.querySelector("video") ?? null;
}

function stopVideoElement(video) {
  if (!video) {
    return;
  }

  video.pause();
  video.removeAttribute("src");
  video.load();
}

function syncCommentsFeedHeight() {
  const videoHeight = Math.round(elements.mainPlayerFrame?.getBoundingClientRect().height || 0);

  if (videoHeight > 0) {
    elements.commentsPanel?.style.setProperty("--comments-feed-max-height", `${videoHeight}px`);
  } else {
    elements.commentsPanel?.style.removeProperty("--comments-feed-max-height");
  }
}

function getMainPlayerStage() {
  return elements.mainPlayerFrame?.querySelector(".video-stage") ?? elements.mainPlayerFrame;
}

function getMainPlayerRotateTarget() {
  return elements.mainPlayer?.querySelector("media-provider") ?? getMainPlayerStage();
}

function getMultiViewRotateTarget(slot) {
  return slot?.querySelector("media-provider") ?? slot?.querySelector(".video-stage") ?? slot;
}

function syncMultiViewRotatedViewport(slot) {
  if (!slot) {
    return;
  }

  const rotationTarget = getMultiViewRotateTarget(slot);
  const rotation = Number(rotationTarget?.dataset.rotation || 0);
  const normalized = ((rotation % 360) + 360) % 360;
  const isQuarterTurn = normalized === 90 || normalized === 270;
  const isPortrait = slot.dataset.orientation === "portrait";

  slot.dataset.rotatedQuarter = isQuarterTurn ? "true" : "false";
  slot.dataset.viewportMode = isPortrait && isQuarterTurn ? "landscape" : "";
}

function isMainPlayerFullscreen() {
  const activeFullscreenElement = document.fullscreenElement;
  return Boolean(
    activeFullscreenElement &&
      (activeFullscreenElement === elements.mainPlayer ||
        activeFullscreenElement === elements.mainPlayerFrame ||
        elements.mainPlayer?.contains(activeFullscreenElement))
  );
}

function syncMainPlayerFullscreenState() {
  if (!elements.mainPlayerFrame) {
    return;
  }

  elements.mainPlayerFrame.dataset.fullscreen = isMainPlayerFullscreen() ? "true" : "false";
}

function resetMainPlayerRotation() {
  mainPlayerRotation = 0;
  syncMainPlayerRotation();
}

function syncMainPlayerRotation() {
  const rotateTarget = getMainPlayerRotateTarget();
  if (!rotateTarget) {
    return;
  }

  rotateTarget.dataset.rotation = String(mainPlayerRotation);
  rotateTarget.dataset.orientation = elements.mainPlayerFrame.dataset.orientation || "";
  applyRotation(rotateTarget, mainPlayerRotation);
  forceVideoRepaint(rotateTarget, getMainPlayerMedia());
}

function applyRotation(container, rotation) {
  if (!container) {
    return;
  }

  const normalized = ((rotation % 360) + 360) % 360;
  const isQuarterTurn = normalized === 90 || normalized === 270;
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const multiViewSlot = container.closest?.(".multiview-slot");
  const shouldFillRotatedViewport =
    multiViewSlot?.dataset.orientation === "portrait" &&
    multiViewSlot?.dataset.viewportMode === "landscape" &&
    isQuarterTurn;
  const scale = isQuarterTurn
    ? shouldFillRotatedViewport
      ? Math.max(width / height, height / width)
      : Math.min(width / height, height / width)
    : 1;

  container.style.setProperty("--video-rotation", `${normalized}deg`);
  container.style.setProperty("--video-scale", `${scale}`);
}

function forceVideoRepaint(container, video) {
  if (!container || !video) {
    return;
  }

  const nextNudge = container.dataset.repaintNudge === "1" ? "0px" : "0.001px";
  container.dataset.repaintNudge = nextNudge === "0px" ? "0" : "1";
  container.style.setProperty("--video-nudge", nextNudge);

  requestAnimationFrame(() => {
    if (!video.paused) {
      video.play().catch(() => {});
    }
  });
}

function rotateContainer(container, video) {
  const current = Number(container?.dataset.rotation || 0);
  const next = (current + 90) % 360;
  if (container) {
    container.dataset.rotation = String(next);
  }
  applyRotation(container, next);
  forceVideoRepaint(container, video);
}

function refreshMainPlayer() {
  const stream = getCurrentStream();
  if (!stream || !elements.mainPlayer) {
    return;
  }

  stopMainPlayer();
  setMainPlayer(stream).catch((error) => console.error(error));
}

function disconnectComments() {
  if (commentReconnectTimer) {
    clearTimeout(commentReconnectTimer);
    commentReconnectTimer = null;
  }

  if (commentPingInterval) {
    clearInterval(commentPingInterval);
    commentPingInterval = null;
  }

  if (idnCommentHealthInterval) {
    clearInterval(idnCommentHealthInterval);
    idnCommentHealthInterval = null;
  }

  if (commentSocket) {
    try {
      commentSocket.close();
    } catch (error) {
      console.error(error);
    }
    commentSocket = null;
  }

  idnLastPingKey = "";
}

function setCommentsStatus(label, tone = "idle") {
  elements.commentsStatus.textContent = label;
  elements.commentsStatus.dataset.tone = tone;
}

function resetComments(stream) {
  elements.commentsTitle.textContent = stream ? `Komentar ${stream.memberName}` : "Komentar Live";
  elements.commentsFeed.innerHTML = "";
  elements.commentsEmpty.hidden = false;
}

function appendComment(author, text, avatarUrl = "") {
  if (!text) {
    return;
  }

  elements.commentsEmpty.hidden = true;

  const item = document.createElement("article");
  item.className = "comment-item";

  const meta = document.createElement("div");
  meta.className = "comment-meta";

  if (avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "comment-avatar";
    avatar.src = avatarUrl;
    avatar.alt = author || "Avatar";
    avatar.loading = "lazy";
    meta.append(avatar);
  }

  const authorEl = document.createElement("strong");
  authorEl.textContent = author || "Penonton";

  const textEl = document.createElement("p");
  textEl.textContent = text;

  meta.append(authorEl);
  item.append(meta, textEl);
  elements.commentsFeed.prepend(item);

  while (elements.commentsFeed.children.length > 80) {
    elements.commentsFeed.removeChild(elements.commentsFeed.lastElementChild);
  }
}

function decodeEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value ?? "";
  return textarea.value;
}

function normalizeCommentText(value) {
  if (typeof value === "string") {
    return decodeEntities(value);
  }

  if (value && typeof value === "object") {
    const candidates = [
      value.text,
      value.message,
      value.body,
      value.content,
      value.comment
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return decodeEntities(candidate);
      }
    }
  }

  return "";
}

async function connectShowroomComments(stream) {
  disconnectComments();
  resetComments(stream);
  activeCommentStreamId = stream.id;
  setCommentsStatus("Menghubungkan...", "idle");

  try {
    const { data } = await loadShowroomLiveInfo(stream.creatorId);
    const bcsvrKey = data?.bcsvr_key;

    if (!bcsvrKey) {
      throw new Error("bcsvr_key tidak tersedia");
    }

    const socket = new WebSocket("wss://online.showroom-live.com/");
    commentSocket = socket;

    const scheduleReconnect = () => {
      if (activeCommentStreamId !== stream.id || query.get("mode") === "multi") {
        return;
      }

      if (commentReconnectTimer) {
        clearTimeout(commentReconnectTimer);
      }

      setCommentsStatus("Menghubungkan ulang...", "warning");
      commentReconnectTimer = setTimeout(() => {
        connectShowroomComments(stream);
      }, 2000);
    };

    const connectTimeout = setTimeout(() => {
      if (commentSocket !== socket) {
        return;
      }

      setCommentsStatus("Komentar Showroom timeout", "warning");
      socket.close();
    }, 8000);

    socket.addEventListener("open", () => {
      if (commentSocket !== socket || activeCommentStreamId !== stream.id) {
        socket.close();
        return;
      }

      clearTimeout(connectTimeout);
      setCommentsStatus("Komentar live tersambung", "live");
      socket.send(`SUB\t${bcsvrKey}`);
      commentPingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("PING\tshowroom");
        }
      }, 30000);
    });

    socket.addEventListener("message", (event) => {
      const payload = String(event.data ?? "");
      if (!payload.includes("MSG")) {
        return;
      }

      const match = payload.match(/(\{.*\}|\[.*\])/);
      if (!match) {
        return;
      }

      try {
        const json = JSON.parse(match[0]);
        if (Number(json?.t) !== 1) {
          return;
        }

        appendComment(
          json.ac || json.n || json.ua || "Penonton",
          normalizeCommentText(json.cm || json.comment || json.msg || ""),
          json.av ? `https://static.showroom-live.com/image/avatar/${json.av}.png?v=97` : ""
        );
      } catch (error) {
        console.error(error);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(connectTimeout);
      if (commentSocket !== socket) {
        return;
      }
      setCommentsStatus("Komentar Showroom gagal tersambung", "warning");
    });

    socket.addEventListener("close", () => {
      clearTimeout(connectTimeout);
      if (commentPingInterval) {
        clearInterval(commentPingInterval);
        commentPingInterval = null;
      }

      if (commentSocket !== socket) {
        return;
      }

      commentSocket = null;
      scheduleReconnect();
    });
  } catch (error) {
    console.error(error);
    setCommentsStatus("Komentar Showroom belum tersedia", "warning");
  }
}

async function connectIdnComments(stream) {
  disconnectComments();
  resetComments(stream);
  activeCommentStreamId = stream.id;
  setCommentsStatus("Menghubungkan...", "idle");

  try {
    const chatRoomId = await loadIdnChatRoomId(stream.roomUrl);

    if (!chatRoomId) {
      throw new Error("chat_room_id tidak ditemukan");
    }

    const userId = crypto.randomUUID().split("-")[0];
    const sessionId = crypto.randomUUID();
    const socket = new WebSocket("wss://chat.idn.app/");
    commentSocket = socket;

    const scheduleReconnect = () => {
      if (activeCommentStreamId !== stream.id || query.get("mode") === "multi") {
        return;
      }

      if (commentReconnectTimer) {
        clearTimeout(commentReconnectTimer);
      }

      setCommentsStatus("Menghubungkan ulang...", "warning");
      commentReconnectTimer = setTimeout(() => {
        connectIdnComments(stream);
      }, 2000);
    };

    const connectTimeout = setTimeout(() => {
      if (commentSocket !== socket) {
        return;
      }

      setCommentsStatus("Komentar IDN timeout", "warning");
      socket.close();
    }, 8000);

    socket.addEventListener("open", () => {
      if (commentSocket !== socket || activeCommentStreamId !== stream.id) {
        socket.close();
        return;
      }

      clearTimeout(connectTimeout);
      setCommentsStatus("Komentar live tersambung", "live");
      socket.send("CAP LS 302");
      socket.send(`NICK idn-${userId}-${Date.now()}`);
      socket.send(`USER ${userId}_${sessionId} 0 * null`);
      socket.send("CAP REQ :account-notify account-tag away-notify batch cap-notify chghost echo-message extended-join invite-notify labeled-response message-tags multi-prefix server-time setname userhost-in-names");
      socket.send("CAP END");
    });

    socket.addEventListener("message", (event) => {
      const payload = String(event.data ?? "");

      if (payload.includes(":Welcome")) {
        socket.send(`@label=1 JOIN #${chatRoomId}`);
        return;
      }

      if (payload.includes("PING :")) {
        idnLastPingKey = payload.split("PING :").pop() ?? "";
        if (socket.readyState === WebSocket.OPEN && idnLastPingKey) {
          socket.send(`PONG ${idnLastPingKey}`);
        }
        return;
      }

      if (!payload.includes(`PRIVMSG #${chatRoomId} :`)) {
        return;
      }

      const rawJson = payload.split(`${chatRoomId} :`).pop();
      if (!rawJson) {
        return;
      }

      try {
        const json = JSON.parse(rawJson);
        if (!json?.chat) {
          return;
        }

        appendComment(
          json.user?.name || json.user?.username || "Penonton",
          normalizeCommentText(json.chat),
          json.user?.avatar_url || ""
        );
      } catch (error) {
        console.error(error);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(connectTimeout);
      if (commentSocket !== socket) {
        return;
      }
      setCommentsStatus("Komentar IDN gagal tersambung", "warning");
    });

    socket.addEventListener("close", () => {
      clearTimeout(connectTimeout);
      if (commentPingInterval) {
        clearInterval(commentPingInterval);
        commentPingInterval = null;
      }
      if (idnCommentHealthInterval) {
        clearInterval(idnCommentHealthInterval);
        idnCommentHealthInterval = null;
      }

      if (commentSocket !== socket) {
        return;
      }

      commentSocket = null;
      scheduleReconnect();
    });

    commentPingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN && idnLastPingKey) {
        socket.send(`PONG ${idnLastPingKey}`);
      }
    }, 30000);

    idnCommentHealthInterval = setInterval(() => {
      if (socket.readyState > WebSocket.OPEN) {
        scheduleReconnect();
      }
    }, 15000);
  } catch (error) {
    console.error(error);
    setCommentsStatus("Komentar IDN belum tersedia", "warning");
  }
}

function updateCommentsForStream(stream) {
  const isMultiMode = query.get("mode") === "multi";
  elements.commentsPanel.hidden = isMultiMode;

  if (isMultiMode || !stream) {
    disconnectComments();
    return;
  }

  if (stream.platformKey === "showroom") {
    connectShowroomComments(stream);
    return;
  }

  if (stream.platformKey === "idn") {
    connectIdnComments(stream);
    return;
  }

  disconnectComments();
  resetComments(stream);
  setCommentsStatus("Komentar belum tersedia untuk platform ini", "idle");
}

function attachStream(video, stream) {
  const url = stream?.playbackUrl;
  if (!url) {
    return { video };
  }

  const proxyChain = getPreferredProxyChain(stream);
  const shouldUseProxy = proxyChain.length > 0;

  if (window.Hls?.isSupported()) {
    const hls = new window.Hls({
      lowLatencyMode: true,
      enableWorker: true,
      loader: shouldUseProxy ? createProxyLoader(proxyChain) : window.Hls.DefaultConfig.loader
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return { video, hls };
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    if (shouldUseProxy) {
      video.src = `${proxyChain[0]}${encodeURIComponent(url)}`;
    } else {
      video.src = url;
    }
  }

  return { video };
}

function syncViewportToVideo(video, container) {
  if (!video || !container) {
    return;
  }

  const applyRatio = () => {
    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    container.style.setProperty("--media-ratio", `${video.videoWidth} / ${video.videoHeight}`);
    container.dataset.orientation = video.videoHeight > video.videoWidth ? "portrait" : "landscape";

    if (container === elements.mainPlayerFrame) {
      requestAnimationFrame(syncCommentsFeedHeight);
    }
  };

  video.addEventListener("loadedmetadata", applyRatio);
  video.addEventListener("resize", applyRatio);
  window.addEventListener("resize", () => {
    applyRotation(container, Number(container?.dataset.rotation || 0));

    if (container === elements.mainPlayerFrame) {
      requestAnimationFrame(syncCommentsFeedHeight);
    }
  });
  applyRatio();
  applyRotation(container, Number(container?.dataset.rotation || 0));
}

async function playWithPreferredAudio(video, { muted = false, volume = 1 } = {}) {
  if (!video) {
    return;
  }

  video.muted = muted;
  video.volume = volume;

  try {
    await video.play();
  } catch (error) {
    await video.play().catch(() => {});
  }
}

async function playPlayerWithFallback(player, { muted = false, volume = 1 } = {}) {
  if (!player) {
    return;
  }

  player.muted = muted;
  player.volume = volume;

  try {
    await player.play?.();
  } catch (error) {
    player.muted = true;
    await player.play?.().catch(() => {});
  }
}

async function startMultiViewPlayer(player, stream, { preferMutedAutoplay = false } = {}) {
  if (!player || !stream) {
    return;
  }

  player.muted = preferMutedAutoplay;
  player.volume = 1;
  player.src = {
    src: stream.playbackUrl,
    type: "application/x-mpegurl"
  };
  await playPlayerWithFallback(player, { muted: preferMutedAutoplay, volume: 1 }).catch(() => {});
}

async function setMainPlayer(stream) {
  destroyController(mainPlayerController);
  mainPlayerController = null;
  const isMultiMode = query.get("mode") === "multi";
  syncPageTitle();

  if (!stream) {
    elements.playerTitle.textContent = isMultiMode ? "Multi-view" : "Stream tidak ditemukan";
    elements.playerRoomLink.href = "#";
    elements.playerRoomLink.hidden = isMultiMode;
    stopMainPlayer();
    elements.playerMeta.innerHTML = isMultiMode
      ? '<span class="meta-pill">Pantau beberapa stream sekaligus</span>'
      : "";
    elements.commentsPanel.style.removeProperty("--comments-feed-max-height");
    updateCommentsForStream(null);
    return;
  }

  state.currentStreamId = stream.id;
  history.replaceState({}, "", withCurrentQuery("./watch.html", { id: stream.id }));

  if (isMultiMode) {
    elements.playerTitle.textContent = "Multi-view";
    elements.playerRoomLink.href = stream.roomUrl;
    elements.playerRoomLink.textContent = "Buka di platform";
    elements.playerRoomLink.hidden = true;
    elements.playerMeta.innerHTML = [
      `<span class="meta-pill">${state.multiViewIds.length || 1} stream aktif</span>`,
      `<span class="meta-pill">Mode pantau banyak live sekaligus</span>`
    ].join("");
  } else {
    elements.playerTitle.textContent = `${stream.memberName} - ${stream.platform}`;
    elements.playerRoomLink.href = stream.roomUrl;
    elements.playerRoomLink.textContent = "Buka di platform";
    elements.playerRoomLink.hidden = false;
    elements.playerMeta.innerHTML = [
      `<span class="meta-pill">${stream.title}</span>`,
      `<span class="meta-pill">${formatNumber(stream.viewers)} viewers</span>`,
      `<span class="meta-pill">Mulai ${formatAbsoluteDate(stream.startedAt)}</span>`
    ].join("");
  }

  recreateMainPlayerElement();
  setupMainVidstackPlayer();
  if (mainVidstackProvider) {
    applyProviderConfig(mainVidstackProvider, stream);
  }
  elements.mainPlayer.title = `${stream.memberName} - ${stream.platform}`;
  elements.mainPlayer.src = {
    src: stream.playbackUrl,
    type: "application/x-mpegurl"
  };
  elements.mainPlayer.muted = false;
  elements.mainPlayer.volume = 1;
  mainPlayerRotation = 0;
  const rotateTarget = getMainPlayerRotateTarget();
  rotateTarget.dataset.rotation = "0";
  rotateTarget.dataset.orientation = "";
  applyRotation(rotateTarget, 0);
  syncMainPlayerFullscreenState();
  syncMainPlayerViewport();
  await playPlayerWithFallback(elements.mainPlayer, { muted: false, volume: 1 }).catch(() => {});
  updateCommentsForStream(stream);
}

function renderRail() {
  elements.streamRail.innerHTML = "";
  const isMultiMode = query.get("mode") === "multi";

  for (const stream of state.streams) {
    const item = document.createElement("button");
    item.type = "button";
    const isActive = isMultiMode
      ? state.multiViewIds.includes(stream.id)
      : stream.id === state.currentStreamId;
    item.className = `rail-card${isActive ? " active" : ""}`;
    item.innerHTML = `
      <img src="${stream.thumbnail}" alt="${stream.memberName}" loading="lazy" />
      <div>
        <strong>${stream.memberName}</strong>
      </div>
    `;
    item.addEventListener("click", () => {
      if (isMultiMode) {
        toggleMultiView(stream.id);
        renderRail();
        return;
      }

      setMainPlayer(stream).catch((error) => console.error(error));
      renderRail();
    });
    elements.streamRail.append(item);
  }
}

function toggleMultiView(streamId) {
  const exists = state.multiViewIds.includes(streamId);

  if (exists) {
    state.multiViewIds = state.multiViewIds.filter((id) => id !== streamId);
  } else {
    state.multiViewIds = [...state.multiViewIds, streamId];
  }

  renderMultiView();
}

function moveMultiViewItem(index, direction) {
  const nextIndex = index + direction;

  if (
    index < 0 ||
    nextIndex < 0 ||
    index >= state.multiViewIds.length ||
    nextIndex >= state.multiViewIds.length
  ) {
    return;
  }

  const updated = [...state.multiViewIds];
  [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
  state.multiViewIds = updated;
  renderMultiView();
}

async function refreshMultiViewItem(streamId) {
  const controller = multiViewControllers.get(streamId);
  const stream = state.streams.find((item) => item.id === streamId);

  if (!controller || !stream) {
    return;
  }

  if (controller.player) {
    const rotationTarget = getMultiViewRotateTarget(multiViewSlots.get(streamId));
    const currentRotation = Number(rotationTarget?.dataset.rotation || 0);
    const refreshedUrl = appendRefreshToken(stream.playbackUrl);

    try {
      controller.player.pause?.();
    } catch (error) {
      console.error(error);
    }

    await waitForFrames(1);
    controller.player.src = {
      src: refreshedUrl,
      type: "application/x-mpegurl"
    };
    await playPlayerWithFallback(controller.player, { muted: false, volume: 1 }).catch(() => {});

    if (rotationTarget) {
      rotationTarget.dataset.rotation = String(currentRotation);
      applyRotation(rotationTarget, currentRotation);
    }

    syncMultiViewRotatedViewport(multiViewSlots.get(streamId));

    multiViewControllers.set(streamId, { player: controller.player });
    return;
  }

  destroyController(controller);

  if (!controller.video) {
    return;
  }

  controller.video.muted = false;
  controller.video.volume = 1;
  const nextController = attachStream(controller.video, stream);
  multiViewControllers.set(streamId, nextController);
  playWithPreferredAudio(controller.video, { muted: false, volume: 1 }).catch(() => {});
}

function updateMultiViewButtonState() {
  const slots = [...elements.multiviewGrid.querySelectorAll(".multiview-slot")];
  for (const slot of slots) {
    const streamId = slot.dataset.streamId;
    const index = state.multiViewIds.indexOf(streamId);
    const leftButton = slot.querySelector('[data-action="left"]');
    const rightButton = slot.querySelector('[data-action="right"]');

    if (leftButton) {
      leftButton.disabled = index <= 0;
    }

    if (rightButton) {
      rightButton.disabled = index === -1 || index >= state.multiViewIds.length - 1;
    }
  }
}

function updateMultiViewSlotButtons(streamId) {
  const slot = multiViewSlots.get(streamId);
  if (!slot) {
    return;
  }

  const index = state.multiViewIds.indexOf(streamId);
  const leftButton = slot.querySelector('[data-action="left"]');
  const rightButton = slot.querySelector('[data-action="right"]');

  if (leftButton) {
    leftButton.disabled = index <= 0;
  }

  if (rightButton) {
    rightButton.disabled = index === -1 || index >= state.multiViewIds.length - 1;
  }
}

function createMultiViewSlot(stream) {
  const slot = document.createElement("div");
  slot.className = "multiview-slot";
  slot.dataset.streamId = stream.id;

  const overlay = document.createElement("div");
  overlay.className = "slot-overlay";
  overlay.innerHTML = `
    <div>
      <strong>${stream.memberName}</strong>
      <span>${stream.platform}</span>
    </div>
    <div class="slot-actions">
      <button type="button" data-action="rotate">Rotate</button>
      <button type="button" data-action="refresh">Refresh</button>
      <button type="button" data-action="left">←</button>
      <button type="button" data-action="right">→</button>
      <button type="button" data-action="remove">Tutup</button>
    </div>
  `;
  slot.append(overlay);

  const stage = document.createElement("div");
  stage.className = "video-stage";
  const player = document.createElement("media-player");
  player.setAttribute("view-type", "video");
  player.setAttribute("stream-type", "live");
  player.setAttribute("playsinline", "");
  player.innerHTML = `
    <media-provider></media-provider>
    <media-video-layout></media-video-layout>
  `;
  stage.append(player);
  slot.append(stage);
  setupMultiViewVidstackPlayer(player, slot, stream);

  overlay.querySelector('[data-action="rotate"]').addEventListener("click", () => {
    const media = getPlayerMedia(player);
    rotateContainer(getMultiViewRotateTarget(slot), media);
    syncMultiViewRotatedViewport(slot);
  });
  overlay.querySelector('[data-action="refresh"]').addEventListener("click", () => {
    refreshMultiViewItem(stream.id);
  });
  overlay.querySelector('[data-action="left"]').addEventListener("click", () => {
    moveMultiViewItem(state.multiViewIds.indexOf(stream.id), -1);
  });
  overlay.querySelector('[data-action="right"]').addEventListener("click", () => {
    moveMultiViewItem(state.multiViewIds.indexOf(stream.id), 1);
  });
  overlay.querySelector('[data-action="remove"]').addEventListener("click", () => {
    toggleMultiView(stream.id);
      renderRail();
    });

  player.muted = false;
  player.volume = 1;
  player.src = {
    src: stream.playbackUrl,
    type: "application/x-mpegurl"
  };
  player.play?.().catch(() => {});
  multiViewControllers.set(stream.id, { player });
  multiViewSlots.set(stream.id, slot);
  getMultiViewRotateTarget(slot).dataset.rotation = "0";
  syncMultiViewRotatedViewport(slot);
  updateMultiViewSlotButtons(stream.id);

  return slot;
}

function renderMultiView() {
  const isMultiMode = query.get("mode") === "multi";
  syncPageTitle();
  elements.multiViewPanel.hidden = !isMultiMode;
  elements.primaryPlayerPanel.hidden = isMultiMode;
  elements.railPanel.hidden = isMultiMode;
  elements.watchLayout.classList.toggle("multi-mode", isMultiMode);
  elements.commentsPanel.hidden = isMultiMode;

  if (isMultiMode) {
    elements.playerTitle.textContent = "Multi-view";
    elements.playerRoomLink.hidden = true;
    destroyController(mainPlayerController);
    mainPlayerController = null;
    stopMainPlayer();
    elements.commentsPanel.style.removeProperty("--comments-feed-max-height");
    disconnectComments();
  }

  if (!isMultiMode) {
    for (const controller of multiViewControllers.values()) {
      destroyController(controller);
    }
    multiViewControllers.clear();
    multiViewSlots.clear();
    elements.multiviewGrid.innerHTML = "";
    return;
  }

  const selectedStreams = state.multiViewIds
    .map((id) => state.streams.find((stream) => stream.id === id))
    .filter(Boolean);

  elements.multiviewGrid.dataset.count = String(Math.max(selectedStreams.length, 1));
  elements.multiviewGrid.dataset.columns = String(Math.min(Math.max(selectedStreams.length, 1), 4));

  elements.playerMeta.innerHTML = [
    `<span class="meta-pill">${selectedStreams.length} stream aktif</span>`
  ].join("");

  selectedStreams.forEach((stream, index) => {
    const existingSlot = multiViewSlots.get(stream.id);

    if (existingSlot) {
      existingSlot.style.order = String(index);
      updateMultiViewSlotButtons(stream.id);
      return;
    }

    const slot = createMultiViewSlot(stream);
    slot.style.order = String(index);
    elements.multiviewGrid.append(slot);
    return;
    /*
    const slot = document.createElement("div");
    slot.className = "multiview-slot";
    slot.dataset.streamId = stream.id;

    const overlay = document.createElement("div");
    overlay.className = "slot-overlay";
    overlay.innerHTML = `
      <div>
        <strong>${stream.memberName}</strong>
        <span>${stream.platform}</span>
      </div>
      <div class="slot-actions">
        <button type="button" data-action="rotate">Rotate</button>
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="left" ${index === 0 ? "disabled" : ""}>←</button>
        <button type="button" data-action="right" ${index === selectedStreams.length - 1 ? "disabled" : ""}>→</button>
        <button type="button" data-action="remove">Tutup</button>
      </div>
    `;
    slot.append(overlay);

    const video = document.createElement("video");
    video.controls = true;
    video.muted = false;
    video.volume = 1;
    video.playsInline = true;
    const stage = document.createElement("div");
    stage.className = "video-stage";
    stage.append(video);
    slot.append(stage);
    syncViewportToVideo(video, slot);

    overlay.querySelector('[data-action="rotate"]').addEventListener("click", () => {
      rotateContainer(slot, video);
      refreshMultiViewItem(stream.id);
    });
    overlay.querySelector('[data-action="refresh"]').addEventListener("click", () => {
      refreshMultiViewItem(stream.id);
    });
    overlay.querySelector('[data-action="left"]').addEventListener("click", () => {
      moveMultiViewItem(state.multiViewIds.indexOf(stream.id), -1);
    });
    overlay.querySelector('[data-action="right"]').addEventListener("click", () => {
      moveMultiViewItem(state.multiViewIds.indexOf(stream.id), 1);
    });
    overlay.querySelector('[data-action="remove"]').addEventListener("click", () => {
      toggleMultiView(stream.id);
      renderRail();
    });
    elements.multiviewGrid.append(slot);

    const controller = attachStream(video, stream);
    multiViewControllers.set(stream.id, controller);
    playWithPreferredAudio(video, { muted: false, volume: 1 }).catch(() => {});
    multiViewSlots.set(stream.id, slot);
    */
  });

  for (const [streamId, controller] of multiViewControllers.entries()) {
    if (!state.multiViewIds.includes(streamId)) {
      destroyController(controller);
      multiViewControllers.delete(streamId);
      multiViewSlots.get(streamId)?.remove();
      multiViewSlots.delete(streamId);
    }
  }

  updateMultiViewButtonState();
}

async function loadPage() {
  try {
    elements.backHomeLink.href = withCurrentQuery("./index.html", { id: null, mode: null });
    const { payload, proxies } = await loadLivePayload();
    state.streams = payload.streams ?? [];
    state.proxies = proxies;
    const isMultiMode = query.get("mode") === "multi";
    const requestedStreamId = query.get("id");
    const requestedStream =
      state.streams.find((stream) => stream.id === requestedStreamId) ?? null;
    const current =
      (isMultiMode
        ? requestedStream
        : requestedStream ??
          state.streams.find((stream) => stream.id === state.currentStreamId) ??
          state.streams[0]) ??
      null;

    state.currentStreamId = current?.id ?? null;

    if (isMultiMode) {
      elements.railTitle.textContent = "Tambah atau atur stream";
      elements.multiViewPicker.append(elements.streamRail);
      state.multiViewIds = requestedStream ? [requestedStream.id] : [];
      renderRail();
      renderMultiView();
    } else {
      setMainPlayer(current).catch((error) => console.error(error));
      renderRail();
      elements.railTitle.textContent = "Pilih live member";
      elements.railPanel.append(elements.streamRail);
      elements.multiViewPanel.hidden = true;
      elements.primaryPlayerPanel.hidden = false;
      elements.commentsPanel.hidden = false;
      elements.railPanel.hidden = false;
    }
  } catch (error) {
    elements.playerTitle.textContent = "Gagal memuat stream";
    console.error(error);
  }
}

elements.clearMultiview.addEventListener("click", () => {
  for (const controller of multiViewControllers.values()) {
    destroyController(controller);
  }
  multiViewControllers.clear();
  multiViewSlots.clear();
  elements.multiviewGrid.innerHTML = "";
  state.multiViewIds = [];
  renderMultiView();
  renderRail();
  updateMultiViewButtonState();
});

elements.rotateMainPlayer.addEventListener("click", () => {
  if (isMainPlayerFullscreen()) {
    pendingRotateAfterFullscreen = true;
    document.exitFullscreen?.().catch(() => {
      pendingRotateAfterFullscreen = false;
    });
    return;
  }

  mainPlayerRotation = (mainPlayerRotation + 90) % 360;
  syncMainPlayerRotation();
});

loadPage();

import {
  createProxyLoader,
  formatAbsoluteDate,
  formatNumber,
  loadIdnChatRoomId,
  loadLivePayload,
  loadShowroomLiveInfo
} from "./shared.js?v=20260315ad";

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
let mainPlayerRotation = 0;
let commentSocket = null;
let commentPingInterval = null;
let commentReconnectTimer = null;
let activeCommentStreamId = null;
let idnCommentHealthInterval = null;
let idnLastPingKey = "";

function destroyController(controller) {
  if (!controller) {
    return;
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

function stopVideoElement(video) {
  if (!video) {
    return;
  }

  video.pause();
  video.removeAttribute("src");
  video.load();
}

function applyRotation(container, rotation) {
  if (!container) {
    return;
  }

  const normalized = ((rotation % 360) + 360) % 360;
  const isQuarterTurn = normalized === 90 || normalized === 270;
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  const scale = isQuarterTurn ? Math.min(width / height, height / width) : 1;

  container.style.setProperty("--video-rotation", `${normalized}deg`);
  container.style.setProperty("--video-scale", `${scale}`);
}

function rotateContainer(container) {
  const current = Number(container?.dataset.rotation || 0);
  const next = (current + 90) % 360;
  if (container) {
    container.dataset.rotation = String(next);
  }
  applyRotation(container, next);
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

  if (window.Hls?.isSupported()) {
    const isIdn = stream?.platformKey === "idn" && state.proxies.idn;
    const hls = new window.Hls({
      lowLatencyMode: true,
      enableWorker: true,
      loader: isIdn ? createProxyLoader(state.proxies.idn) : window.Hls.DefaultConfig.loader
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    return { video, hls };
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    if (stream?.platformKey === "idn" && state.proxies.idn) {
      video.src = `${state.proxies.idn}${encodeURIComponent(url)}`;
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
  };

  video.addEventListener("loadedmetadata", applyRatio);
  video.addEventListener("resize", applyRatio);
  window.addEventListener("resize", () => {
    applyRotation(container, Number(container?.dataset.rotation || 0));
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

function setMainPlayer(stream) {
  destroyController(mainPlayerController);
  const isMultiMode = query.get("mode") === "multi";

  if (!stream) {
    elements.playerTitle.textContent = isMultiMode ? "Multi-view" : "Stream tidak ditemukan";
    elements.playerRoomLink.href = "#";
    elements.playerRoomLink.hidden = isMultiMode;
    elements.playerMeta.innerHTML = isMultiMode
      ? '<span class="meta-pill">Pantau beberapa stream sekaligus</span>'
      : "";
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

  mainPlayerController = attachStream(elements.mainPlayer, stream);
  mainPlayerRotation = 0;
  elements.mainPlayerFrame.dataset.rotation = "0";
  applyRotation(elements.mainPlayerFrame, 0);
  syncViewportToVideo(elements.mainPlayer, elements.mainPlayerFrame);
  playWithPreferredAudio(elements.mainPlayer, { muted: false, volume: 1 }).catch(() => {});
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

      setMainPlayer(stream);
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

function refreshMultiViewItem(streamId) {
  const controller = multiViewControllers.get(streamId);
  const stream = state.streams.find((item) => item.id === streamId);

  if (!controller || !stream || !controller.video) {
    return;
  }

  destroyController(controller);
  const nextController = attachStream(controller.video, stream);
  multiViewControllers.set(streamId, nextController);
  controller.video.play().catch(() => {});
}

function renderMultiView() {
  const isMultiMode = query.get("mode") === "multi";
  elements.multiViewPanel.hidden = !isMultiMode;
  elements.primaryPlayerPanel.hidden = isMultiMode;
  elements.railPanel.hidden = isMultiMode;
  elements.watchLayout.classList.toggle("multi-mode", isMultiMode);
  elements.commentsPanel.hidden = isMultiMode;

  if (isMultiMode) {
    destroyController(mainPlayerController);
    mainPlayerController = null;
    stopVideoElement(elements.mainPlayer);
    disconnectComments();
  }

  for (const controller of multiViewControllers.values()) {
    destroyController(controller);
  }
  multiViewControllers.clear();
  elements.multiviewGrid.innerHTML = "";

  if (!isMultiMode) {
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

  for (let index = 0; index < selectedStreams.length; index += 1) {
    const stream = selectedStreams[index];
    const slot = document.createElement("div");
    slot.className = "multiview-slot";

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
    video.muted = true;
    video.volume = 0;
    video.playsInline = true;
    slot.append(video);
    syncViewportToVideo(video, slot);

    overlay.querySelector('[data-action="rotate"]').addEventListener("click", () => {
      rotateContainer(slot);
    });
    overlay.querySelector('[data-action="refresh"]').addEventListener("click", () => {
      refreshMultiViewItem(stream.id);
    });
    overlay.querySelector('[data-action="left"]').addEventListener("click", () => {
      moveMultiViewItem(index, -1);
    });
    overlay.querySelector('[data-action="right"]').addEventListener("click", () => {
      moveMultiViewItem(index, 1);
    });
    overlay.querySelector('[data-action="remove"]').addEventListener("click", () => {
      toggleMultiView(stream.id);
      renderRail();
    });
    elements.multiviewGrid.append(slot);

    const controller = attachStream(video, stream);
    multiViewControllers.set(stream.id, controller);
    playWithPreferredAudio(video, { muted: true, volume: 0 }).catch(() => {});
  }
}

async function loadPage() {
  try {
    elements.backHomeLink.href = withCurrentQuery("./index.html", { id: null, mode: null });
    const { payload, proxies } = await loadLivePayload();
    state.streams = payload.streams ?? [];
    state.proxies = proxies;

    const current =
      state.streams.find((stream) => stream.id === state.currentStreamId) ?? state.streams[0] ?? null;

    setMainPlayer(current);
    renderRail();

    if (query.get("mode") === "multi") {
      elements.railTitle.textContent = "Tambah atau atur stream";
      elements.multiViewPicker.append(elements.streamRail);
      state.multiViewIds = current ? [current.id] : [];
      renderRail();
      renderMultiView();
    } else {
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
  elements.multiviewGrid.innerHTML = "";
  state.multiViewIds = [];
  renderMultiView();
  renderRail();
});

elements.rotateMainPlayer.addEventListener("click", () => {
  mainPlayerRotation = (mainPlayerRotation + 90) % 360;
  elements.mainPlayerFrame.dataset.rotation = String(mainPlayerRotation);
  applyRotation(elements.mainPlayerFrame, mainPlayerRotation);
});

loadPage();

import { formatNumber, formatRelativeDate, loadLivePayload } from "./shared.js?v=20260316m";

const query = new URLSearchParams(window.location.search);

const elements = {
  totalLive: document.querySelector("#total-live"),
  totalShowroom: document.querySelector("#total-showroom"),
  totalIdn: document.querySelector("#total-idn"),
  liveGrid: document.querySelector("#live-grid"),
  debugNote: document.querySelector("#debug-note"),
  emptyState: document.querySelector("#empty-state"),
  refreshData: document.querySelector("#refresh-data"),
  refreshLabel: document.querySelector("#refresh-data span"),
  filterButtons: [...document.querySelectorAll("#platform-filter [data-filter]")]
};

const state = {
  payload: null,
  activeFilter: "all"
};

function withCurrentQuery(path, extraParams = {}) {
  const params = new URLSearchParams(query);
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

function renderLoadingState() {
  elements.liveGrid.innerHTML = "";
  elements.emptyState.hidden = true;
  elements.liveGrid.dataset.loading = "true";

  for (let index = 0; index < 6; index += 1) {
    const card = document.createElement("article");
    card.className = "live-card live-card-skeleton";
    card.innerHTML = `
      <div class="skeleton skeleton-thumb"></div>
      <div>
        <div class="skeleton skeleton-line skeleton-title"></div>
        <div class="skeleton skeleton-line"></div>
        <div class="live-badges">
          <span class="skeleton skeleton-pill"></span>
          <span class="skeleton skeleton-pill"></span>
          <span class="skeleton skeleton-pill"></span>
        </div>
      </div>
    `;
    elements.liveGrid.append(card);
  }
}

function renderStats(payload) {
  elements.totalLive.textContent = formatNumber(payload.counts?.total ?? 0);
  elements.totalShowroom.textContent = formatNumber(payload.counts?.showroom ?? 0);
  elements.totalIdn.textContent = formatNumber(payload.counts?.idn ?? 0);
}

function renderDebug(debug) {
  if (!debug || !debug.testMode) {
    elements.debugNote.hidden = true;
    elements.debugNote.textContent = "";
    return;
  }

  elements.debugNote.hidden = false;
  elements.debugNote.textContent =
    `Test mode aktif. Showroom raw: ${debug.showroom.rawCount}, tampil: ${debug.showroom.normalizedCount}, status: ${debug.showroom.status}. ` +
    `IDN raw: ${debug.idn.rawCount}, tampil: ${debug.idn.normalizedCount}, status: ${debug.idn.status}.`;
}

function renderDebugError(error) {
  elements.debugNote.hidden = false;
  elements.debugNote.textContent = `Load gagal: ${error?.message || "Unknown error"}`;
}

function getFilteredStreams(streams) {
  if (state.activeFilter === "all") {
    return streams;
  }

  return streams.filter((stream) => stream.platformKey === state.activeFilter);
}

function renderFilterState() {
  for (const button of elements.filterButtons) {
    button.classList.toggle("active", button.dataset.filter === state.activeFilter);
  }
}

function renderLiveGrid(streams) {
  delete elements.liveGrid.dataset.loading;
  elements.liveGrid.innerHTML = "";
  elements.emptyState.hidden = streams.length > 0;

  for (const stream of streams) {
    const card = document.createElement("article");
    card.className = "live-card";
    const watchUrl = withCurrentQuery("./watch.html", { id: stream.id, mode: null });
    const multiWatchUrl = withCurrentQuery("./watch.html", { id: stream.id, mode: "multi" });

    card.innerHTML = `
      <img src="${stream.thumbnail}" alt="${stream.memberName}" loading="lazy" />
      <div>
        <h3>${stream.memberName}</h3>
        <p>${stream.title}</p>
        <div class="live-badges">
          <span class="badge">${stream.platform}</span>
          <span class="badge">${formatNumber(stream.viewers)} viewers</span>
          <span class="badge">${formatRelativeDate(stream.startedAt)}</span>
        </div>
        <div class="live-actions">
          <a href="${watchUrl}">Tonton sekarang</a>
          <a href="${multiWatchUrl}">Buka multi-view</a>
          <a href="${stream.roomUrl}" target="_blank" rel="noreferrer">Open platform</a>
        </div>
      </div>
    `;

    elements.liveGrid.append(card);
  }
}

function renderFromState() {
  if (!state.payload) {
    return;
  }

  renderStats(state.payload);
  renderLiveGrid(getFilteredStreams(state.payload.streams ?? []));
}

async function loadData() {
  elements.refreshData.disabled = true;
  elements.refreshData.classList.add("is-loading");
  elements.refreshLabel.textContent = "Refreshing...";
  renderLoadingState();

  try {
    const { payload, debug } = await loadLivePayload();
    state.payload = payload;
    renderDebug(debug);
    renderFromState();
  } catch (error) {
    delete elements.liveGrid.dataset.loading;
    elements.liveGrid.innerHTML = "";
    renderDebugError(error);
    elements.emptyState.hidden = false;
    elements.emptyState.innerHTML =
      "<p>Data live belum bisa dimuat. Bisa jadi semua proxy lagi limit atau mati sementara.</p>";
    console.error(error);
  } finally {
    elements.refreshData.disabled = false;
    elements.refreshData.classList.remove("is-loading");
    elements.refreshLabel.textContent = "Refresh data";
  }
}

elements.refreshData.addEventListener("click", () => {
  loadData();
});

for (const button of elements.filterButtons) {
  button.addEventListener("click", () => {
    state.activeFilter = button.dataset.filter;
    renderFilterState();
    renderFromState();
  });
}

renderFilterState();
loadData();

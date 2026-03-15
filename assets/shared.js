export const CORS_PROXIES = [
  "https://cors.luckydesigner.workers.dev/?",
  "https://cors-prod.spotifie.workers.dev/?",
  "https://lingering-poetry-44bc.seniorious.workers.dev/?",
  "https://jolly-silence-2d9d.mundi-xu.workers.dev/?",
  "https://cors-anywhere.deqing.workers.dev/?",
  "https://bread.bid-multipliers.workers.dev/?",
  "https://cors.bsmijatim.workers.dev/?",
  "https://zy01.pearlchocolate.workers.dev/?",
  "https://elsaify-proxy.ignitionsoftware.workers.dev/?",
  "https://worker-silent-lab-53fb.jsmond2016.workers.dev/?",
  "https://cors.azherebtsov.workers.dev/?",
  "https://corsp.suisuy.workers.dev/?",
  "https://proxy.jeffe.workers.dev/?",
  "https://proxy.jeoungh-nah.workers.dev/"
];

const SHOWROOM_URL = "https://www.showroom-live.com/api/live/onlives";
const IDN_V4_URL = "https://api.idn.app/api/v4/livestreams?category=all&page=1";
const IDN_GQL_URL = "https://api.idn.app/graphql";
const MEMBER_DIRECTORY_URL = "./assets/members.json";
const IDN_GQL_BODY = {
  query:
    'query SearchLivestream { searchLivestream(query: "", limit: 500) { next_cursor result { slug title image_url view_count playback_url room_identifier status live_at end_at scheduled_at gift_icon_url category { name slug } creator { uuid username name avatar bio_description following_count follower_count is_follow } } }}'
};

export function isTestMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("test") === "true";
}

function getIdnApiPreference() {
  const params = new URLSearchParams(window.location.search);
  return params.get("idnapi") === "v4" ? "v4" : "graphql";
}

function getIdnV4Headers() {
  const runtimeHeaders = window.__JKT48LIVE_IDN_HEADERS__;
  if (runtimeHeaders && typeof runtimeHeaders === "object") {
    return runtimeHeaders;
  }

  try {
    const rawHeaders = window.localStorage?.getItem("jkt48live.idnHeaders");
    if (!rawHeaders) {
      return null;
    }

    const parsedHeaders = JSON.parse(rawHeaders);
    return parsedHeaders && typeof parsedHeaders === "object" ? parsedHeaders : null;
  } catch {
    return null;
  }
}

export function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(value ?? 0);
}

export function formatRelativeDate(value) {
  if (!value) {
    return "Waktu mulai belum tersedia";
  }

  return new Intl.RelativeTimeFormat("id", { numeric: "auto" }).format(
    Math.round((new Date(value).getTime() - Date.now()) / 60000),
    "minute"
  );
}

export function formatAbsoluteDate(value) {
  if (!value) {
    return "Tidak diketahui";
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatName(value) {
  return (value ?? "")
    .replace(/\s*JKT48$/i, "")
    .replace(/\s*\/.*$/, "")
    .replace(/\s+\(JKT48\)$/i, "")
    .trim();
}

function slugify(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    const timestamp = value > 1e12 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const raw = String(value).trim();
  const numericValue = Number(raw);
  if (raw && !Number.isNaN(numericValue)) {
    const timestamp = numericValue > 1e12 ? numericValue : numericValue * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchJsonWithProxy(url, init = {}) {
  let lastError = null;

  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(`${proxy}${encodeURIComponent(url)}`, {
        ...init,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        data: await response.json(),
        proxy
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

export async function fetchTextWithProxy(url, init = {}) {
  let lastError = null;

  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(`${proxy}${encodeURIComponent(url)}`, {
        ...init,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        data: await response.text(),
        proxy
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function loadMemberDirectory() {
  const response = await fetch(`${MEMBER_DIRECTORY_URL}?ts=${Date.now()}`, { cache: "no-store" });
  const data = await response.json();
  const members = data?.members ?? [];

  return {
    members,
    idnIds: new Set(members.map((member) => member.media_idn_id).filter(Boolean)),
    showroomKeys: new Set(members.map((member) => member.media_showroom).filter(Boolean)),
    showroomIds: new Set(members.map((member) => String(member.media_showroom_id)).filter(Boolean))
  };
}

function normalizeShowroomLives(payload, memberDirectory) {
  const onlives = payload?.onlives ?? [];
  const lives = onlives.flatMap((group) => group.lives ?? []);
  const uniqueLives = new Map();

  for (const item of lives) {
    const key = String(item?.room_id ?? item?.room_url_key ?? item?.live_id ?? "");
    if (!key || uniqueLives.has(key)) {
      continue;
    }
    uniqueLives.set(key, item);
  }

  return [...uniqueLives.values()]
    .filter((item) => {
      if (isTestMode()) {
        return true;
      }

      const roomId = String(item?.room_id ?? "");
      const roomKey = item?.room_url_key ?? "";

      return memberDirectory.showroomIds.has(roomId) || memberDirectory.showroomKeys.has(roomKey);
    })
    .map((item) => {
    const memberName = formatName(item.main_name || "Unknown");
    const stream =
      (item.streaming_url_list ?? []).find((entry) => entry.type === "hls") ??
      (item.streaming_url_list ?? [])[0] ??
      {};

    return {
      id: `showroom:${item.room_id ?? item.room_url_key}`,
      platform: "Showroom",
      platformKey: "showroom",
      memberName,
      slug: slugify(memberName),
      title: item.genre_name ? `Showroom · ${item.genre_name}` : "Showroom Live",
      startedAt: toIsoDate(item.started_at),
      viewers: item.view_num ?? 0,
      thumbnail: item.image_square ?? item.image ?? "",
      avatar: item.image_square ?? item.image ?? "",
      playbackUrl: stream.url ?? "",
      roomUrl: item.room_url_key ? `https://www.showroom-live.com/r/${item.room_url_key}` : "https://www.showroom-live.com/",
      roomKey: item.room_url_key ?? "",
      creatorId: String(item.room_id ?? ""),
      creatorUsername: item.room_url_key ?? "",
      sourceLabel: `${formatNumber(item.follower_num ?? 0)} followers`
    };
  });
}

function countRawShowroomLives(payload) {
  const onlives = payload?.onlives ?? [];
  const lives = onlives.flatMap((group) => group.lives ?? []);
  return lives.length;
}

function getIdnItems(payload) {
  const sources = [
    payload?.data?.searchLivestream?.result,
    payload?.data?.livestreams,
    payload?.data?.data,
    payload?.data,
    payload?.livestreams,
    payload?.result
  ];

  for (const source of sources) {
    if (Array.isArray(source)) {
      return source;
    }
  }

  return [];
}

function countRawIdnLives(payload) {
  const items = getIdnItems(payload);
  return items.filter(isActiveIdnLive).length;
}

function dedupeStreams(streams) {
  const uniqueStreams = new Map();

  for (const stream of streams) {
    const keys = [
      `${stream.platformKey}:${stream.creatorId}`,
      `${stream.platformKey}:${stream.roomKey}`,
      `${stream.platformKey}:${stream.playbackUrl}`,
      `${stream.platformKey}:${stream.memberName.toLowerCase()}`
    ]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value && !value.endsWith(":"));

    const existingKey = keys.find((key) => uniqueStreams.has(key));
    const primaryKey = keys[0] ?? `${stream.platformKey}:${stream.id}`;

    if (existingKey) {
      const current = uniqueStreams.get(existingKey);
      const keepNext =
        (stream.viewers ?? 0) > (current.viewers ?? 0) ||
        new Date(stream.startedAt ?? 0).getTime() > new Date(current.startedAt ?? 0).getTime();

      if (keepNext) {
        for (const key of keys) {
          uniqueStreams.set(key, stream);
        }
      } else {
        for (const key of keys) {
          if (!uniqueStreams.has(key)) {
            uniqueStreams.set(key, current);
          }
        }
      }
      continue;
    }

    for (const key of keys.length ? keys : [primaryKey]) {
      uniqueStreams.set(key, stream);
    }
  }

  return [...new Set(uniqueStreams.values())];
}

function normalizeIdnLives(payload, memberDirectory) {
  const items = getIdnItems(payload);

  return items
    .filter((item) => {
      if (!isActiveIdnLive(item)) {
        return false;
      }

      if (isTestMode()) {
        return true;
      }

      const creatorId =
        item?.creator?.uuid ??
        item?.creator?.id ??
        item?.user?.uuid ??
        item?.user?.id ??
        item?.host?.uuid ??
        item?.host?.id ??
        item?.creator_uuid;

      return memberDirectory.idnIds.has(creatorId);
    })
    .map(normalizeIdnItem)
    .filter((item) => item.playbackUrl);
}

function isActiveIdnLive(item) {
  const playbackUrl =
    item?.playback_url ??
    item?.playbackUrl ??
    item?.stream_url ??
    item?.streamUrl ??
    item?.hls_url ??
    item?.hlsUrl ??
    item?.playback?.url;

  if (!playbackUrl) {
    return false;
  }

  const status = String(item?.status ?? "").trim().toLowerCase();
  if (status === "end" || status === "ended" || status === "offline") {
    return false;
  }

  if (status === "live") {
    return true;
  }

  if (item?.end_at) {
    return false;
  }

  return Boolean(item?.live_at || item?.room_identifier || item?.slug || item?.id);
}

function normalizeIdnItem(item) {
  const creator = item?.creator ?? item?.user ?? item?.host ?? {};
  const playbackUrl =
    item?.playback_url ??
    item?.playbackUrl ??
    item?.stream_url ??
    item?.streamUrl ??
    item?.hls_url ??
    item?.hlsUrl ??
    item?.playback?.url ??
    "";
  const roomKey = item?.room_identifier ?? item?.roomIdentifier ?? item?.slug ?? item?.id ?? "";
  const username = creator?.username ?? creator?.user_name ?? item?.username ?? "";
  const slug = item?.slug ?? roomKey;
  const roomUrl =
    slug && username
      ? `https://www.idn.app/${username}/live/${slug}`
      : slug
        ? `https://www.idn.app/live/${slug}`
        : "https://www.idn.app/live";

  return {
    id: `idn:${roomKey}`,
    platform: "IDN Live",
    platformKey: "idn",
    memberName: formatName(creator?.name ?? creator?.display_name ?? item?.creator_name ?? "Unknown"),
    slug: slugify(formatName(creator?.name ?? creator?.display_name ?? item?.creator_name ?? "Unknown")),
    title: item?.title?.trim?.() || item?.name?.trim?.() || "Live sekarang",
    startedAt: toIsoDate(item?.live_at ?? item?.started_at ?? item?.startedAt),
    viewers: item?.view_count ?? item?.views ?? item?.viewer_count ?? 0,
    thumbnail: item?.image_url ?? item?.thumbnail_url ?? item?.cover ?? creator?.avatar ?? creator?.avatar_url ?? "",
    avatar: creator?.avatar ?? creator?.avatar_url ?? item?.avatar ?? "",
    playbackUrl,
    roomUrl,
    roomKey,
    creatorId: creator?.uuid ?? creator?.id ?? item?.creator_uuid ?? "",
    creatorUsername: username,
    sourceLabel: item?.category?.name ?? item?.category_name ?? "Idol"
  };
}

async function loadIdnLives() {
  const preferredSource = getIdnApiPreference();
  const v4Headers = getIdnV4Headers();

  if (preferredSource === "v4" && v4Headers) {
    try {
      const result = await fetchJsonWithProxy(IDN_V4_URL, {
        headers: {
          ...v4Headers
        }
      });

      return {
        ...result,
        source: "v4"
      };
    } catch {
      // Fall back to GraphQL below when runtime v4 headers fail or expire.
    }
  }

  const result = await fetchJsonWithProxy(IDN_GQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(IDN_GQL_BODY)
  });

  return {
    ...result,
    source: "graphql"
  };
}

function buildPayload(streams) {
  const sorted = dedupeStreams(streams).sort((left, right) => {
    const viewerGap = (right.viewers ?? 0) - (left.viewers ?? 0);
    if (viewerGap !== 0) {
      return viewerGap;
    }

    return new Date(right.startedAt ?? 0).getTime() - new Date(left.startedAt ?? 0).getTime();
  });

  return {
    updatedAt: new Date().toISOString(),
    counts: {
      total: sorted.length,
      idn: sorted.filter((item) => item.platformKey === "idn").length,
      showroom: sorted.filter((item) => item.platformKey === "showroom").length
    },
    streams: sorted
  };
}

export async function loadLivePayload() {
  const memberDirectory = await loadMemberDirectory();
  const [showroomResult, idnResult] = await Promise.allSettled([
    fetchJsonWithProxy(SHOWROOM_URL),
    loadIdnLives()
  ]);

  const showroomStreams =
    showroomResult.status === "fulfilled"
      ? normalizeShowroomLives(showroomResult.value.data, memberDirectory)
      : [];
  const idnStreams =
    idnResult.status === "fulfilled" ? normalizeIdnLives(idnResult.value.data, memberDirectory) : [];

  return {
    payload: buildPayload([...showroomStreams, ...idnStreams]),
    proxies: {
      showroom: showroomResult.status === "fulfilled" ? showroomResult.value.proxy : null,
      idn: idnResult.status === "fulfilled" ? idnResult.value.proxy : null
    },
    debug: {
      filterEnabled: !isTestMode(),
      testMode: isTestMode(),
      showroom: {
        status: showroomResult.status,
        rawCount:
          showroomResult.status === "fulfilled"
            ? countRawShowroomLives(showroomResult.value.data)
            : 0,
        normalizedCount: showroomStreams.length
      },
      idn: {
        status: idnResult.status,
        rawCount: idnResult.status === "fulfilled" ? countRawIdnLives(idnResult.value.data) : 0,
        normalizedCount: idnStreams.length,
        source: idnResult.status === "fulfilled" ? idnResult.value.source : null
      }
    }
  };
}

export async function loadShowroomLiveInfo(roomId) {
  const roomKey = encodeURIComponent(roomId);
  return fetchJsonWithProxy(`https://www.showroom-live.com/api/live/live_info?room_id=${roomKey}&_=${Date.now()}`);
}

export async function loadIdnChatRoomId(roomUrl) {
  const { data } = await fetchTextWithProxy(roomUrl);
  const matchers = [
    /"chat_room_id"\s*:\s*"([^"]+)"/i,
    /"chatRoomId"\s*:\s*"([^"]+)"/i,
    /chat_room_id['"]?\s*[:=]\s*['"]([^'"]+)['"]/i,
    /chatRoomId['"]?\s*[:=]\s*['"]([^'"]+)['"]/i
  ];

  for (const matcher of matchers) {
    const match = data.match(matcher);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function getProxyChain(preferredProxy = null) {
  const chain = preferredProxy ? [preferredProxy, ...CORS_PROXIES] : [...CORS_PROXIES];
  return [...new Set(chain.filter(Boolean))];
}

export function createProxyLoader(proxyUrls) {
  const BaseLoader = window.Hls.DefaultConfig.loader;
  const proxies = Array.isArray(proxyUrls) ? proxyUrls.filter(Boolean) : [proxyUrls].filter(Boolean);

  return class ProxyLoader extends BaseLoader {
    constructor(config) {
      super(config);
      this.config = config;
      this.activeLoader = null;
      this.activeProxyIndex = 0;
      this.context = null;
      this.callbacks = null;
      this.loaderConfig = null;
      this.loaderCallbacks = null;
    }

    load(context, config, callbacks) {
      this.context = context;
      this.loaderConfig = config;
      this.callbacks = callbacks;
      this.activeProxyIndex = 0;
      this.loadWithProxy(this.activeProxyIndex);
    }

    loadWithProxy(proxyIndex) {
      const proxyUrl = proxies[proxyIndex];
      if (!proxyUrl) {
        this.callbacks?.onError?.(
          { code: 0, text: "All proxies failed" },
          this.context,
          null,
          this.loaderCallbacks
        );
        return;
      }

      this.activeProxyIndex = proxyIndex;
      this.activeLoader = new BaseLoader(this.config);

      const nextContext = {
        ...this.context,
        url: `${proxyUrl}${encodeURIComponent(this.context.url)}`
      };

      const wrappedCallbacks = {
        ...this.callbacks,
        onError: (error, context, networkDetails, internalCallbacks) => {
          if (proxyIndex < proxies.length - 1) {
            this.activeLoader?.destroy?.();
            this.loadWithProxy(proxyIndex + 1);
            return;
          }

          this.callbacks?.onError?.(error, context, networkDetails, internalCallbacks);
        },
        onTimeout: (stats, context, networkDetails, internalCallbacks) => {
          if (proxyIndex < proxies.length - 1) {
            this.activeLoader?.destroy?.();
            this.loadWithProxy(proxyIndex + 1);
            return;
          }

          this.callbacks?.onTimeout?.(stats, context, networkDetails, internalCallbacks);
        }
      };

      this.loaderCallbacks = wrappedCallbacks;
      this.activeLoader.load(nextContext, this.loaderConfig, wrappedCallbacks);
    }

    abort() {
      this.activeLoader?.abort?.();
    }

    destroy() {
      this.activeLoader?.destroy?.();
      this.activeLoader = null;
    }
  };
}

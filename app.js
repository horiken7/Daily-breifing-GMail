const CONFIG = window.DAILY_BRIEFING_CONFIG || {};
const DEFAULT_LOCATION = CONFIG.DEFAULT_LOCATION || {
  label: "北九州市八幡西区 目安",
  latitude: 33.861,
  longitude: 130.745
};

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly"
].join(" ");

const state = {
  weather: null,
  place: DEFAULT_LOCATION.label,
  events: [],
  mails: [],
  token: sessionStorage.getItem("dailyBriefingGoogleToken") || "",
  tokenClient: null,
  googleReady: false
};

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
  renderToday();
  bindButtons();
  updateStatus("🌤️ 天気を取得しています...");
  loadWeather(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.label);
  renderGoogleDisconnected();
  initGoogleWhenReady();
});

function bindButtons() {
  $("refreshBtn")?.addEventListener("click", refreshAll);
  $("locationBtn")?.addEventListener("click", requestLocationWeather);
  $("googleBtn")?.addEventListener("click", connectGoogle);
}

async function refreshAll() {
  renderToday();
  updateStatus("🔄 最新情報に更新中...");
  await loadWeather(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.label);
  if (state.token) await loadGoogleData();
  renderAll();
  updateStatus("✅ 最新情報に更新しました");
}

function renderToday() {
  const now = new Date();
  $("todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeStyle: "short"
  }).format(now) + " 現在";
}

function updateStatus(message) {
  $("statusLine").textContent = message;
}

function isGoogleClientConfigured() {
  const clientId = CONFIG.GOOGLE_CLIENT_ID || "";
  return Boolean(clientId && !clientId.includes("YOUR_GOOGLE_CLIENT_ID"));
}

function initGoogleWhenReady(retry = 0) {
  if (!isGoogleClientConfigured()) {
    $("googleBtn").textContent = "🔐 Google連携（ID設定待ち）";
    updateStatus("⚠️ Google連携には config.js の GOOGLE_CLIENT_ID 設定が必要です。天気機能は利用できます。");
    return;
  }

  if (!window.google?.accounts?.oauth2) {
    if (retry < 50) setTimeout(() => initGoogleWhenReady(retry + 1), 120);
    else updateStatus("⚠️ Google認証ライブラリの読み込みに失敗しました。ページを再読み込みしてください。");
    return;
  }

  state.googleReady = true;
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response?.error) {
        updateStatus(`⚠️ Google連携エラー: ${response.error}`);
        return;
      }
      if (!response?.access_token) {
        updateStatus("⚠️ Google連携が完了しませんでした。もう一度お試しください。");
        return;
      }
      state.token = response.access_token;
      sessionStorage.setItem("dailyBriefingGoogleToken", state.token);
      $("googleBtn").textContent = "✅ Google連携済み";
      updateStatus("📅📩 Googleから今日の予定とメールを取得中...");
      await loadGoogleData();
      renderAll();
      updateStatus("✅ Google連携データを表示しました");
    }
  });

  $("googleBtn").textContent = state.token ? "✅ Google連携済み" : "🔐 Google連携";
  if (state.token) loadGoogleData().then(renderAll).catch(handleGoogleError);
}

function connectGoogle() {
  if (!isGoogleClientConfigured()) {
    updateStatus("⚠️ 先に config.js に Google OAuth クライアントIDを設定してください。");
    renderGoogleSetupGuide();
    return;
  }
  if (!state.googleReady || !state.tokenClient) {
    updateStatus("⏳ Google認証を準備中です。数秒後にもう一度押してください。");
    return;
  }
  state.tokenClient.requestAccessToken({ prompt: state.token ? "" : "consent" });
}

async function loadGoogleData() {
  if (!state.token) return;
  const [events, mails] = await Promise.all([
    loadTodayCalendarEvents(),
    loadImportantMails()
  ]);
  state.events = events;
  state.mails = mails;
  renderCalendar();
  renderMails();
}

async function googleFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (res.status === 401) {
    sessionStorage.removeItem("dailyBriefingGoogleToken");
    state.token = "";
    throw new Error("TOKEN_EXPIRED");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Google API error ${res.status}`);
  }
  return res.json();
}

async function loadTodayCalendarEvents() {
  const { start, end } = getTodayRange();
  const calendars = await loadVisibleCalendars();

  const eventLists = await Promise.all(calendars.map(async (calendar) => {
    const params = new URLSearchParams({
      timeMin: start,
      timeMax: end,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "30",
      timeZone: "Asia/Tokyo"
    });
    const calendarId = encodeURIComponent(calendar.id);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`;
    try {
      const data = await googleFetch(url);
      return (data.items || []).map((event) => normalizeEvent(event, calendar));
    } catch (error) {
      console.warn(`カレンダー取得をスキップしました: ${calendar.summary}`, error);
      return [];
    }
  }));

  return eventLists
    .flat()
    .filter((event) => event.status !== "cancelled")
    .sort((a, b) => new Date(a.start || a.dateSort) - new Date(b.start || b.dateSort));
}

async function loadVisibleCalendars() {
  const params = new URLSearchParams({
    minAccessRole: "reader",
    showHidden: "false"
  });
  const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`;
  const data = await googleFetch(url);
  const calendars = (data.items || [])
    .filter((calendar) => calendar.id && !calendar.hidden && calendar.selected !== false)
    .filter((calendar) => calendar.accessRole !== "freeBusyReader");

  return calendars.length ? calendars : [{ id: "primary", summary: "メイン" }];
}

function normalizeEvent(event, calendar = {}) {
  const startRaw = event.start?.dateTime || event.start?.date;
  const endRaw = event.end?.dateTime || event.end?.date;
  const allDay = Boolean(event.start?.date);
  return {
    title: event.summary || "予定あり",
    location: event.location || "",
    description: event.description || "",
    start: startRaw,
    end: endRaw,
    dateSort: startRaw,
    allDay,
    status: event.status || "confirmed",
    calendarName: calendar.summary || "カレンダー",
    icon: eventIcon(`${event.summary || ""} ${calendar.summary || ""}`)
  };
}

async function loadImportantMails() {
  const query = "newer_than:7d";
  const params = new URLSearchParams({
    q: query,
    maxResults: "30",
    includeSpamTrash: "false"
  });
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`;
  const list = await googleFetch(listUrl);
  const messages = list.messages || [];
  if (!messages.length) return [];

  const details = await Promise.all(messages.slice(0, 15).map(async (msg) => {
    const params = new URLSearchParams({ format: "full" });
    const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?${params}`;
    const detail = await googleFetch(detailUrl);
    return normalizeMail(detail);
  }));

  const scored = details
    .map(scoreMail)
    .sort((a, b) => b.score - a.score);
  const important = scored
    .filter((mail) => mail.score >= 22 && mail.level !== "low")
    .slice(0, 5);

  if (important.length) return important;

  return scored.slice(0, 5).map((mail) => ({
    ...mail,
    level: "low",
    badge: "🟢 通常",
    type: mail.type === "📩 確認" ? "📩 直近メール" : mail.type,
    summary: mail.summary || mail.snippet || "本文の要約はありません。"
  }));
}

function normalizeMail(message) {
  const headers = message.payload?.headers || [];
  const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  const body = cleanMailText(extractMailBody(message.payload));
  const summary = summarizeMailBody(body || message.snippet || "");
  return {
    id: message.id,
    subject: getHeader("Subject") || "件名なし",
    from: getHeader("From") || "差出人不明",
    date: getHeader("Date") || "",
    snippet: message.snippet || "",
    body,
    summary,
    labels: message.labelIds || []
  };
}

function extractMailBody(payload) {
  if (!payload) return "";
  const plainParts = [];
  const htmlParts = [];

  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || "";
    const data = part.body?.data;
    if (data) {
      if (mimeType.includes("text/plain")) plainParts.push(decodeBase64Url(data));
      else if (mimeType.includes("text/html")) htmlParts.push(stripHtml(decodeBase64Url(data)));
    }
    (part.parts || []).forEach(walk);
  }

  walk(payload);
  return plainParts.join("\n") || htmlParts.join("\n") || "";
}

function decodeBase64Url(value = "") {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (error) {
    console.warn("Gmail本文のデコードに失敗しました", error);
    return "";
  }
}

function stripHtml(value = "") {
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body?.textContent || "";
}

function cleanMailText(value = "") {
  return String(value)
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function summarizeMailBody(text = "") {
  const cleaned = cleanMailText(text);
  if (!cleaned) return "本文を取得できませんでした。";
  const sentences = cleaned
    .split(/(?<=[。！？!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const importantWords = ["至急", "重要", "期限", "要返信", "確認", "承認", "支払い", "請求", "予約", "変更", "キャンセル", "遅延", "中止", "security", "alert", "invoice", "payment", "reservation", "booking", "cancel", "delay"];
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: importantWords.reduce((sum, word) => sum + (sentence.toLowerCase().includes(word.toLowerCase()) ? 3 : 0), 0) + (index < 2 ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
  const summary = (ranked.length ? ranked : sentences.slice(0, 2)).join(" ");
  return summary.length > 180 ? `${summary.slice(0, 180)}…` : summary;
}

function scoreMail(mail) {
  const text = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body}`.toLowerCase();
  let score = mail.labels.includes("UNREAD") ? 12 : 0;
  let type = "📩 確認";
  let level = "mid";
  let badge = "🟡 確認推奨";

  const highWords = ["至急", "重要", "期限", "要返信", "確認依頼", "承認依頼", "支払い", "請求", "未払い", "督促", "security", "alert", "password", "login", "invoice", "payment", "action required", "verify"];
  const travelWords = ["予約", "reservation", "booking", "hotel", "flight", "航空", "宿泊", "旅行", "チェックイン"];
  const changeWords = ["変更", "キャンセル", "遅延", "中止", "欠航", "運休", "cancel", "delay", "changed", "canceled"];
  const workWords = ["会議", "打ち合わせ", "面談", "見積", "納期", "仕様", "契約", "注文", "発注", "納品", "meeting", "deadline", "quote", "contract"];
  const lowWords = ["newsletter", "ニュースレター", "campaign", "キャンペーン", "メルマガ", "sale", "セール", "広告"];

  if (highWords.some((w) => text.includes(w))) {
    score += 45;
    level = "high";
    badge = "🔴 重要";
    type = "📩 要確認";
  }
  if (travelWords.some((w) => text.includes(w))) {
    score += 24;
    type = "🧳 予約・旅行";
    if (level !== "high") badge = "🟡 予約確認";
  }
  if (changeWords.some((w) => text.includes(w))) {
    score += 38;
    level = level === "high" ? "high" : "warn";
    badge = level === "high" ? "🔴 重要" : "⚠️ 注意";
    type = "🔁 変更通知";
  }
  if (workWords.some((w) => text.includes(w))) {
    score += 22;
    type = "💼 仕事・手続き";
  }
  if (text.includes("証券") || text.includes("銀行") || text.includes("sbi") || text.includes("rakuten") || text.includes("楽天")) {
    score += 18;
    type = "📈 金融関連";
  }
  if (lowWords.some((w) => text.includes(w)) && score < 45) {
    score -= 22;
    level = "low";
    badge = "🟢 通常";
  }
  if (score >= 55) {
    level = "high";
    badge = "🔴 重要";
  } else if (score >= 35 && level !== "high") {
    level = "warn";
    badge = "⚠️ 注意";
  }

  return { ...mail, score, level, badge, type };
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function requestLocationWeather() {
  if (!navigator.geolocation) {
    updateStatus("⚠️ このブラウザでは位置情報が使えません。初期地点で表示します。叩き台で表示します。");
    return;
  }

  updateStatus("📍 現在地を確認しています...");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      loadWeather(latitude, longitude, "現在地");
    },
    () => updateStatus("⚠️ 位置情報が許可されませんでした。初期地点の天気を表示しています。"),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
  );
}

async function loadWeather(latitude, longitude, label) {
  try {
    const params = new URLSearchParams({
      latitude,
      longitude,
      timezone: "Asia/Tokyo",
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max",
        "wind_speed_10m_max",
        "uv_index_max"
      ].join(","),
      current: ["temperature_2m", "weather_code", "wind_speed_10m"].join(",")
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error("weather api error");
    const data = await res.json();

    state.place = label;
    state.weather = normalizeWeather(data);
    renderAll();
    updateStatus("✅ 最新情報に更新しました");
  } catch (error) {
    console.error(error);
    updateStatus("⚠️ 天気の取得に失敗しました。通信状態を確認してください。");
    renderFallback();
  }
}

function normalizeWeather(data) {
  const daily = data.daily || {};
  const current = data.current || {};
  const code = Number(current.weather_code ?? daily.weather_code?.[0] ?? 0);
  const weather = weatherCodeToText(code);
  const tempNow = Math.round(current.temperature_2m ?? daily.temperature_2m_max?.[0] ?? 0);
  const tempMax = Math.round(daily.temperature_2m_max?.[0] ?? 0);
  const tempMin = Math.round(daily.temperature_2m_min?.[0] ?? 0);
  const rain = Math.round(daily.precipitation_probability_max?.[0] ?? 0);
  const wind = Math.round(daily.wind_speed_10m_max?.[0] ?? current.wind_speed_10m ?? 0);
  const uv = Math.round(daily.uv_index_max?.[0] ?? 0);
  const laundry = getLaundryIndex({ code, tempMax, rain, wind, uv });

  return {
    code,
    emoji: weather.emoji,
    label: weather.label,
    tempNow,
    tempMax,
    tempMin,
    rain,
    wind,
    uv,
    laundry
  };
}

function getLaundryIndex({ code, tempMax, rain, wind, uv }) {
  let score = 55;

  if (rain >= 70) score -= 55;
  else if (rain >= 50) score -= 38;
  else if (rain >= 35) score -= 24;
  else if (rain <= 20) score += 12;

  if ([61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) score -= 35;
  if ([0, 1].includes(code)) score += 18;
  else if (code === 2) score += 8;
  else if (code === 3) score -= 8;

  if (tempMax >= 28) score += 18;
  else if (tempMax >= 23) score += 12;
  else if (tempMax <= 15) score -= 10;

  if (wind >= 35) score -= 12;
  else if (wind >= 12) score += 8;

  if (uv >= 6) score += 8;
  score = Math.max(0, Math.min(100, score));

  if (score >= 80) return { score, emoji: "🌞", label: "よく乾く", advice: "洗濯日和。厚手の物も外干ししやすいです。" };
  if (score >= 60) return { score, emoji: "👕", label: "乾きやすい", advice: "外干しOK。夕方までに取り込むと安心です。" };
  if (score >= 40) return { score, emoji: "🌥️", label: "やや乾きにくい", advice: "薄手中心がおすすめ。厚手は部屋干し併用が安心です。" };
  if (score >= 20) return { score, emoji: "🏠", label: "部屋干し推奨", advice: "外干しは微妙。除湿機・浴室乾燥が安心です。" };
  return { score, emoji: "☔", label: "乾きにくい", advice: "洗濯は控えめに。必要なら室内干し＋除湿がおすすめです。" };
}

function weatherCodeToText(code) {
  if (code === 0) return { emoji: "☀️", label: "快晴" };
  if ([1, 2].includes(code)) return { emoji: "🌤️", label: "晴れ時々くもり" };
  if (code === 3) return { emoji: "☁️", label: "くもり" };
  if ([45, 48].includes(code)) return { emoji: "🌫️", label: "霧" };
  if ([51, 53, 55, 56, 57].includes(code)) return { emoji: "🌦️", label: "小雨" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { emoji: "🌧️", label: "雨" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { emoji: "❄️", label: "雪" };
  if ([95, 96, 99].includes(code)) return { emoji: "⛈️", label: "雷雨" };
  return { emoji: "🌤️", label: "天気" };
}

function renderAll() {
  renderWeather();
  renderClothes();
  renderCalendar();
  renderMails();
  renderPriority();
  renderDailyAdvice();
}

function renderWeather() {
  const w = state.weather;
  if (!w) return;
  $("weatherPlace").textContent = state.place;
  $("weatherSummary").innerHTML = `
    <div class="weather-icon">${w.emoji}</div>
    <div>
      <p class="weather-name">${w.emoji} ${w.label}</p>
      <p class="muted">現在 ${w.tempNow}℃ / 最高 ${w.tempMax}℃ / 最低 ${w.tempMin}℃</p>
    </div>
  `;
  $("weatherMetrics").innerHTML = [
    metric("🌡️ 気温", `${w.tempMin}℃〜${w.tempMax}℃`),
    metric("☔ 降水確率", `${w.rain}%`),
    metric("💨 最大風速", `${w.wind} km/h`),
    metric("🕶️ UV", `${w.uv}`)
  ].join("");
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderClothes() {
  const w = state.weather;
  if (!w) return;
  const tips = [];

  if (w.tempMax >= 30) tips.push("🥵 暑さ対策：半袖・通気性の良い服・水分補給を意識");
  else if (w.tempMax >= 25) tips.push("👕 日中は半袖でOK。汗ばむ可能性あり");
  else if (w.tempMax >= 20) tips.push("👔 長袖シャツか薄手の羽織りがちょうど良さそう");
  else if (w.tempMax >= 15) tips.push("🧥 薄手の上着推奨。朝晩は少し冷えそう");
  else tips.push("🧣 防寒寄り。上着をしっかり準備");

  if (w.rain >= 60) tips.push("☔ 雨対策：傘は必須。靴も濡れにくいものが安心");
  else if (w.rain >= 35) tips.push("🌂 折りたたみ傘を持つと安心");
  else tips.push("🟢 雨の心配は低め。身軽に動けそう");

  if (w.laundry) tips.push(`${w.laundry.emoji} 洗濯指数：${w.laundry.score}点・${w.laundry.label}。${w.laundry.advice}`);
  if (w.wind >= 35) tips.push("💨 風が強め。帽子や軽い傘は注意");
  if (w.uv >= 6) tips.push("🕶️ 紫外線対策：日焼け止め・サングラス推奨");
  if (Math.abs(w.tempMax - w.tempMin) >= 8) tips.push("🌡️ 寒暖差注意：脱ぎ着しやすい服が便利");

  $("clothesAdvice").innerHTML = tips.map((t) => `<span class="chip">${t}</span>`).join("");
}

function renderCalendar() {
  if (!state.token) {
    $("calendarBadge").textContent = "未接続";
    return;
  }
  $("calendarBadge").textContent = state.events.length ? `${state.events.length}件` : "予定なし";
  $("calendarBadge").className = "badge " + (state.events.length ? "badge-yellow" : "badge-green");
  $("calendarList").innerHTML = state.events.length
    ? state.events.map(renderEvent).join("")
    : `<div class="item level-low"><div class="item__title">🟢 今日の予定は少なめ</div><div class="item__meta">表示中のGoogleカレンダーを確認しましたが、今日の予定は見つかりませんでした。</div></div>`;
}

function renderEvent(event) {
  const time = event.allDay ? "終日" : `${formatTime(event.start)}-${formatTime(event.end)}`;
  const location = event.location ? `<div class="item__meta">📍 ${escapeHtml(event.location)}</div>` : "";
  const calendar = event.calendarName ? `<div class="item__meta">📁 ${escapeHtml(event.calendarName)}</div>` : "";
  return `
    <div class="item level-mid">
      <div class="item__top">
        <div class="item__title">${event.icon} ${time} ${escapeHtml(event.title)}</div>
        <span class="badge badge-yellow">🟡 予定</span>
      </div>
      ${calendar}
      ${location}
    </div>
  `;
}

function renderMails() {
  if (!state.token) {
    $("gmailBadge").textContent = "未接続";
    return;
  }
  const highCount = state.mails.filter((m) => m.level === "high").length;
  const checkCount = state.mails.filter((m) => m.level === "warn" || m.level === "mid").length;
  $("gmailBadge").textContent = highCount ? `重要${highCount}件` : checkCount ? `確認${checkCount}件` : state.mails.length ? "直近表示" : "メールなし";
  $("gmailBadge").className = "badge " + (highCount ? "badge-red" : checkCount ? "badge-yellow" : "badge-green");
  $("gmailList").innerHTML = state.mails.length
    ? state.mails.map(renderMail).join("")
    : `<div class="item level-low"><div class="item__title">🟢 直近メールなし</div><div class="item__meta">直近7日のGmailを確認しましたが、表示できるメールが見つかりませんでした。</div></div>`;
}

function renderMail(mail) {
  return `
    <div class="item level-${mail.level}">
      <div class="item__top">
        <div class="item__title">${mail.type} ${escapeHtml(mail.subject)}</div>
        <span class="badge">${mail.badge}</span>
      </div>
      <div class="item__meta">From: ${escapeHtml(mail.from)}</div>
      <div class="item__meta">📝 ${escapeHtml(mail.summary)}</div>
      <div class="item__meta">重要度: ${Math.max(0, mail.score)}点</div>
    </div>
  `;
}

function renderPriority() {
  const w = state.weather;
  const items = [];
  if (!w) return;

  if (w.rain >= 60) items.push({ level: "high", badge: "🔴 重要", title: "☔ 傘必須", meta: "雨の可能性が高いです。外出前に雨具を準備。" });
  else if (w.rain >= 35) items.push({ level: "mid", badge: "🟡 確認", title: "🌂 折りたたみ傘推奨", meta: "降る可能性があります。念のため持っておくと安心。" });

  if (w.tempMax >= 30) items.push({ level: "warn", badge: "⚠️ 注意", title: "🥵 暑さ対策", meta: "水分補給と涼しい服装を優先。" });
  if (w.wind >= 35) items.push({ level: "warn", badge: "⚠️ 注意", title: "💨 強めの風", meta: "自転車・傘・帽子に注意。" });

  const highMails = state.mails.filter((m) => m.level === "high");
  if (highMails.length) items.unshift({ level: "high", badge: "🔴 重要", title: `📩 重要メール ${highMails.length}件`, meta: "本文から、返信・確認が必要そうなメールがあります。" });

  if (state.events.length) items.push({ level: "mid", badge: "🟡 予定", title: `📅 今日の予定 ${state.events.length}件`, meta: "移動時間と天気を合わせて確認してください。" });

  if (!items.length) items.push({ level: "low", badge: "🟢 通常", title: "✅ 大きな注意事項は少なめ", meta: "天気・予定・メールの面では比較的動きやすい一日です。" });

  $("priorityBadge").textContent = items.some((i) => i.level === "high") ? "🔴 要対応" : items.some((i) => i.level === "warn" || i.level === "mid") ? "🟡 確認" : "🟢 通常";
  $("priorityBadge").className = "badge " + (items.some((i) => i.level === "high") ? "badge-red" : items.some((i) => i.level === "warn" || i.level === "mid") ? "badge-yellow" : "badge-green");
  $("priorityList").innerHTML = items.map(renderItem).join("");
}

function renderGoogleDisconnected() {
  $("calendarBadge").textContent = "未接続";
  $("gmailBadge").textContent = "未接続";
  $("calendarList").innerHTML = `<div class="item level-mid"><div class="item__title">📅 Google連携待ち</div><div class="item__meta">「🔐 Google連携」を押すと、Home / Work / Trip など表示中のカレンダーから今日の予定を読み取ります。</div></div>`;
  $("gmailList").innerHTML = `<div class="item level-mid"><div class="item__title">📩 Google連携待ち</div><div class="item__meta">「🔐 Google連携」を押すと、直近7日のメール本文を確認し、重要メールまたは直近メールを要約します。</div></div>`;
}

function renderGoogleSetupGuide() {
  $("calendarList").innerHTML = `<div class="item level-warn"><div class="item__title">⚠️ Google Client ID 未設定</div><div class="item__meta">Google Cloud ConsoleでOAuth 2.0クライアントIDを作成し、config.jsへ設定してください。</div></div>`;
  $("gmailList").innerHTML = `<div class="item level-warn"><div class="item__title">⚠️ Google Client ID 未設定</div><div class="item__meta">承認済みJavaScript生成元には https://horiken7.github.io を入れてください。</div></div>`;
}

function renderDailyAdvice() {
  const w = state.weather;
  if (!w) return;
  const advice = [];
  advice.push("🚀 まずやる：朝のうちに今日の予定と重要メールを確認");
  if (state.mails.some((m) => m.level === "high")) advice.push("🔴 メール：本文から重要と判定されたメールを先に処理。返信・支払い・予約変更を優先");
  if (state.events.length) advice.push("📅 予定：予定前後の移動時間を確保。天気に合わせて早めに出発");
  if (w.laundry?.score >= 60) advice.push(`👕 洗濯：${w.laundry.label}。早めに干すと効率よく乾きそう`);
  else if (w.laundry) advice.push(`🏠 洗濯：${w.laundry.label}。部屋干し・乾燥機も検討`);
  if (w.rain >= 35) advice.push("☔ 外出前：傘を準備。移動時間も少し余裕を持つ");
  if (w.tempMax >= 30) advice.push("🥤 体調管理：暑さ対策と水分補給を優先");
  if (w.wind >= 35) advice.push("🚗 移動：風が強いので徒歩・自転車・傘利用に注意");
  advice.push("☕ 休憩：午後に短い休憩を入れて、夕方の判断力を残す");

  $("dailyAdvice").innerHTML = advice.map((a) => `<p>${a}</p>`).join("");
}

function renderItem(item) {
  return `
    <div class="item level-${item.level}">
      <div class="item__top">
        <div class="item__title">${item.title}</div>
        <span class="badge">${item.badge}</span>
      </div>
      <div class="item__meta">${item.meta}</div>
    </div>
  `;
}

function eventIcon(text) {
  const t = text.toLowerCase();
  if (t.includes("会議") || t.includes("meeting") || t.includes("レビュー")) return "💼";
  if (t.includes("打ち合わせ") || t.includes("商談")) return "🤝";
  if (t.includes("病院") || t.includes("歯") || t.includes("クリニック")) return "🏥";
  if (t.includes("美容") || t.includes("カット") || t.includes("サロン")) return "✂️";
  if (t.includes("旅行") || t.includes("ホテル") || t.includes("空港")) return "🧳";
  if (t.includes("食事") || t.includes("ランチ") || t.includes("飲み")) return "🍽️";
  return "📌";
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function handleGoogleError(error) {
  console.error(error);
  if (String(error.message).includes("TOKEN_EXPIRED")) {
    updateStatus("🔐 Google連携の有効期限が切れました。もう一度 Google連携 を押してください。複数カレンダー取得のため、再認証が必要な場合があります。");
    renderGoogleDisconnected();
    return;
  }
  updateStatus("⚠️ Googleデータの取得に失敗しました。権限設定とClient IDを確認してください。");
}

function renderFallback() {
  $("weatherSummary").innerHTML = `
    <div class="weather-icon">⚠️</div>
    <div>
      <p class="weather-name">天気取得エラー</p>
      <p class="muted">通信状態またはブラウザ設定を確認してください。</p>
    </div>
  `;
}
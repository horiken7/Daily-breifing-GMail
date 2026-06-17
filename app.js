const CONFIG = window.DAILY_BRIEFING_CONFIG || {};
const DEFAULT_LOCATION = CONFIG.DEFAULT_LOCATION || {
  label: "北九州市八幡西区 目安",
  latitude: 33.861,
  longitude: 130.745
};

const state = {
  weather: null,
  place: DEFAULT_LOCATION.label,
  events: [],
  mails: []
};

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
  renderToday();
  bindButtons();
  updateStatus("🌤️ 天気を取得しています...");
  loadWeather(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.label);
  renderGooglePlaceholders();
});

function bindButtons() {
  $("refreshBtn")?.addEventListener("click", () => {
    renderToday();
    loadWeather(DEFAULT_LOCATION.latitude, DEFAULT_LOCATION.longitude, DEFAULT_LOCATION.label);
  });

  $("locationBtn")?.addEventListener("click", requestLocationWeather);
  $("googleBtn")?.addEventListener("click", () => {
    const clientId = CONFIG.GOOGLE_CLIENT_ID || "";
    if (!clientId || clientId.includes("YOUR_GOOGLE_CLIENT_ID")) {
      updateStatus("🔐 Google連携は config.js の GOOGLE_CLIENT_ID 設定後に有効になります。");
      renderGooglePlaceholders("⚠️ Google Client ID 未設定です");
      return;
    }
    updateStatus("🔐 Google連携の本実装は次ステップです。まずは天気・服装・今日の提案を表示しています。");
  });
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

function requestLocationWeather() {
  if (!navigator.geolocation) {
    updateStatus("⚠️ このブラウザでは位置情報が使えません。初期地点で表示します。");
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

  return {
    code,
    emoji: weather.emoji,
    label: weather.label,
    tempNow: Math.round(current.temperature_2m ?? daily.temperature_2m_max?.[0] ?? 0),
    tempMax: Math.round(daily.temperature_2m_max?.[0] ?? 0),
    tempMin: Math.round(daily.temperature_2m_min?.[0] ?? 0),
    rain: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
    wind: Math.round(daily.wind_speed_10m_max?.[0] ?? current.wind_speed_10m ?? 0),
    uv: Math.round(daily.uv_index_max?.[0] ?? 0)
  };
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

  if (w.wind >= 35) tips.push("💨 風が強め。帽子や軽い傘は注意");
  if (w.uv >= 6) tips.push("🕶️ 紫外線対策：日焼け止め・サングラス推奨");
  if (Math.abs(w.tempMax - w.tempMin) >= 8) tips.push("🌡️ 寒暖差注意：脱ぎ着しやすい服が便利");

  $("clothesAdvice").innerHTML = tips.map((t) => `<span class="chip">${t}</span>`).join("");
}

function renderPriority() {
  const w = state.weather;
  const items = [];
  if (!w) return;

  if (w.rain >= 60) items.push({ level: "high", badge: "🔴 重要", title: "☔ 傘必須", meta: "雨の可能性が高いです。外出前に雨具を準備。" });
  else if (w.rain >= 35) items.push({ level: "mid", badge: "🟡 確認", title: "🌂 折りたたみ傘推奨", meta: "降る可能性があります。念のため持っておくと安心。" });

  if (w.tempMax >= 30) items.push({ level: "warn", badge: "⚠️ 注意", title: "🥵 暑さ対策", meta: "水分補給と涼しい服装を優先。" });
  if (w.wind >= 35) items.push({ level: "warn", badge: "⚠️ 注意", title: "💨 強めの風", meta: "自転車・傘・帽子に注意。" });

  if (!items.length) items.push({ level: "low", badge: "🟢 通常", title: "✅ 大きな注意事項は少なめ", meta: "天気面では比較的動きやすい一日です。" });

  $("priorityBadge").textContent = items.some((i) => i.level === "high") ? "🔴 要対応" : items.some((i) => i.level === "warn" || i.level === "mid") ? "🟡 確認" : "🟢 通常";
  $("priorityBadge").className = "badge " + (items.some((i) => i.level === "high") ? "badge-red" : items.some((i) => i.level === "warn" || i.level === "mid") ? "badge-yellow" : "badge-green");
  $("priorityList").innerHTML = items.map(renderItem).join("");
}

function renderGooglePlaceholders(message = "Google連携は準備中です") {
  $("calendarBadge").textContent = "未接続";
  $("gmailBadge").textContent = "未接続";
  $("calendarList").innerHTML = `<div class="item level-mid"><div class="item__title">📅 ${message}</div><div class="item__meta">config.js に Google Client ID を設定後、今日の予定表示へ進みます。</div></div>`;
  $("gmailList").innerHTML = `<div class="item level-mid"><div class="item__title">📩 ${message}</div><div class="item__meta">読み取り専用で重要メールを表示する設計です。</div></div>`;
}

function renderDailyAdvice() {
  const w = state.weather;
  if (!w) return;
  const advice = [];
  advice.push("🚀 まずやる：朝のうちに今日の予定と重要メールを確認");
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

function renderFallback() {
  $("weatherSummary").innerHTML = `
    <div class="weather-icon">⚠️</div>
    <div>
      <p class="weather-name">天気取得エラー</p>
      <p class="muted">通信状態またはブラウザ設定を確認してください。</p>
    </div>
  `;
}

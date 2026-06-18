// Weather alert patch: color weather metric tiles when caution/alert thresholds are met.
(function(){
  const WEATHER_ALERT_FIX_VERSION = "weather-alert-tiles-v1";
  sessionStorage.setItem("dailyBriefingWeatherAlertFixVersion", WEATHER_ALERT_FIX_VERSION);

  function weatherAlertLevel(metricKey, value, weather) {
    const n = Number(value);
    if (!Number.isFinite(n)) return { level: "normal", note: "" };

    switch (metricKey) {
      case "temp":
        if (weather?.tempMax >= 35 || weather?.tempMin <= 0) return { level: "danger", note: weather.tempMax >= 35 ? "猛暑" : "凍結注意" };
        if (weather?.tempMax >= 30 || weather?.tempMin <= 5) return { level: "warn", note: weather.tempMax >= 30 ? "暑さ注意" : "冷え込み" };
        break;
      case "rain":
        if (n >= 90) return { level: "danger", note: "大雨警戒" };
        if (n >= 70) return { level: "warn", note: "雨に注意" };
        break;
      case "wind":
        if (n >= 45) return { level: "danger", note: "強風警戒" };
        if (n >= 30) return { level: "warn", note: "強風注意" };
        break;
      case "uv":
        if (n >= 8) return { level: "danger", note: "紫外線強い" };
        if (n >= 6) return { level: "warn", note: "UV注意" };
        break;
      default:
        break;
    }
    return { level: "normal", note: "" };
  }

  function alertMetric(label, value, metricKey, rawValue, weather) {
    const alert = weatherAlertLevel(metricKey, rawValue, weather);
    const cls = alert.level === "danger" ? "metric metric-alert-danger" : alert.level === "warn" ? "metric metric-alert-warn" : "metric";
    const note = alert.note ? `<em class="metric-alert-note">${escapeHtml(alert.note)}</em>` : "";
    return `<div class="${cls}"><span>${label}</span><strong>${value}</strong>${note}</div>`;
  }

  renderWeather = function() {
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
      alertMetric("🌡️ 気温", `${w.tempMin}℃〜${w.tempMax}℃`, "temp", w.tempMax, w),
      alertMetric("☔ 降水確率", `${w.rain}%`, "rain", w.rain, w),
      alertMetric("💨 最大風速", `${w.wind} km/h`, "wind", w.wind, w),
      alertMetric("🕶️ UV", `${w.uv}`, "uv", w.uv, w)
    ].join("");
  };

  setTimeout(() => {
    try {
      if (state?.weather) renderWeather();
    } catch (error) {
      console.warn("weather-alert-fix render skipped", error);
    }
  }, 900);
})();

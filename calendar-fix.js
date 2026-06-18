(function(){
  const FIX_VERSION = "calendar-include-v6";
  const INCLUDED_CALENDAR_NAMES = new Set(["日本の祝日", "Trip", "Special day", "Work", "Home"]);
  const saved = sessionStorage.getItem("dailyBriefingCalendarFixVersion") || "";
  if (saved !== FIX_VERSION) {
    sessionStorage.removeItem("dailyBriefingGoogleToken");
    sessionStorage.setItem("dailyBriefingGoogleTokenVersion", FIX_VERSION);
    sessionStorage.setItem("dailyBriefingCalendarFixVersion", FIX_VERSION);
  }

  function isIncludedCalendar(calendar) {
    const name = calendar.summary || calendar.id || "";
    return INCLUDED_CALENDAR_NAMES.has(name);
  }

  function tokyoYmd(date = new Date()) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    return { year: get("year"), month: get("month"), day: get("day") };
  }

  function addDays({ year, month, day }, days) {
    const base = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
    return {
      year: String(base.getUTCFullYear()),
      month: String(base.getUTCMonth() + 1).padStart(2, "0"),
      day: String(base.getUTCDate()).padStart(2, "0")
    };
  }

  getTodayRange = function() {
    const today = tokyoYmd();
    const tomorrow = addDays(today, 1);
    return {
      start: `${today.year}-${today.month}-${today.day}T00:00:00+09:00`,
      end: `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}T00:00:00+09:00`,
      label: `${today.year}-${today.month}-${today.day}`
    };
  };

  loadVisibleCalendars = async function() {
    const calendars = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ showHidden: "true", maxResults: "250" });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await googleFetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`);
      calendars.push(...(data.items || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);

    const byId = new Map();
    calendars
      .filter((calendar) => calendar.id)
      .forEach((calendar) => byId.set(calendar.id, calendar));

    state.includedCalendarNames = [...INCLUDED_CALENDAR_NAMES];
    state.allCalendarNames = [...byId.values()].map((calendar) => calendar.summary || calendar.id).filter(Boolean);

    return [...byId.values()].filter((calendar) => isIncludedCalendar(calendar));
  };

  fetchCalendarEvents = async function(calendar, start, end) {
    const events = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        timeMin: start,
        timeMax: end,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: "Asia/Tokyo",
        showDeleted: "false"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const id = encodeURIComponent(calendar.id);
      const data = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/${id}/events?${params}`);
      events.push(...(data.items || []).map((event) => normalizeEvent(event, calendar)));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return events;
  };

  loadTodayCalendarEvents = async function() {
    const { start, end } = getTodayRange();
    const calendars = await loadVisibleCalendars();
    const debug = [];
    state.calendarNames = calendars.map((calendar) => calendar.summary || calendar.id).filter(Boolean);
    const eventLists = await Promise.all(calendars.map(async (calendar) => {
      const name = calendar.summary || calendar.id;
      try {
        const events = await fetchCalendarEvents(calendar, start, end);
        debug.push({ name, count: events.length, selected: calendar.selected !== false });
        return events;
      } catch (error) {
        console.warn(`skip calendar: ${name}`, error);
        debug.push({ name, count: 0, error: true, selected: calendar.selected !== false });
        return [];
      }
    }));
    const unique = new Map();
    eventLists.flat().forEach((event) => {
      const key = `${event.calendarId || ""}:${event.id || ""}:${event.start || event.dateSort}:${event.title}`;
      unique.set(key, event);
    });
    state.calendarDebug = { start, end, calendars: debug };
    return [...unique.values()]
      .filter((event) => event.status !== "cancelled")
      .sort((a, b) => new Date(a.start || a.dateSort) - new Date(b.start || b.dateSort));
  };

  renderCalendar = function() {
    if (!state.token) {
      $("calendarBadge").textContent = "未接続";
      return;
    }
    $("calendarBadge").textContent = state.events.length ? `${state.events.length}件` : "予定なし";
    $("calendarBadge").className = "badge " + (state.events.length ? "badge-yellow" : "badge-green");
    if (state.events.length) {
      const target = state.includedCalendarNames?.length ? `<div class="item level-low"><div class="item__title">🎯 表示対象カレンダー</div><div class="item__meta">${state.includedCalendarNames.map(escapeHtml).join(" / ")}</div></div>` : "";
      $("calendarList").innerHTML = state.events.map(renderEvent).join("") + target;
      return;
    }
    const checked = state.calendarNames.length ? state.calendarNames.join(" / ") : "表示対象カレンダーなし";
    const target = state.includedCalendarNames?.length ? state.includedCalendarNames.join(" / ") : "なし";
    const account = state.googleEmail ? `接続中: ${escapeHtml(state.googleEmail)}<br>` : "";
    const debug = state.calendarDebug;
    const range = debug ? `取得範囲: ${escapeHtml(debug.start)} 〜 ${escapeHtml(debug.end)}<br>` : "";
    const counts = debug?.calendars?.length
      ? debug.calendars.map((calendar) => `${calendar.count > 0 ? "🟡" : calendar.error ? "⚠️" : "⚪"} ${escapeHtml(calendar.name)}: ${calendar.error ? "取得不可" : `${calendar.count}件`}`).join("<br>")
      : "カレンダー別件数なし";
    $("calendarList").innerHTML = `<div class="item level-low"><div class="item__title">🟢 今日の予定は少なめ</div><div class="item__meta">${account}${range}🎯 表示対象: ${escapeHtml(target)}<br>取得できた対象: ${escapeHtml(checked)}<br><br>📊 カレンダー別の取得結果<br>${counts}</div></div>`;
  };
})();

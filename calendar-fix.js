(function(){
  const FIX_VERSION = "calendar-detail-v8";
  const INCLUDED_CALENDAR_NAMES = new Set(["日本の祝日", "Trip", "Special day", "Work", "Home"]);
  const EVENT_COLORS = {
    "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73", "5": "#f6c026", "6": "#f4511e",
    "7": "#039be5", "8": "#616161", "9": "#3f51b5", "10": "#0b8043", "11": "#d50000"
  };
  const saved = sessionStorage.getItem("dailyBriefingCalendarFixVersion") || "";
  if (saved !== FIX_VERSION) {
    sessionStorage.removeItem("dailyBriefingGoogleToken");
    sessionStorage.setItem("dailyBriefingGoogleTokenVersion", FIX_VERSION);
    sessionStorage.setItem("dailyBriefingCalendarFixVersion", FIX_VERSION);
  }

  function normalizeCalendarName(value = "") {
    return String(value).trim().replace(/\s+/g, " ");
  }

  function calendarDisplayName(calendar = {}) {
    return normalizeCalendarName(calendar.summaryOverride || calendar.summary || calendar.id || "");
  }

  function isIncludedCalendar(calendar) {
    const names = [calendar.summaryOverride, calendar.summary, calendar.id].map(normalizeCalendarName);
    return names.some((name) => INCLUDED_CALENDAR_NAMES.has(name));
  }

  function tokyoYmd(date = new Date()) {
    const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
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
      label: `${today.year}-${today.month}-${today.day}`,
      display: `${today.year}/${today.month}/${today.day} 0:00〜24:00`
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
    calendars.filter((calendar) => calendar.id).forEach((calendar) => byId.set(calendar.id, calendar));
    state.includedCalendarNames = [...INCLUDED_CALENDAR_NAMES];
    state.allCalendarNames = [...byId.values()].map(calendarDisplayName).filter(Boolean);
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

  normalizeEvent = function(event, calendar = {}) {
    const startRaw = event.start?.dateTime || event.start?.date;
    const endRaw = event.end?.dateTime || event.end?.date;
    const allDay = Boolean(event.start?.date);
    const color = EVENT_COLORS[event.colorId] || calendar.backgroundColor || "#5484ed";
    const name = calendarDisplayName(calendar) || "カレンダー";
    return {
      id: event.id || "",
      calendarId: calendar.id || "",
      title: event.summary || "予定あり",
      location: event.location || "",
      description: event.description || "",
      start: startRaw,
      end: endRaw,
      dateSort: startRaw,
      allDay,
      status: event.status || "confirmed",
      calendarName: name,
      calendarColor: color,
      icon: eventIcon(`${event.summary || ""} ${name}`)
    };
  };

  loadTodayCalendarEvents = async function() {
    const { start, end, display } = getTodayRange();
    const calendars = await loadVisibleCalendars();
    const debug = [];
    state.calendarNames = calendars.map(calendarDisplayName).filter(Boolean);
    const eventLists = await Promise.all(calendars.map(async (calendar) => {
      const name = calendarDisplayName(calendar);
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
    state.calendarDebug = { start, end, display, calendars: debug };
    return [...unique.values()].filter((event) => event.status !== "cancelled").sort((a, b) => new Date(a.start || a.dateSort) - new Date(b.start || b.dateSort));
  };

  function formatEventTime(event) {
    if (event.allDay) return "終日";
    return `${formatTime(event.start)}-${formatTime(event.end)}`;
  }

  renderEvent = function(event) {
    const color = event.calendarColor || "#5484ed";
    const time = formatEventTime(event);
    const location = event.location ? `<div class="item__meta">📍 ${escapeHtml(event.location)}</div>` : "";
    const calendar = event.calendarName ? `<div class="item__meta">📁 ${escapeHtml(event.calendarName)}</div>` : "";
    return `
      <div class="item level-mid" style="border-left-color:${escapeHtml(color)}">
        <div class="item__title" style="font-size:1.05rem;line-height:1.6;">
          <span style="color:${escapeHtml(color)};font-size:1.25rem;vertical-align:-1px;">●</span>${escapeHtml(time)}　${escapeHtml(event.title)}
        </div>
        ${calendar}
        ${location}
      </div>`;
  };

  renderCalendar = function() {
    if (!state.token) {
      $("calendarBadge").textContent = "未接続";
      return;
    }
    const range = state.calendarDebug?.display || getTodayRange().display;
    $("calendarBadge").textContent = state.events.length ? "予定あり" : "予定なし";
    $("calendarBadge").className = "badge " + (state.events.length ? "badge-yellow" : "badge-green");

    const target = state.includedCalendarNames?.length ? state.includedCalendarNames.join(" / ") : "なし";
    const rangeCard = `<div class="item level-low"><div class="item__title">🕛 取得範囲</div><div class="item__meta">${escapeHtml(range)}<br>🎯 表示対象: ${escapeHtml(target)}</div></div>`;

    if (state.events.length) {
      $("calendarList").innerHTML = state.events.map(renderEvent).join("") + rangeCard;
      return;
    }

    const found = state.calendarNames?.length ? state.calendarNames.join(" / ") : "対象カレンダーを検出できませんでした";
    $("calendarList").innerHTML = `<div class="item level-low"><div class="item__title">🟢 今日の予定はありません</div><div class="item__meta">${escapeHtml(range)}<br>🎯 表示対象: ${escapeHtml(target)}<br>検出した対象: ${escapeHtml(found)}</div></div>`;
  };
})();

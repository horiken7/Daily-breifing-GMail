// Priority/advice wording patch: use only concrete facts from calendar and task data.
(function(){
  const PRIORITY_FIX_VERSION = "priority-calendar-tasks-v5-align-task-lines";
  sessionStorage.setItem("dailyBriefingPriorityFixVersion", PRIORITY_FIX_VERSION);

  function toMinutes(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.getHours() * 60 + date.getMinutes();
  }

  function todayYmd() {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function calendarName(event) {
    return String(event?.calendarName || "").trim();
  }

  function isCalendar(event, name) {
    return calendarName(event).toLowerCase() === String(name).toLowerCase();
  }

  function eventTitle(event) {
    return String(event?.title || "予定あり").trim();
  }

  function uniqueTitles(events) {
    return [...new Set(events.map(eventTitle).filter(Boolean))];
  }

  function buildCalendarFacts(events = []) {
    const valid = events.filter((event) => event && (event.status || "confirmed") !== "cancelled");
    const timed = valid.filter((event) => !event.allDay);
    const allDay = valid.filter((event) => event.allDay);

    const morning = timed.filter((event) => {
      const minutes = toMinutes(event.start || event.dateSort);
      return minutes !== null && minutes < 12 * 60;
    });
    const afternoon = timed.filter((event) => {
      const minutes = toMinutes(event.start || event.dateSort);
      return minutes !== null && minutes >= 12 * 60 && minutes < 18 * 60;
    });
    const evening = timed.filter((event) => {
      const minutes = toMinutes(event.start || event.dateSort);
      return minutes !== null && minutes >= 18 * 60;
    });

    const parts = [];
    if (morning.length) parts.push(`午前中に${morning.length}件`);
    if (afternoon.length) parts.push(`午後に${afternoon.length}件`);
    if (evening.length) parts.push(`夕方以降に${evening.length}件`);
    if (allDay.length) parts.push(`終日予定が${allDay.length}件`);

    const lines = [];
    if (parts.length) lines.push(`${parts.join("、")}の予定があります。`);

    const home = uniqueTitles(valid.filter((event) => isCalendar(event, "Home")));
    const special = uniqueTitles(valid.filter((event) => isCalendar(event, "Special day")));
    const holidays = uniqueTitles(valid.filter((event) => isCalendar(event, "日本の祝日")));

    if (home.length) lines.push(`🏠 Home：${home.join(" / ")}`);
    if (special.length) lines.push(`🎂 Special day：${special.join(" / ")}`);
    if (holidays.length) lines.push(`🇯🇵 日本の祝日：${holidays.join(" / ")}`);

    return lines.length ? lines.join("<br>") : "今日の予定はありません。";
  }

  function buildImportantTaskFacts(tasks = []) {
    const today = todayYmd();
    const valid = tasks.filter((task) => task && task.status !== "completed" && task.due);
    const overdue = valid.filter((task) => task.due < today);
    const todayTasks = valid.filter((task) => task.due === today);
    const lines = [];

    if (overdue.length) {
      lines.push(`🔴 期限切れ：${overdue.slice(0, 5).map((task) => escapeHtml(task.title || "無題のタスク")).join(" / ")}`);
    }
    if (todayTasks.length) {
      lines.push(`🟡 本日期限：${todayTasks.slice(0, 5).map((task) => escapeHtml(task.title || "無題のタスク")).join(" / ")}`);
    }

    return {
      count: overdue.length + todayTasks.length,
      overdueCount: overdue.length,
      todayCount: todayTasks.length,
      text: lines.join("<br>")
    };
  }

  function buildImportantTaskDailyAdvice(taskFacts) {
    if (!taskFacts?.count) return "";
    return `✅ タスク：<br>${taskFacts.text}`;
  }

  renderPriority = function() {
    const w = state.weather;
    const items = [];
    if (!w) return;

    if (w.rain >= 60) items.push({ level: "high", badge: "🔴 重要", title: "☔ 傘必須", meta: "雨の可能性が高いです。" });
    else if (w.rain >= 35) items.push({ level: "mid", badge: "🟡 確認", title: "🌂 折りたたみ傘推奨", meta: "降る可能性があります。" });

    if (w.tempMax >= 30) items.push({ level: "warn", badge: "⚠️ 注意", title: "🥵 暑さ対策", meta: `最高気温は${w.tempMax}℃です。` });
    if (w.wind >= 35) items.push({ level: "warn", badge: "⚠️ 注意", title: "💨 強めの風", meta: `最大風速は${w.wind}km/hです。` });

    const taskFacts = buildImportantTaskFacts(state.tasks || []);
    if (taskFacts.count) {
      items.push({
        level: taskFacts.overdueCount ? "high" : "mid",
        badge: taskFacts.overdueCount ? "🔴 タスク" : "🟡 タスク",
        title: `✅ タスク ${taskFacts.count}件`,
        meta: taskFacts.text
      });
    }

    // 重要メールは下部の「📩 重要メール」欄だけに表示する。
    // 上部の「今日の重要事項」にはメール件数カードを出さない。

    if (state.events.length) {
      items.push({ level: "mid", badge: "🟡 予定", title: `📅 今日の予定 ${state.events.length}件`, meta: buildCalendarFacts(state.events) });
    }

    if (!items.length) items.push({ level: "low", badge: "🟢 通常", title: "✅ 大きな注意事項は少なめ", meta: "予定・タスク・天気の注意は少なめです。" });

    $("priorityBadge").textContent = items.some((i) => i.level === "high") ? "🔴 要対応" : items.some((i) => i.level === "warn" || i.level === "mid") ? "🟡 確認" : "🟢 通常";
    $("priorityBadge").className = "badge " + (items.some((i) => i.level === "high") ? "badge-red" : items.some((i) => i.level === "warn" || i.level === "mid") ? "badge-yellow" : "badge-green");
    $("priorityList").innerHTML = items.map(renderItem).join("");
  };

  renderDailyAdvice = function() {
    const w = state.weather;
    if (!w) return;
    const advice = [];

    if (state.events.length) advice.push(`📅 予定：${buildCalendarFacts(state.events)}`);
    else advice.push("📅 予定：今日の予定はありません。");

    const taskFacts = buildImportantTaskFacts(state.tasks || []);
    const taskAdvice = buildImportantTaskDailyAdvice(taskFacts);
    if (taskAdvice) advice.push(taskAdvice);

    // 重要メールは下部の「📩 重要メール」欄だけに表示する。
    // 「今日の過ごし方」には出さない。

    advice.push(`☀️ 天気：${escapeHtml(w.label)}、現在${w.tempNow}℃、最高${w.tempMax}℃、最低${w.tempMin}℃、降水確率${w.rain}%です。`);
    if (w.laundry) advice.push(`👕 洗濯：${w.laundry.score}点・${escapeHtml(w.laundry.label)}。`);
    if (w.rain >= 35) advice.push("☔ 雨：傘を準備してください。");
    if (w.tempMax >= 30) advice.push("🥤 暑さ：水分補給を意識してください。");
    if (w.wind >= 35) advice.push(`💨 風：最大風速${w.wind}km/hです。`);

    $("dailyAdvice").innerHTML = advice.map((a) => `<p>${a}</p>`).join("");
  };

  setTimeout(() => {
    try {
      if (state) {
        renderPriority();
        renderDailyAdvice();
      }
    } catch (error) {
      console.warn("priority-fix render skipped", error);
    }
  }, 1200);
})();

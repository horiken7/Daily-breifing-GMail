// Google Tasks patch: show incomplete overdue tasks and incomplete tasks due within 7 days.
(function(){
  const TASKS_FIX_VERSION = "tasks-overdue-next7-v3-refresh-priority";
  const TOKEN_VERSION_TASKS = "google-tasks-readonly-v1";
  sessionStorage.setItem("dailyBriefingTasksFixVersion", TASKS_FIX_VERSION);

  const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly";

  function shortTasksError(error) {
    const raw = String(error?.message || error || "");
    try {
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(raw.slice(jsonStart));
        const message = parsed?.error?.message || raw;
        if (message.includes("Google Tasks API has not been used") || message.includes("disabled")) {
          return {
            kind: "api-disabled",
            message: "Google Cloud側で Google Tasks API が有効化されていません。",
            detail: "API とサービス → ライブラリ → Google Tasks API → 有効にする、を実行してください。"
          };
        }
        if (message.includes("insufficient") || message.includes("PERMISSION_DENIED")) {
          return {
            kind: "permission",
            message: "Google Tasks の読み取り権限が不足しています。",
            detail: "Google Auth Platform のデータアクセスに tasks.readonly を追加し、Google連携を押し直してください。"
          };
        }
        return { kind: "unknown", message: message.slice(0, 180), detail: "" };
      }
    } catch (_) {}
    return { kind: "unknown", message: raw.slice(0, 180), detail: "" };
  }

  function forceReauthForTasks() {
    const saved = sessionStorage.getItem("dailyBriefingTasksTokenVersion") || "";
    if (saved !== TOKEN_VERSION_TASKS) {
      sessionStorage.removeItem("dailyBriefingGoogleToken");
      sessionStorage.setItem("dailyBriefingTasksTokenVersion", TOKEN_VERSION_TASKS);
      state.token = "";
    }
  }

  function patchGoogleScope() {
    try {
      if (!window.google?.accounts?.oauth2 || !CONFIG.GOOGLE_CLIENT_ID) return false;
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: [
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/gmail.readonly",
          TASKS_SCOPE
        ].join(" "),
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
          sessionStorage.setItem("dailyBriefingGoogleTokenVersion", "tasks-enabled-v1");
          sessionStorage.setItem("dailyBriefingTasksTokenVersion", TOKEN_VERSION_TASKS);
          $("googleBtn").textContent = "✅ Google連携済み";
          updateStatus("📅📩✅ Googleから予定・メール・タスクを取得中...");
          await loadGoogleData();
          await loadTasksSafe();
          renderAll();
          renderTasks();
          updateStatus(`✅ Google連携データを表示しました${state.googleEmail ? `（${state.googleEmail}）` : ""}`);
        }
      });
      return true;
    } catch (error) {
      console.warn("Tasks scope patch failed", error);
      return false;
    }
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

  function dateOnly({ year, month, day }) {
    return `${year}-${month}-${day}`;
  }

  function addDays(ymd, days) {
    const base = new Date(Date.UTC(Number(ymd.year), Number(ymd.month) - 1, Number(ymd.day) + days));
    return {
      year: String(base.getUTCFullYear()),
      month: String(base.getUTCMonth() + 1).padStart(2, "0"),
      day: String(base.getUTCDate()).padStart(2, "0")
    };
  }

  function tasksRange() {
    const today = tokyoYmd();
    const next7 = addDays(today, 7);
    return {
      today: dateOnly(today),
      next7: dateOnly(next7),
      display: `${today.year}/${today.month}/${today.day}〜${next7.year}/${next7.month}/${next7.day}`
    };
  }

  function normalizeDueDate(task) {
    if (!task?.due) return "";
    return String(task.due).slice(0, 10);
  }

  function isIncomplete(task) {
    return task && task.status !== "completed" && !task.completed && !task.deleted;
  }

  function taskKind(task, range) {
    const due = normalizeDueDate(task);
    if (!due) return "none";
    if (due < range.today) return "overdue";
    if (due >= range.today && due <= range.next7) return "next7";
    return "none";
  }

  function taskListUrl(taskListId, taskId) {
    return "https://calendar.google.com/calendar/u/0/r/tasks?tab=rc";
  }

  async function loadTaskLists() {
    const lists = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await googleFetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists?${params}`);
      lists.push(...(data.items || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return lists;
  }

  async function loadTasksFromList(list) {
    const tasks = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        maxResults: "100",
        showCompleted: "false",
        showDeleted: "false",
        showHidden: "true"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await googleFetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`);
      tasks.push(...(data.items || []).map((task) => ({
        id: task.id || "",
        title: task.title || "無題のタスク",
        notes: task.notes || "",
        due: normalizeDueDate(task),
        status: task.status || "needsAction",
        listId: list.id,
        listTitle: list.title || "タスク",
        url: task.webViewLink || taskListUrl(list.id, task.id)
      })));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return tasks;
  }

  async function loadGoogleTasks() {
    const range = tasksRange();
    const lists = await loadTaskLists();
    const taskLists = await Promise.all(lists.map(loadTasksFromList));
    const all = taskLists.flat().filter(isIncomplete);
    const selected = all
      .map((task) => ({ ...task, kind: taskKind(task, range) }))
      .filter((task) => task.kind !== "none")
      .sort((a, b) => String(a.due).localeCompare(String(b.due)) || String(a.title).localeCompare(String(b.title), "ja"));
    state.tasksDebug = { range: range.display, lists: lists.length, total: all.length, selected: selected.length };
    return selected;
  }

  async function loadTasksSafe() {
    if (!state.token) return;
    try {
      state.tasks = await loadGoogleTasks();
    } catch (error) {
      console.warn("Google Tasks load failed", error);
      state.tasks = [];
      state.tasksDebug = { error: shortTasksError(error) };
    }
    renderTasks();
    if (typeof renderPriority === "function") renderPriority();
    if (typeof renderDailyAdvice === "function") renderDailyAdvice();
  }

  function renderTask(task) {
    const level = task.kind === "overdue" ? "high" : "mid";
    const mark = task.kind === "overdue" ? "🔴 期限切れ" : "🟡 7日以内";
    const title = escapeHtml(task.title || "無題のタスク");
    const due = task.due ? escapeHtml(task.due.replaceAll("-", "/")) : "期限なし";
    const list = task.listTitle ? `<div class="item__meta">📁 ${escapeHtml(task.listTitle)}</div>` : "";
    const note = task.notes ? `<div class="item__meta">📝 ${escapeHtml(task.notes).slice(0, 160)}</div>` : "";
    const url = task.url || "https://calendar.google.com/calendar/u/0/r/tasks?tab=rc";
    return `
      <div class="item level-${level}">
        <div class="mail-title-row">
          <div class="item__title"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${title}</a></div>
          <span class="badge ${task.kind === "overdue" ? "badge-red" : "badge-yellow"}">${mark}</span>
        </div>
        <div class="item__meta">📅 期限: ${due}</div>
        ${list}
        ${note}
      </div>`;
  }

  renderTasks = function() {
    const badge = $("tasksBadge");
    const list = $("tasksList");
    if (!badge || !list) return;
    if (!state.token) {
      badge.textContent = "未接続";
      list.innerHTML = `<p class="muted">🔐 Google連携後、期限切れと7日先までの未完了タスクを表示します。</p>`;
      return;
    }
    const tasks = state.tasks || [];
    const overdue = tasks.filter((task) => task.kind === "overdue");
    const next7 = tasks.filter((task) => task.kind === "next7");
    badge.textContent = overdue.length ? `期限切れ${overdue.length}件` : tasks.length ? `タスク${tasks.length}件` : "タスクなし";
    badge.className = "badge " + (overdue.length ? "badge-red" : tasks.length ? "badge-yellow" : "badge-green");
    const debug = state.tasksDebug?.error
      ? `<div class="item level-warn"><div class="item__title">⚠️ Google Tasks設定が必要です</div><div class="item__meta">${escapeHtml(state.tasksDebug.error.message || "Google Tasksの取得に失敗しました。")}<br>${escapeHtml(state.tasksDebug.error.detail || "")}</div></div>`
      : `<div class="item level-low debug-card"><div class="item__meta">対象: 期限切れの未完了 + 今日から7日先までの未完了<br>範囲: ${escapeHtml(state.tasksDebug?.range || tasksRange().display)}<br>タスクリスト: ${state.tasksDebug?.lists ?? 0}件 / 対象タスク: ${state.tasksDebug?.selected ?? 0}件</div></div>`;
    if (!tasks.length) {
      list.innerHTML = `<div class="item level-low"><div class="item__title">🟢 対象タスクなし</div><div class="item__meta">期限切れ、または今日から7日先までの未完了タスクはありません。</div></div>${debug}`;
      return;
    }
    const groups = [];
    if (overdue.length) groups.push(`<div class="item level-high"><div class="item__title">🔴 期限切れ ${overdue.length}件</div></div>`, ...overdue.map(renderTask));
    if (next7.length) groups.push(`<div class="item level-mid"><div class="item__title">🟡 今日〜7日先 ${next7.length}件</div></div>`, ...next7.map(renderTask));
    list.innerHTML = groups.join("") + debug;
  };

  const originalConnectGoogle = connectGoogle;
  connectGoogle = function() {
    patchGoogleScope();
    originalConnectGoogle();
  };

  const originalRenderAll = renderAll;
  renderAll = function() {
    originalRenderAll();
    renderTasks();
  };

  forceReauthForTasks();
  setTimeout(() => {
    try {
      patchGoogleScope();
      if (state.token) loadTasksSafe();
      else renderTasks();
    } catch (error) {
      console.warn("tasks-fix init skipped", error);
    }
  }, 1200);
})();

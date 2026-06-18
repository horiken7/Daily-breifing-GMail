(function(){
  const GMAIL_FIX_VERSION = "gmail-multi-query-v2";
  sessionStorage.setItem("dailyBriefingGmailFixVersion", GMAIL_FIX_VERSION);

  function tokyoYmdParts(date = new Date()) {
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

  function gmailDate({ year, month, day }) {
    return `${year}/${Number(month)}/${Number(day)}`;
  }

  function mailRangeLabel() {
    const today = tokyoYmdParts();
    const yesterday = addDays(today, -1);
    return {
      query: `after:${gmailDate(yesterday)}`,
      display: `${yesterday.year}/${yesterday.month}/${yesterday.day} 0:00〜現在`,
      yesterday
    };
  }

  async function searchMessageIds(query, maxResults = 30) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
      includeSpamTrash: "true"
    });
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`;
    const list = await googleFetch(listUrl);
    return list.messages || [];
  }

  loadImportantMails = async function() {
    const range = mailRangeLabel();
    const queries = [
      { label: "広め", q: `in:anywhere newer_than:3d` },
      { label: "昨日以降", q: `in:anywhere ${range.query}` },
      { label: "Gemini", q: `in:anywhere (Gemini OR Imagen OR "Google AI Studio" OR "Google Cloud") newer_than:30d` },
      { label: "対応お願い", q: `in:anywhere ("ご対応のお願い" OR "Action Required" OR upgrade OR アップグレード) newer_than:30d` },
      { label: "Imagen直接", q: `in:anywhere Imagen newer_than:60d` }
    ];

    state.gmailDebug = { range: range.display, query: queries.map((x) => `${x.label}: ${x.q}`).join(" / "), total: 0, fetched: 0, queryResults: [] };

    const idMap = new Map();
    for (const item of queries) {
      try {
        const messages = await searchMessageIds(item.q, item.label === "広め" ? 60 : 20);
        state.gmailDebug.queryResults.push({ label: item.label, q: item.q, count: messages.length });
        messages.forEach((msg) => idMap.set(msg.id, msg));
      } catch (error) {
        console.warn(`Gmail検索に失敗: ${item.label}`, error);
        state.gmailDebug.queryResults.push({ label: item.label, q: item.q, count: 0, error: true });
      }
    }

    const messages = [...idMap.values()];
    state.gmailDebug.total = messages.length;
    if (!messages.length) return [];

    const details = await Promise.all(messages.slice(0, 80).map(async (msg) => {
      const detailParams = new URLSearchParams({ format: "full" });
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?${detailParams}`;
      const detail = await googleFetch(detailUrl);
      return normalizeMail(detail);
    }));

    state.gmailDebug.fetched = details.length;
    state.gmailDebug.subjects = details.slice(0, 12).map((mail) => mail.subject);

    const scored = details
      .map(scoreMail)
      .sort((a, b) => b.score - a.score);

    const important = scored
      .filter((mail) => mail.score >= 20 && mail.level !== "low")
      .slice(0, 8);

    if (important.length) return important;

    return scored.slice(0, 8).map((mail) => ({
      ...mail,
      level: "low",
      badge: "🟢 直近",
      type: mail.type === "📩 確認" ? "📩 直近メール" : mail.type,
      summary: mail.summary || mail.snippet || "本文の要約はありません。"
    }));
  };

  scoreMail = function(mail) {
    const text = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body}`.toLowerCase();
    const original = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body}`;
    let score = mail.labels.includes("UNREAD") ? 12 : 0;
    let type = "📩 確認";
    let level = "mid";
    let badge = "🟡 確認推奨";

    const googleActionWords = [
      "ご対応のお願い", "gemini api", "gemini", "imagen", "モデル", "アップグレード", "upgrade", "api", "google cloud", "google ai studio", "vertex ai", "2026 年 8 月 17 日", "2026年8月17日"
    ];
    const highWords = ["至急", "重要", "期限", "要返信", "確認依頼", "承認依頼", "支払い", "請求", "未払い", "督促", "security", "alert", "password", "login", "invoice", "payment", "action required", "verify", "対応", "お願い"];
    const travelWords = ["予約", "reservation", "booking", "hotel", "flight", "航空", "宿泊", "旅行", "チェックイン"];
    const changeWords = ["変更", "キャンセル", "遅延", "中止", "欠航", "運休", "cancel", "delay", "changed", "canceled"];
    const workWords = ["会議", "打ち合わせ", "面談", "見積", "納期", "仕様", "契約", "注文", "発注", "納品", "meeting", "deadline", "quote", "contract"];
    const lowWords = ["newsletter", "ニュースレター", "campaign", "キャンペーン", "メルマガ", "sale", "セール", "広告"];

    if (googleActionWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 80;
      level = "high";
      badge = "🔴 重要";
      type = "🔴 Google/API対応";
    }
    if (highWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 45;
      level = "high";
      badge = "🔴 重要";
      if (type === "📩 確認") type = "📩 要確認";
    }
    if (travelWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 24;
      if (type === "📩 確認") type = "🧳 予約・旅行";
      if (level !== "high") badge = "🟡 予約確認";
    }
    if (changeWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 38;
      level = level === "high" ? "high" : "warn";
      badge = level === "high" ? "🔴 重要" : "⚠️ 注意";
      if (type === "📩 確認") type = "🔁 変更通知";
    }
    if (workWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 22;
      if (type === "📩 確認") type = "💼 仕事・手続き";
    }
    if (text.includes("証券") || text.includes("銀行") || text.includes("sbi") || text.includes("rakuten") || text.includes("楽天")) {
      score += 18;
      if (type === "📩 確認") type = "📈 金融関連";
    }
    if (lowWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w)) && score < 45) {
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
  };

  renderMails = function() {
    if (!state.token) {
      $("gmailBadge").textContent = "未接続";
      return;
    }
    const highCount = state.mails.filter((m) => m.level === "high").length;
    const checkCount = state.mails.filter((m) => m.level === "warn" || m.level === "mid").length;
    $("gmailBadge").textContent = highCount ? `重要${highCount}件` : checkCount ? `確認${checkCount}件` : state.mails.length ? "直近表示" : "メールなし";
    $("gmailBadge").className = "badge " + (highCount ? "badge-red" : checkCount ? "badge-yellow" : "badge-green");
    const account = state.googleEmail ? `接続中: ${escapeHtml(state.googleEmail)}<br>` : "";
    const range = state.gmailDebug?.range || mailRangeLabel().display;
    const queryResults = state.gmailDebug?.queryResults?.length
      ? `<br><br>検索別結果<br>${state.gmailDebug.queryResults.map((r) => `${r.error ? "⚠️" : "🔎"} ${escapeHtml(r.label)}: ${r.count}件`).join("<br>")}`
      : "";
    const subjects = state.gmailDebug?.subjects?.length
      ? `<br><br>取得件名<br>${state.gmailDebug.subjects.map((s) => `・${escapeHtml(s)}`).join("<br>")}`
      : "";
    const debug = state.gmailDebug ? `<br>検索範囲: ${escapeHtml(range)}<br>重複除外後: ${state.gmailDebug.total ?? 0}件 / 詳細取得: ${state.gmailDebug.fetched ?? 0}件${queryResults}${subjects}` : `<br>検索範囲: ${escapeHtml(range)}`;
    $("gmailList").innerHTML = state.mails.length
      ? state.mails.map(renderMail).join("") + `<div class="item level-low"><div class="item__title">🔎 Gmail検索条件</div><div class="item__meta">${account}${debug}</div></div>`
      : `<div class="item level-low"><div class="item__title">🟢 対象メールなし</div><div class="item__meta">${account}昨日から現在までのGmailを確認しましたが、表示できるメールが見つかりませんでした。${debug}</div></div>`;
  };

  setTimeout(async () => {
    try {
      if (state?.token) {
        updateStatus("📩 Gmailを複数条件で再取得中...");
        state.mails = await loadImportantMails();
        renderMails();
        renderPriority();
        renderDailyAdvice();
        updateStatus(`✅ Gmailを再取得しました${state.googleEmail ? `（${state.googleEmail}）` : ""}`);
      }
    } catch (error) {
      console.error(error);
      updateStatus("⚠️ Gmailの再取得に失敗しました。Google連携を押し直してください。");
    }
  }, 800);
})();

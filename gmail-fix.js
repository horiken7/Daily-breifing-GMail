(function(){
  const GMAIL_FIX_VERSION = "gmail-no-alerts-promotions-v5";
  const saved = sessionStorage.getItem("dailyBriefingGmailFixVersion") || "";
  if (saved !== GMAIL_FIX_VERSION) {
    sessionStorage.setItem("dailyBriefingGmailFixVersion", GMAIL_FIX_VERSION);
  }

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

  function shortError(error) {
    try {
      const text = String(error?.message || error || "");
      const jsonStart = text.indexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(text.slice(jsonStart));
        return parsed.error?.message || parsed.error?.status || text.slice(0, 160);
      }
      return text.slice(0, 180);
    } catch (_) {
      return String(error || "unknown error").slice(0, 180);
    }
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

  function isNoiseMail(mail) {
    const text = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body || ""}`.toLowerCase();
    const labels = mail.labels || [];

    // Googleアラートは常に非表示
    if (text.includes("google アラート") || text.includes("google alert") || text.includes("googlealerts-noreply")) return true;

    // Gmailのプロモーション分類は常に非表示
    if (labels.includes("CATEGORY_PROMOTIONS")) return true;

    // 明らかな広告・販促・クーポン系は非表示
    const promoWords = [
      "promotion", "promotions", "campaign", "coupon", "sale", "discount", "off", "newsletter",
      "キャンペーン", "クーポン", "セール", "割引", "最大", "%off", "％off", "引換券", "チャンス",
      "大感謝祭", "リッチクーポン", "プロモーション", "ニュースレター", "メルマガ", "新登場"
    ];
    if (promoWords.some((w) => text.includes(w.toLowerCase()))) return true;

    // 今回ノイズになっていた差出人・件名系
    if (text.includes("google home") || text.includes("スピーカー")) return true;
    if (text.includes("global ai hackathon") || text.includes("hackathon")) return true;
    if (text.includes("くすりエクスプレス") || text.includes("vpass.ne.jp")) return true;

    return false;
  }

  function normalizeSummary(text = "") {
    return String(text)
      .replace(/https?:\/\/\S+/g, "")
      .replace(/<br\s*\/?>(\s*)/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
  }

  loadImportantMails = async function() {
    const range = mailRangeLabel();
    const queries = [
      { label: "昨日以降", q: `in:anywhere ${range.query} -category:promotions`, max: 50 },
      { label: "配送遅延", q: `in:anywhere (配送 OR 配達 OR 遅延 OR お届け OR delivery OR shipping OR delayed) newer_than:14d -category:promotions`, max: 30 },
      { label: "重要語", q: `in:anywhere (重要 OR 至急 OR 期限 OR 要対応 OR ご対応のお願い OR Action Required) newer_than:14d -category:promotions`, max: 30 },
      { label: "Google AI", q: `in:anywhere (Gemini OR Imagen OR "Google AI Studio" OR "Google Cloud") newer_than:30d -category:promotions`, max: 20 }
    ];

    state.gmailDebug = { range: range.display, total: 0, fetched: 0, removed: 0, queryResults: [] };

    const idMap = new Map();
    for (const item of queries) {
      try {
        const messages = await searchMessageIds(item.q, item.max);
        state.gmailDebug.queryResults.push({ label: item.label, q: item.q, count: messages.length });
        messages.forEach((msg) => idMap.set(msg.id, msg));
      } catch (error) {
        const message = shortError(error);
        console.warn(`Gmail検索に失敗: ${item.label}`, error);
        state.gmailDebug.queryResults.push({ label: item.label, q: item.q, count: 0, error: true, message });
      }
    }

    const messages = [...idMap.values()];
    state.gmailDebug.total = messages.length;
    if (!messages.length) return [];

    const details = await Promise.all(messages.slice(0, 60).map(async (msg) => {
      const detailParams = new URLSearchParams({ format: "full" });
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?${detailParams}`;
      const detail = await googleFetch(detailUrl);
      return normalizeMail(detail);
    }));

    state.gmailDebug.fetched = details.length;
    state.gmailDebug.subjects = details.slice(0, 8).map((mail) => mail.subject);

    const filtered = details.filter((mail) => !isNoiseMail(mail));
    state.gmailDebug.removed = details.length - filtered.length;

    const scored = filtered
      .map(scoreMail)
      .sort((a, b) => b.score - a.score);

    const important = scored
      .filter((mail) => mail.score >= 45 && mail.level !== "low")
      .slice(0, 5);

    if (important.length) return important;

    return scored.slice(0, 3).map((mail) => ({
      ...mail,
      level: mail.score >= 30 ? "mid" : "low",
      badge: mail.score >= 30 ? "🟡 確認" : "🟢 直近",
      category: mail.category || "直近メール",
      summary: mail.summary || mail.snippet || "本文の要約はありません。"
    }));
  };

  scoreMail = function(mail) {
    const text = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body}`.toLowerCase();
    const original = `${mail.subject} ${mail.from} ${mail.snippet} ${mail.body}`;
    let score = mail.labels.includes("IMPORTANT") ? 20 : mail.labels.includes("UNREAD") ? 8 : 0;
    let category = "確認";
    let level = "mid";
    let badge = "🟡 確認";

    const deliveryWords = ["配送", "配達", "遅延", "お届け", "発送", "出荷", "delivery", "shipping", "delayed", "delay"];
    const securityWords = ["security", "alert", "password", "login", "verify", "不正", "ログイン", "パスワード", "セキュリティ"];
    const moneyWords = ["請求", "支払い", "未払い", "invoice", "payment", "銀行", "証券", "カード"];
    const actionWords = ["至急", "重要", "期限", "要返信", "要対応", "ご対応のお願い", "action required", "確認依頼"];
    const googleApiWords = ["gemini", "imagen", "google ai studio", "google cloud", "vertex ai", "アップグレード", "upgrade"];

    if (deliveryWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 90;
      category = "配送遅延";
      level = "high";
      badge = "🔴 重要";
    }
    if (securityWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 80;
      category = "セキュリティ";
      level = "high";
      badge = "🔴 重要";
    }
    if (moneyWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 65;
      category = "支払い・金融";
      level = "high";
      badge = "🔴 重要";
    }
    if (actionWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 35;
      if (category === "確認") category = "要確認";
      if (score >= 55) {
        level = "high";
        badge = "🔴 重要";
      }
    }
    if (googleApiWords.some((w) => text.includes(w.toLowerCase()) || original.includes(w))) {
      score += 18;
      if (category === "確認") category = "Google/API通知";
      if (level !== "high") {
        level = "mid";
        badge = "🟡 確認";
      }
    }

    if (score >= 70) {
      level = "high";
      badge = "🔴 重要";
    } else if (score >= 35 && level !== "high") {
      level = "mid";
      badge = "🟡 確認";
    } else if (score < 35) {
      level = "low";
      badge = "🟢 通常";
    }

    return { ...mail, score, level, badge, category, summary: normalizeSummary(mail.summary || mail.snippet || mail.body || "") };
  };

  renderMail = function(mail) {
    const title = escapeHtml(mail.subject || "件名なし");
    const category = mail.category ? `<span class="mail-category">${escapeHtml(mail.category)}</span>` : "";
    return `
      <div class="item level-${mail.level} mail-item">
        <div class="mail-title-row">
          <div class="item__title mail-subject">${title}</div>
          <span class="badge">${mail.badge}</span>
        </div>
        <div class="item__meta">${category} From: ${escapeHtml(mail.from)}</div>
        <div class="item__meta">📝 ${escapeHtml(mail.summary)}</div>
      </div>`;
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
      ? `<details class="debug-details"><summary>🔎 Gmail検索条件</summary>${state.gmailDebug.queryResults.map((r) => `${r.error ? "⚠️" : "🔎"} ${escapeHtml(r.label)}: ${r.count}件${r.message ? `：${escapeHtml(r.message)}` : ""}`).join("<br>")}</details>`
      : "";
    const debugCard = `<div class="item level-low debug-card"><div class="item__meta">${account}検索範囲: ${escapeHtml(range)}<br>表示: 最大5件 / 検索結果: ${state.gmailDebug?.total ?? 0}件 / 非表示: ${state.gmailDebug?.removed ?? 0}件${queryResults}</div></div>`;
    $("gmailList").innerHTML = state.mails.length
      ? state.mails.slice(0, 5).map(renderMail).join("") + debugCard
      : `<div class="item level-low"><div class="item__title">🟢 対象メールなし</div><div class="item__meta">${account}昨日から現在までのGmailを確認しましたが、表示できる重要メールは見つかりませんでした。</div></div>${debugCard}`;
  };

  setTimeout(async () => {
    try {
      if (state?.token) {
        updateStatus("📩 Gmailを整理して再取得中...");
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

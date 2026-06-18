// Mail display patch: show important mail as a simple subject-only bullet list.
(function(){
  const MAIL_LIST_FIX_VERSION = "mail-subject-bullets-v1";
  sessionStorage.setItem("dailyBriefingMailListFixVersion", MAIL_LIST_FIX_VERSION);

  function gmailOpenUrl(mail) {
    if (!mail?.id) return "";
    return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(mail.id)}`;
  }

  function subjectBullet(mail) {
    const subject = escapeHtml(mail?.subject || "件名なし");
    const url = gmailOpenUrl(mail);
    const text = url
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="mail-subject-link" style="color:inherit;text-decoration:none;">${subject}</a>`
      : subject;
    return `<div class="mail-subject-bullet">・${text}</div>`;
  }

  renderMail = function(mail) {
    return subjectBullet(mail);
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
    const range = state.gmailDebug?.range || "昨日0:00〜現在";
    const queryResults = state.gmailDebug?.queryResults?.length
      ? `<details class="debug-details"><summary>🔎 Gmail検索条件</summary>${state.gmailDebug.queryResults.map((r) => `${r.error ? "⚠️" : "🔎"} ${escapeHtml(r.label)}: ${r.count}件${r.message ? `：${escapeHtml(r.message)}` : ""}`).join("<br>")}</details>`
      : "";
    const debugCard = `<div class="item level-low debug-card"><div class="item__meta">${account}検索範囲: ${escapeHtml(range)}<br>表示: 最大5件 / 検索結果: ${state.gmailDebug?.total ?? 0}件 / 非表示: ${state.gmailDebug?.removed ?? 0}件${queryResults}</div></div>`;

    $("gmailList").innerHTML = state.mails.length
      ? `<div class="item level-${highCount ? "high" : "mid"} mail-item"><div class="item__title">📩 重要メール</div><div class="item__meta mail-subject-list">${state.mails.slice(0, 5).map(subjectBullet).join("")}</div></div>${debugCard}`
      : `<div class="item level-low"><div class="item__title">🟢 対象メールなし</div><div class="item__meta">${account}昨日から現在までのGmailを確認しましたが、表示できる重要メールは見つかりませんでした。</div></div>${debugCard}`;
  };

  // renderPriorityの重要メール欄も「件名だけの箇条書き」に寄せる。
  const originalRenderPriority = renderPriority;
  renderPriority = function() {
    originalRenderPriority();
    const highMails = state.mails.filter((m) => m.level === "high");
    if (!highMails.length) return;

    const priorityList = $("priorityList");
    const items = [...priorityList.querySelectorAll(".item")];
    const mailItem = items.find((item) => item.textContent.includes("重要メール"));
    if (!mailItem) return;

    const meta = mailItem.querySelector(".item__meta");
    if (meta) {
      meta.innerHTML = highMails.slice(0, 5).map((mail) => `・${escapeHtml(mail.subject || "件名なし")}`).join("<br>");
    }
  };

  setTimeout(() => {
    try {
      if (state) {
        renderMails();
        renderPriority();
      }
    } catch (error) {
      console.warn("mail-list-fix render skipped", error);
    }
  }, 1400);
})();

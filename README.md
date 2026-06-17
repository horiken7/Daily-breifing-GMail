# KEN's Daily Briefing

スマホで毎朝見るためのデイリーブリーフィングサイトです。

## できること

- ☀️ 現在地または初期地点の天気表示
- 👕 気温・雨・風・UVから服装アドバイス
- 📅 Googleカレンダーから今日の予定を表示するための枠
- 📩 Gmailから重要メールを表示するための枠
- 🧭 天気・予定・メールから今日の過ごし方を提案
- 🔴 🟡 🟢 絵文字とラベルでスマホでも判別しやすい表示

## 公開URL

GitHub Pagesのデプロイ完了後、以下で表示できます。

https://horiken7.github.io/Daily-breifing-GMail/

## Google連携の設定

天気だけなら設定不要で動きます。Googleカレンダー・Gmailを使うには、Google Cloud ConsoleでOAuth 2.0クライアントIDを作成してください。

### 有効化するAPI

- Google Calendar API
- Gmail API

### OAuth 2.0 クライアントID

アプリケーションの種類は「ウェブ アプリケーション」を選びます。

承認済みのJavaScript生成元に以下を追加します。

```text
https://horiken7.github.io
```

### config.jsを編集

`config.js` の `GOOGLE_CLIENT_ID` を、作成したクライアントIDに置き換えます。

```js
window.DAILY_BRIEFING_CONFIG = {
  GOOGLE_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com",
  DEFAULT_LOCATION: {
    label: "北九州市八幡西区 目安",
    latitude: 33.861,
    longitude: 130.745
  }
};
```

## GitHub Pages

Settings → Pages で以下に設定してください。

- Source: Deploy from a branch
- Branch: main
- Folder: / root

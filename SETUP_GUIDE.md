# hakonushi（箱主）導入・配置作業手順書

OSSとしてリポジトリをクローン／ダウンロードした利用者が、自分の環境で `hakonushi` を稼働させるための手順書です。すべて無料枠（Googleアカウント＋Firebase Sparkプラン）で完結します。

---

## 事前準備

* Googleアカウント（箱のストレージおよびGASのオーナーになるアカウント）
* PCに Node.js と Firebase CLI がインストールされていること
  ```bash
  npm install -g firebase-tools
  ```

---

## Step 1: Firebase プロジェクトと認証の準備

1. [Firebase Console](https://console.firebase.google.com/) を開き、**「プロジェクトを追加」**をクリックして任意のプロジェクト名（例：`my-hakonushi`）を作成する（Google Analyticsはオフで可）。
2. 左メニューの **「構築」＞「Authentication」** を開き、「始める」をクリック。
3. **「Sign-in method」** タブから **「Google」** を選択し、有効化（サポートメールを選択して保存）。
4. 左上の歯車アイコン ＞ **「プロジェクトの設定」** を開き、下部の「マイアプリ」から **ウェブアプリ（`</>` アイコン）** を登録する。
5. 表示される `firebaseConfig` オブジェクト（`apiKey`, `authDomain`, `projectId` など）をメモしておく。
   * 特に **`apiKey`** は後のGAS設定でも使用します。

---

## Step 2: Google Drive とコンテナバインドGASの配置

1. Google Drive を開き、マイドライブ内に専用フォルダを作成する（例：`hakonushi`）。
   * **注意**: マイドライブ直下にスプレッドシートを置かないでください。
2. 作成したフォルダの中で、新規の **Googleスプレッドシート** を作成する（例：`hakonushi_db`）。
3. スプレッドシートの上部メニューから **「拡張機能」＞「Apps Script」** を開く。
4. リポジトリの `gas/` フォルダ内にある各 `.gs` ファイルの内容を、GASエディタにコピー＆ペーストして保存する（または `clasp push` を使用）。
5. **Drive API（高度なGoogleサービス）の有効化**:
   * GASエディタ左メニューの「サービス」横の `+` をクリックし、**「Drive API」**（v3）を追加する。
6. **スクリプトプロパティの設定**:
   * 左メニューの **「プロジェクトの設定（歯車）」** ＞ 下部の **「スクリプト プロパティ」** に以下3件を登録する。
     * `ALLOWED_EMAILS`: 利用を許可する箱主のGoogleメールアドレス（複数の場合はカンマ区切り 例：`a@example.com,b@example.com`）
     * `FIREBASE_API_KEY`: Step 1でメモした Firebase の `apiKey`
     * `ALLOWED_ORIGINS`: フロントエンドの許可オリジン（複数の場合はカンマ区切り 例：`https://<project-id>.web.app,https://<project-id>.firebaseapp.com`）
7. **DBの初期化**:
   * エディタ画面に戻り、上部ツールバーの関数選択で **`setupDatabase`** を選んで「実行」をクリックする。
   * 初回は権限の承認画面が出るため、「権限を確認」＞自分のアカウント＞「詳細」＞「（プロジェクト名）に移動」＞「許可」を進める。
   * スプレッドシートに `boxes` と `files` の2シートが自動作成されたことを確認する。
8. **Webアプリとしてデプロイ**:
   * 右上の **「デプロイ」＞「新しいデプロイ」** をクリック。
   * 種類の選択で **「ウェブアプリ」** を選び、以下を設定してデプロイする。
     * 次のユーザーとして実行：**自分**
     * アクセスできるユーザー：**全員**（ゲスト利用およびCORS通信のため必須）
   * 発行された **ウェブアプリURL**（`https://script.google.com/macros/s/.../exec`）をコピーする。
9. **自動掃除トリガーの設定**:
   * GAS左メニューの **「トリガー（時計アイコン）」** ＞「トリガーを追加」。
   * 実行する関数：`cleanupExpiredBoxes`
   * イベントのソース：`時間主導型`
   * 時間ベースのトリガーのタイプ：`時間タイマー`（1時間おき等）で保存。

---

## Step 3: フロントエンドの設定と Firebase Hosting へのデプロイ

1. リポジトリのルートで設定テンプレートをコピーして作成する。
   ```bash
   cp public/config.example.js public/config.js
   cp .firebaserc.example .firebaserc
   ```
2. `public/config.js` を開き、Step 1の `firebaseConfig` と Step 2の `gasApiUrl`（`/exec` URL）を貼り付けて保存する。
3. `.firebaserc` の `default` に、Step 1で作成した自分の Firebase プロジェクトID を記入する。
4. ターミナルで Firebase にログインし、デプロイを実行する。
   ```bash
   firebase login
   firebase deploy --only hosting
   ```
5. 完了後に表示される **Hosting URL**（`https://<project-id>.web.app`）へアクセスし、動作確認を行う。

---

## Step 4: 動作確認チェックリスト

* [ ] トップ画面から「箱主」を選び、許可リストのGoogleアカウントでログインできること（警告画面が出ないこと）。
* [ ] 許可リスト外のGoogleアカウントでログインした際、GAS側で拒否されること。
* [ ] 「あげる箱」を作成し、複数ファイルがプログレスバー付きでアップロードされ、`#box=<GUID>` のURLとQRコードが表示されること。
* [ ] シークレットウィンドウ（未ログイン状態）で共有URLを開き、ダウンロードが実行できること。
* [ ] Google Drive の格納ルート配下に `{自分のメアド}/{box_id}/` フォルダが自動作成されていること。
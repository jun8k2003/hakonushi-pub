# hakonushi（箱主）AI開発用・再開可能構築計画書

AIコーディングエージェント（Claude Code / Gemini CLI 等）での開発において、**クレジット上限やセッション切断が発生しても即座に途中から再開できる**よう、タスクを独立した小さな単位（マイルストーン）に分割する。

---

## 1. 再開プロトコル（セッション引き継ぎルール）

1. リポジトリ直下に `PROGRESS.md` を配置し、各タスクの完了時にAIがチェックボックス `[x]` と以下の3点を必ず記録する。
   * 作成・変更したファイル一覧
   * 動作確認結果（または未確認事項）
   * 次に着手するタスクID
2. 新しいセッションで再開する際は、AIに以下を指示するだけで作業を継続する。
   > 「`SPEC.md`、`BUILD_PLAN.md`、`PROGRESS.md` を読み込み、未完了の最初のタスクから実装を再開してください。」

---

## 2. 構築フェーズとタスク一覧

### Phase 1: リポジトリ基盤と設定テンプレート構築
* [ ] **T1-1**: ディレクトリ構成作成（`/gas`, `/public`, `/docs`）、`.gitignore` 作成（`public/config.js`, `.firebaserc`, `gas/.clasp.json` を除外）。
* [ ] **T1-2**: 設定テンプレートファイル作成（`public/config.example.js`, `.firebaserc.example`, `gas/.clasp.json.example`, `firebase.json`）。
* **完了条件**: 機密情報を含まないクリーンな初期構成が完成していること。

### Phase 2: GASバックエンド基盤（DB・相対パス・認証）
* [ ] **T2-1**: `gas/Config.gs` 実装（スクリプトプロパティ `ALLOWED_EMAILS`, `FIREBASE_API_KEY` の読み込み、親フォルダ相対解決関数 `getRootFolder()` / `getUserFolder(email)` / `getBoxFolder(email, boxId)`）。
* [ ] **T2-2**: `gas/Database.gs` 実装（`setupDatabase()` による `boxes`/`files` シート自動生成、`LockService` ラッパー、CRUDヘルパー）。
* [ ] **T2-3**: `gas/Auth.gs` 実装（Firebase `accounts:lookup` によるIDトークン検証、`email_verified` & `ALLOWED_EMAILS` 照合、SHA-256ハッシュ生成）。
* **完了条件**: GASエディタから `setupDatabase()` を実行して2シートが正しく生成され、単体テスト関数で認証・フォルダ作成が確認できること。

### Phase 3: GAS APIエンドポイント実装（`doPost` ルーター）
* [ ] **T3-1**: `gas/Main.gs` 実装（`doPost(e)` で `text/plain` のJSONをパースし、`action` ごとにルーティング、統一エラーレスポンス返却）。
* [ ] **T3-2**: 箱主向けAPI実装（`listBoxes`, `createBox`, `disableBox`, `initUploadSession`［`Origin` ヘッダ付与］, `completeUpload`, `getOwnerDownloadUrl`）。
* [ ] **T3-3**: ゲスト向けAPI実装（`verifyBox`［パスコード検証・5回ロック・`isTrashed()` チェック］, `getGuestDownloadUrl`［一時共有開放］, `initGuestUploadSession`, `completeGuestUpload`, `deleteGuestFile`［論理削除＋ゴミ箱移動］）。
* [ ] **T3-4**: `gas/Trigger.gs` 実装（`cleanupExpiredBoxes()` の作成）。
* **完了条件**: すべての `action` が仕様通りのJSONを返し、Resumable UploadのセッションURIが取得できること。

### Phase 4: フロントエンド基盤（エントリ・認証・共通UI）
* [ ] **T4-1**: `public/index.html` & `public/styles.css` 実装（レスポンシブUI、ローディングリングオーバーレイ、プログレスバーコンポーネント）。
* [ ] **T4-2**: `public/js/api.js` 実装（`Content-Type: text/plain` によるGAS `fetch` ラッパー、ローディング制御、`XMLHttpRequest` によるResumable Upload進捗ハンドラ）。
* [ ] **T4-3**: `public/js/auth.js` & `public/js/router.js` 実装（Firebase Auth Googleログイン、`window.location.hash` の `#box=<GUID>` 解析と画面切替）。
* **完了条件**: Firebase Emulator または Hosting 上で、Googleログインおよびフラグメントによる画面分岐が動作すること。

### Phase 5: 箱主画面・ゲスト画面の実装
* [ ] **T5-1**: `public/js/owner.js` 実装（箱一覧表示、あげる箱／もらう箱作成モーダル、複数ファイル順次アップロード＋プログレスバー、`qrcode.js` によるローカルQRコード生成、箱の無効化）。
* [ ] **T5-2**: `public/js/guest.js` 実装（GUID手入力、パスコード入力、`SEND` 箱の個別ダウンロード、`RECEIVE` 箱の複数ファイル投稿・一覧表示・誤送信削除）。
* **完了条件**: `SEND` / `RECEIVE` の両フローが実機（PC・スマホ）で完走すること。

### Phase 6: 結合テスト・OSS公開準備
* [ ] **T6-1**: エッジケース確認（パスコード5回失敗ロック、Drive手動削除時の共有終了検知、100MB超ファイルの直接PUT）。
* [ ] **T6-2**: `README.md`・`SETUP_GUIDE.md`・`LICENSE`（MIT等）の最終整備。
# hakonushi（箱主）開発進捗（PROGRESS.md）

`BUILD_PLAN.md` の再開プロトコルに基づき、各タスクの完了状況・変更ファイル・確認結果を記録します。

---

## 進捗一覧

### Phase 1: リポジトリ基盤と設定テンプレート構築
* [x] **T1-1**: ディレクトリ構成作成（`/gas`, `/public`, `/docs`）、`.gitignore` 更新（`public/config.js`, `.firebaserc`, `gas/.clasp.json` を除外）。
* [x] **T1-2**: 設定テンプレートファイル作成（`public/config.example.js`, `.firebaserc.example`, `gas/.clasp.json.example`, `gas/appsscript.json`, `firebase.json`）。

### Phase 2: GASバックエンド基盤（DB・相対パス・認証）
* [x] **T2-1**: `gas/Config.gs` 実装（スクリプトプロパティ読み込み、親フォルダ相対解決、`formatDefaultBoxName`）。
* [x] **T2-2**: `gas/Database.gs` 実装（`setupDatabase()` による `boxes`［`box_name` 列含む］/`files` シート自動生成、`LockService` ラッパー、CRUDヘルパー）。
* [x] **T2-3**: `gas/Auth.gs` 実装（Firebase `accounts:lookup` によるIDトークン検証、`emailVerified` & `ALLOWED_EMAILS` 照合、SHA-256ハッシュ生成、`testBackendSetup()`）。

### Phase 3: GAS APIエンドポイント実装（`doPost` ルーター）
* [x] **T3-1**: `gas/Main.gs` 実装（`doPost(e)` で `text/plain` のJSONをパースし、`action` ごとにルーティング、統一エラーレスポンス返却）。
* [x] **T3-2**: `gas/DriveHelper.gs` & `gas/OwnerApi.gs` 実装（`verifyOwner`, `listBoxes`, `createBox`［箱名デフォルト日時対応］, `disableBox`, `initUploadSession`［`Origin` ヘッダ付与］, `completeUpload`, `getOwnerDownloadUrl`）。
* [x] **T3-3**: `gas/GuestApi.gs` 実装（`verifyBox`［パスコード検証・5回ロック・`isTrashed()` チェック・検証後箱名返却］, `getGuestDownloadUrl`［一時共有開放］, `initGuestUploadSession`, `completeGuestUpload`, `deleteGuestFile`［論理削除＋ゴミ箱移動］）。
* [x] **T3-4**: `gas/Trigger.gs` 実装（`cleanupExpiredBoxes()`）。

### Phase 4: フロントエンド基盤（エントリ・認証・共通UI）
* [x] **T4-1**: `public/index.html` & `public/styles.css` 実装（レスポンシブUI、ローディングリングオーバーレイ、プログレスバーコンポーネント、箱名入力プレースホルダー「はこのなまえ」）。
* [x] **T4-2**: `public/js/api.js` 実装（`Content-Type: text/plain` によるGAS `fetch` ラッパー、ローディング制御、`XMLHttpRequest` によるResumable Upload進捗ハンドラ）。
* [x] **T4-3**: `public/js/auth.js` & `public/js/router.js` 実装（Firebase Auth Googleログイン、`#box=<GUID>` 解析と画面切替）。

### Phase 5: 箱主画面・ゲスト画面の実装
* [x] **T5-1**: `public/js/owner.js` 実装（箱一覧・箱名表示、あげる箱／もらう箱作成モーダル、複数ファイル順次アップロード＋プログレスバー、`qrcode-generator` によるローカルQRコード生成、箱の無効化、ファイル一覧・個別DL・Driveフォルダリンク）。
* [x] **T5-2**: `public/js/guest.js` 実装（GUID手入力、パスコード入力、検証通過後の箱名表示、`SEND` 箱の個別ダウンロード、`RECEIVE` 箱の複数ファイル投稿・一覧表示・誤送信削除）。

### Phase 6: 結合テスト・OSS公開準備
* [ ] **T6-1**: 実環境での結合テスト・エッジケース確認（GAS配置、`setupDatabase()` 実行、Firebase Hosting デプロイ、パスコード5回失敗ロック、Drive手動削除検知、100MB超ファイルの直接PUT）。
* [x] **T6-2**: `README.md`・`SETUP_GUIDE.md`・`LICENSE` の最終整備。

---

## 作業ログ

### 2026-11-22: Phase 1〜5 および T6-2 一括実装
* **作成・変更したファイル一覧**:
  * 仕様更新: `SPEC.md`, `SETUP_GUIDE.md`
  * 基盤・設定: `.gitignore`, `firebase.json`, `.firebaserc.example`, `public/config.example.js`, `gas/.clasp.json.example`, `gas/appsscript.json`, `docs/.gitkeep`, `README.md`, `PROGRESS.md`
  * GASバックエンド: `gas/Config.gs`, `gas/Database.gs`, `gas/Auth.gs`, `gas/DriveHelper.gs`, `gas/OwnerApi.gs`, `gas/GuestApi.gs`, `gas/Main.gs`, `gas/Trigger.gs`
  * フロントエンド: `public/index.html`, `public/styles.css`, `public/js/api.js`, `public/js/auth.js`, `public/js/owner.js`, `public/js/guest.js`, `public/js/router.js`
* **動作確認結果**:
  * Node.js (`vm.Script` / `JSON.parse`) にて全14個の JS/GS ファイルおよび全4個の JSON ファイルの構文エラーがないことを確認済み。
  * **未確認事項（実環境依存）**: Firebase プロジェクト・Google Drive・GAS Webアプリへの配置後の実機結合テスト（T6-1）。
### 2026-11-22: 転送中の画面ロック防止（Screen Wake Lock）スライドスイッチ追加
* **変更したファイル一覧**: `SPEC.md`, `public/index.html`, `public/styles.css`, `public/js/api.js`, `public/js/owner.js`, `public/js/guest.js`, `public/js/router.js`
* **動作確認結果**: 全JSファイル構文チェック通過。実機（スマホ・PC）での Wake Lock 動作は T6-1 で確認予定。
* **次に着手するタスクID**: `T6-1`（`SETUP_GUIDE.md` に従った実環境配置およびエッジケース結合テスト）

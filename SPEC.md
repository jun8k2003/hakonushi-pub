# hakonushi（箱主）アプリケーション仕様書

## 1. 概要・コンセプト
**hakonushi（箱主）** は、Google Drive と Google Apps Script（GAS）、Firebase（Hosting / Auth）を組み合わせて構築する、セルフホスト型・個人／家族向けの軽量ファイル送受信中継アプリである。
データ（ファイル）ではなく「入れ物（箱）」をメタファーとし、認証境界と操作権限を明確に分離する。

---

## 2. アクターと権限

| アクター | 定義・役割 | 認証方式 |
| :--- | :--- | :--- |
| **箱主** | 箱を作成・管理し、鍵（URL / QR）を共有する人 | **必須**：Firebase Auth（Googleログイン）＋ GAS側での許可メールアドレスリスト照合 |
| **ゲスト** | 渡された鍵で一時的に箱へアクセスする人 | **不要**：URLフラグメントのGUID（または手入力）＋ 任意6桁パスコード |

---

## 3. システムアーキテクチャ

* **フロントエンド**: Firebase Hosting（静的 HTML / CSS / Vanilla JS）
* **認証**: Firebase Authentication（Googleプロバイダのみ有効化。未確認アプリ警告なし）
* **バックエンドAPI**: コンテナバインドGAS（管理用Googleスプレッドシートに内包、`doPost` でJSON APIを提供）
  * **CORSプリフライト回避**: フロントエンドからの `fetch` は `Content-Type: text/plain` でJSON文字列を送信する。
  * **本人確認**: GAS側でFirebase REST API（`accounts:lookup`）にIDトークンを送信し、`email_verified === true` かつスクリプトプロパティ `ALLOWED_EMAILS` に含まれることを検証する。
* **データベース**: Google Sheets（`boxes` / `files` の2シート構成）。書き込み時は `LockService.getScriptLock()` で排他制御を行う。
* **ストレージ**: Google Drive。Drive API v3 の **Resumable Upload** を使用し、ブラウザから直接 `PUT` することでGASの50MB制限を回避する。
  * セッション開始時、GASからDrive APIへ `Origin` ヘッダを必ず付与し、ブラウザからの直接 `PUT` 時のCORSエラーを防ぐ。

---

## 4. フォルダ階層・DB設計

コンテナバインドGASが自身の親フォルダを辿る（`DriveApp.getFileById(ss.getId()).getParents().next()`）ことで、`ROOT_FOLDER_ID` と `SPREADSHEET_ID` の手動設定を不要にする。

```text
📁 hakonushi/                       ← 格納ルートフォルダ（マイドライブ直下は非推奨）
 ├── 📊 hakonushi_db.gsheet         ← 管理用スプレッドシート（コンテナバインドGAS内包）
 ├── 📁 {owner_email}/              ← 箱主のメアドごとに自動作成
 │    └── 📦 {box_id}/              ← 箱ごとに自動作成（複数ファイルを格納）
 │         ├── 📄 file_1.pdf
 │         └── 🖼️ file_2.jpg
```

### 4.1 `boxes` シート（箱管理）

| 列名 | 型 / 値 | 説明 |
| :--- | :--- | :--- |
| `box_id` | UUID v4 | 主キー。共有URLの `#box=<GUID>` に使用 |
| `box_name` | String | 箱の表示名（識別用）。未入力時のデフォルトは作成日時テキスト（例：`2026/11/22 11:00`） |
| `owner_email` | String | 箱主のGoogleメールアドレス（一覧フィルタ用） |
| `direction` | `SEND` / `RECEIVE` | `SEND`＝あげる箱 / `RECEIVE`＝もらう箱 |
| `status` | Enum | `ACTIVE` / `DISABLED` / `LOCKED` / `EXPIRED` |
| `folder_id` | String | Google Drive上の箱フォルダ（`{box_id}`）のID |
| `passcode_hash` | String | 任意6桁パスコードのSHA-256ハッシュ（未設定時は空欄） |
| `fail_count` | Number | パスコード連続失敗回数（5回で `LOCKED`） |
| `expires_at` | ISO 8601 | 有効期限 |
| `created_at` | ISO 8601 | 作成日時 |

### 4.2 `files` シート（ファイル管理：1対多）

| 列名 | 型 / 値 | 説明 |
| :--- | :--- | :--- |
| `file_id` | String | 主キー（Google DriveのファイルID） |
| `box_id` | UUID v4 | 外部キー（`boxes.box_id`） |
| `file_name` | String | 元のファイル名 |
| `file_size` | Number | バイト数 |
| `mime_type` | String | MIMEタイプ |
| `uploader_name` | String | 任意の投稿者メモ（`RECEIVE` で利用） |
| `status` | `ACTIVE` / `DELETED` | ゲスト取消時は `DELETED` 論理削除＋Driveゴミ箱移動 |
| `uploaded_at` | ISO 8601 | アップロード完了日時 |

---

## 5. 共有URL（フラグメント）＆ QRコード仕様

* **URL形式**: `https://<your-domain>/#box=<GUID>`
  * フラグメント（`#` 以降）はHTTPリクエストに含まれないため、Firebase Hosting側のアクセスログやDrive遷移時の `Referer` ヘッダにGUIDが漏洩しない。
* **QRコード生成**:
  * 外部APIへURLを送らず、`qrcode.js` 等の軽量JSライブラリでブラウザ内（Canvas / SVG）でローカル生成する。
  * 任意設定の6桁パスコードはQRコード（URL）には含めず、別経路・口頭で伝える運用を維持する。

---

## 6. 機能仕様・画面遷移

1. **エントリ・ルーティング**
   * `window.location.hash` に `#box=<GUID>` がある場合：エントリ画面をスキップし、直接ゲスト用検証画面へ遷移する。
   * フラグメントがない場合：「箱主」「ゲスト」選択画面を表示。「ゲスト」選択時はGUID手入力フォームを表示。
2. **箱主画面（ログイン後）**
   * 自分のメールアドレスに紐づく箱一覧を箱名付きで表示（期限切れ・無効化済み含む）。
   * **あげる箱 (`SEND`) 作成**: 箱名（プレースホルダー：`はこのなまえ`、未入力時は作成日時のテキストをデフォルト設定）を入力し、複数ファイル選択 → Resumable Uploadで直接PUT → `#box=<GUID>` のURLとQRコードを表示。
   * **もらう箱 (`RECEIVE`) 作成**: 箱名（プレースホルダー：`はこのなまえ`、未入力時は作成日時のテキストをデフォルト設定）を入力し、空の箱を作成 → URLとQRコードを表示。
   * **箱の管理**: 箱の無効化（`DISABLED`、公開権限解除・Driveフォルダ保持）、箱の有効期限延長・再開（ゴミ箱に入っているフォルダは延長不可）、箱の削除（念押し確認付きで Drive フォルダをゴミ箱へ移動＋DB行削除）、`RECEIVE` 箱に届いたファイルの確認・個別ダウンロード、またはDriveフォルダへのリンク表示（Driveオーナー本人のみ）。
3. **ゲスト画面（ログイン不要）**
   * 検証通過後に箱名を表示し、対象の箱を識別できるようにする。
   * パスコード設定ありの場合は入力・検証（5回連続失敗で箱を `LOCKED`）。
   * **`SEND` 箱**: ファイル一覧と他端末転送用のローカル生成 QR コードを表示し、各ファイルの「ダウンロード」ボタン押下時のみGASが一時的に対象ファイルを「リンクを知っている全員（閲覧者）」へ変更し、`drive.usercontent.google.com` の直ダウンロードURLを返却（6時間猶予後に自動解除）。
   * **`RECEIVE` 箱**: 複数ファイル追加投稿が可能（有効期限まで `ACTIVE` 維持）。投稿済みファイル一覧は**閲覧・取消（Driveゴミ箱移動＋論理削除）が可能だが、ダウンロードは不可**。
4. **自動クリーンアップ（時間主導型トリガー）**
   * 定期実行（例：1時間ごと）で `expires_at` 超過の `ACTIVE` 箱を `EXPIRED` に更新し、一時公開権限を解除する（Drive フォルダ自体は `SEND` / `RECEIVE` とも保持し、箱主の削除操作でゴミ箱へ移動する）。

---

## 7. 非同期通信・進捗UX仕様

| 処理フェーズ | 通信先 | UI表示 | 実装上のポイント・制約 |
| :--- | :--- | :--- | :--- |
| **GAS API通信全般** | GAS (`doPost`) | **ローディングリング**（スピナー＋処理中テキスト） | リクエスト開始と同時に操作ボタンを `disabled` にして二重送信を防止し、`finally` ブロックで必ず解除する。 |
| **ファイルアップロード** | Google Drive（直接 `PUT`） | **リアルタイム・プログレスバー**（ファイルごとの `%` ＋ 全体件数 `2 / 5`）＋ **画面ロック防止トグル** | `XMLHttpRequest`（`xhr.upload.onprogress`）を使用。1〜2並列の順次送信でメモリ圧迫を防ぐ。Screen Wake Lock API による「転送中は画面をロックしない」スライドスイッチを提供（設定はローカル保存、転送終了時に自動解除）。 |
| **ファイルダウンロード** | GAS → Google Drive（直リンク） | **準備中はローディングリング** → 開始後はブラウザ標準DLへ委譲 | Drive直リンクのCORS制約によりアプリ内%表示は不可。開始後にブラウザ標準のダウンロード欄を案内する。 |

---

## 8. OSS公開・外出し設定

* **GAS スクリプトプロパティ**: `ALLOWED_EMAILS`（許可メールアドレスのカンマ区切り）、`FIREBASE_API_KEY` のみ。
* **フロントエンド（`.gitignore` 対象）**: `public/config.js`、`.firebaserc`、`gas/.clasp.json`（代わりに `*.example` を同梱）。
* **初期化関数**: GAS側に `setupDatabase()` を用意し、1クリックで `boxes` / `files` シートとヘッダー行を自動生成する。
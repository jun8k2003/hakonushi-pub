# AI 開発ルール（README.ai.md）

このリポジトリで AI コーディングエージェントが作業する際は、以下のルールを必ず遵守してください。

---

## 1. Git 操作（最重要）

* **コミットおよびプッシュ禁止**: ユーザーから明示的・個別に依頼された場合を除き、`git commit` および `git push` を実行してはならない。
* 変更内容の確認（`git status`, `git diff`）や構文チェックは自由に行ってよい。

## 2. 設計・進捗ドキュメントの参照

* 実装・修正前に [SPEC.md](./SPEC.md)（仕様書）、[BUILD_PLAN.md](./BUILD_PLAN.md)（構築計画）、[PROGRESS.md](./PROGRESS.md)（進捗）を確認すること。
* 設計の視覚的なモック・ガイドは [docs/index.html](./docs/index.html) に配置されている。

## 3. GAS バックエンドの管理方針

* GAS バックエンドは `gas/*.gs` に分割管理し、手動で GAS エディタの `コード.gs` に貼り付けてデプロイする運用としている（`clasp` による自動デプロイは行わない）。
* 結合・クリップボードコピー用スクリプトとして `copy_gas_to_clipboard.bat`（本体: `scripts/copy_gas.ps1`）を用意している。クリップボードの書き換えはユーザーから明示的に求められた場合のみ行うこと。

## 4. セキュリティ・OSS 公開前提のルール

* 機密情報や個人・本番環境固有の情報（`public/config.js`, `.firebaserc`, `gas/.clasp.json`, 本番 Firebase プロジェクト ID、API キー、本番 GAS `/exec` URL、個人の実メールアドレス、ローカルパス等）をリポジトリ内に絶対に書き込まないこと。
* 外部 CDN 依存を増やさず、必要なフロントエンドライブラリは `public/js/vendor/` に同梱し、[README.md](./README.md) にサードパーティライセンスを明記すること。

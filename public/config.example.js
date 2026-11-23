/**
 * hakonushi フロントエンド設定ファイル（テンプレート）
 *
 * このファイルを `public/config.js` にコピーし、
 * ご自身の Firebase プロジェクト設定と GAS WebアプリURL を記入してください。
 */
window.HAKONUSHI_CONFIG = {
  // Firebase Console > プロジェクトの設定 > マイアプリ（ウェブ）から取得
  firebaseConfig: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  },

  // GAS「デプロイ」>「ウェブアプリ」で発行された /exec URL
  gasApiUrl: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
};

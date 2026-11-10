# 無所事事辦公室 — AI Office

以 React、TypeScript、Vite 與 Tailwind CSS 建立的桌面優先 AI 辦公室互動原型。場景以 2D CSS 等距感像素辦公室呈現，角色、任務、討論與活動皆使用本地 mock 資料。

## 開始使用

```bash
npm install
npm run dev
```

使用 `npm run build` 執行 TypeScript 專案建置與 Vite production build。

## 資料來源

`src/officeDataSource.ts` 定義可替換的 `OfficeDataSource` 介面（snapshot、subscribe、dispatch），目前由 `LocalOfficeDataSource` 管理本地狀態。未來可實作同一介面，以 WebSocket 推送事件、並將操作送至 agent API；畫面不必直接依賴傳輸方式。初始人物、任務與活動資料在 `src/mockOffice.ts`，領域資料型別在 `src/types.ts`。


# Vite-Twig-SSR 開發橋接插件：需求文檔 (Requirements Document)

## 1. 專案願景與定位
本插件專為「**PHP 後端 + Twig 模板**」架構的專案設計。
*   **開發階段 (Vite)：** 在本地環境中使用 **Twig.js** 模擬 PHP 的渲染行為，並自動綁定 JSON 假資料，實現前端 UI 的獨立開發與 **HMR (熱模組替換)**。
*   **生產階段 (PHP)：** 插件不參與部署，生產環境由原生的 PHP Twig 引擎處理相同的 `.twig` 檔案，確保開發與線上環境的模板一致性。

### 優化目的
1.  **後端解耦：** 前端工程師在沒有 PHP 環境的情況下，只要有 JSON 格式規範，就能完成 100% 的 UI 開發。
2.  **效能翻倍：** 利用 Vite 的熱更新機制，修改模板或假資料後的反應時間小於 50ms，遠快於重新整理 PHP 頁面。
3.  **零污染生產環境：** 所有的 Mock 邏輯與 Twig.js 轉換僅存在於前端開發環境。上線時，PHP 讀取的是原始且乾淨的 Twig 檔案，保證系統穩定。

## 2. 核心功能需求

### 2.1 自動化假資料映射 (Mock Data Mapping)
*   **檔案關聯：** 插件應具備「同名映射」機制。當 Vite 請求 `path/to/page.twig` 時，插件須自動從指定的 `mock/` 目錄查找並讀取 `path/to/page.json`。
*   **自動注入：** 讀取的 JSON 內容須自動作為 Twig 的執行上下文（Context），讓模板可以直接使用 `{{ current.title }}` 或 `{{ page.breadcrumb }}` 等變數。
*   **範例對應：**
    *   模板檔案：`src/views/about.twig`
    *   假資料檔案：`mock/about.json` (內容包含 `current`, `layout`, `opts` 等欄位)。

### 2.2 Twig 語法與結構支援 (基於 Twig.js)
*   **結構重用：** 必須完整支援 `{% extends %}`、`{% include %}` 與 `{% embed %}`，並能正確處理 CSS/JS 的命名空間路徑。
*   **環境一致性：** 支援註冊自定義的 **Filters** 與 **Functions**，以模擬 PHP 端特有的擴充功能。
*   **路徑解析：** 支援在模板中處理資產路徑（如 `{{ assetsUri }}logo.png`），使其在開發模式下能正確導向至 Vite 資源。

### 2.3 極速開發體驗 (DX)
*   **雙重監聽 HMR：** 
    *   當 `.twig` 檔案變更時，觸發頁面刷新或局部更新。
    *   當關聯的 `.json` 假資料檔案變更時，必須立即重新渲染當前模板，無需重啟 Vite 伺服器。
*   **錯誤反饋：** 模擬 PHP 渲染錯誤。若 Twig 語法錯誤或 JSON 格式異常，應直接在 Vite 畫面上顯示詳細錯誤訊息。

## 3. 技術整合規格

### 3.1 開發環境 (Sandbox Mode)
*   **Vite 伺服器：** 插件攔截對 `.twig` 檔案的請求，將其轉換為由 Twig.js 預編譯好的 HTML 內容。
*   **無縫橋接：** 支援在 Twig 模板中插入 `<script type="module" src="/main.js"></script>`，讓 Vite 的 JS 邏輯能正確作用在渲染後的 HTML 上。

### 3.2 假資料範例應用 (以 about.json 為例)
插件讀取假資料後，模板應能正確解析如下結構：
*   **頁面內容：** `{{ current.content|raw }}` 解析 HTML 字串。
*   **導航控制：** `{% for item in page.breadcrumb %}` 巡覽選單。
*   **全局配置：** `{{ opts.default.contact_mail }}` 讀取聯繫資訊。
*   **版本控制：** `{{ feVersion }}` 顯示前端版本號。

## 4. 配置選項 (Plugin Options)
```javascript
// vite.config.js 預期配置
twig({
  mockPath: './mock',       // JSON 假資料存放目錄
  viewsPath: './src', // Twig 模板根目錄
  globalData: {             // 無論哪個頁面都會注入的全局資料
    main_domain: 'f3cms.com'
  },
  filters: { ... },         // 自定義濾鏡
  functions: { ... }        // 自定義函式
})
```


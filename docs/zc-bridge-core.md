# ZC-MVP-B1:Local Bridge 核心(Mock-only,離線)

Issue:[#119](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/issues/119)。設計依據:Issue #118(ZC-MVP-A 唯讀架構設計)。
狀態:**Draft,等待獨立 exact-HEAD QA**。`G1_HOLD` / `ZC_WORKER_HOLD` 維持不變。

## 這份程式是什麼、不是什麼

這是 Local Bridge 的「離線核心」:狀態機、先寫後做的持久化 journal、一次性 nonce、範圍檢查、STOP/PAUSE、單槽 Executor,以及一個只會驅動「測試假子程序」的 Mock Adapter。

它**不是**可運作的 Worker。它沒有:
- 任何網路、HTTP、GitHub 讀寫或 transport 認證;
- Grok/GitHub 任務解析、`zc.task` 準入、授權簽章驗證(屬 B2);
- Reporter 的真實實作(只有測試用的 Mock Reporter);
- `agy` / Antigravity Adapter、launchd、常駐服務;
- 任何 Mac 或 CLI 設定的讀寫。

每個執行結果都固定帶有:`actual_dispatch=false`、`provider_calls=0`、`github_writes=0`、`mac_settings_writes=0`、`ready_to_merge=false`、`owner_approval_required=true`。`READY_FOR_REVIEW` 只代表「Mock 流程走完,可以給人看」,不代表任何真實 QA、授權或合併許可。

## 檔案

| 檔案 | 作用 |
|---|---|
| `tools/zc-bridge-core/state-machine.mjs` | 狀態與事件表;終態不可覆寫;未知事件 fail-closed;共用純函式(`canonical`、`digest`、`exact`) |
| `tools/zc-bridge-core/journal.mjs` | 每個 attempt 一個校驗和記錄;`writer.lock`;nonce 以 `O_EXCL` 一次性燒毀;重啟 `recover()` |
| `tools/zc-bridge-core/process-supervisor.mjs` | 只能執行 fixture 內的 `node <腳本>`;process group 逾時與終止;環境白名單 |
| `tools/zc-bridge-core/scope-guard.mjs` | 路徑白名單與受保護清單;工作區快照比對 |
| `tools/zc-bridge-core/control.mjs` | STOP / PAUSE 標記、quota breaker;**沒有任何清除或恢復的 API** |
| `tools/zc-bridge-core/executor.mjs` | 並行 1 的單槽執行器,串起以上模組 |
| `tools/zc-bridge-core/adapters/mock.mjs` | Mock Adapter(可注入故障)與 Mock Reporter |

## 狀態機

```
PROPOSED → PENDING_GRANT → AUTHORIZED → CLAIMED → PREPARING → RUNNING → VERIFYING → REPORTING → READY_FOR_REVIEW
```

- 終態(不可再被任何事件改變):`REJECTED`、`EXPIRED`、`HELD`、`FAILED_PREP`、`TIMED_OUT`、`STOPPED`、`FAILED_SCOPE`、`FAILED_ADAPTER`、`FAILED_QUOTA`、`READY_FOR_REVIEW`、`RECONCILE_REQUIRED`。
- `RUNNING` 可轉:`VERIFYING`、`TIMED_OUT`、`STOPPED`、`INTERRUPTED`、`FAILED_QUOTA`、`FAILED_ADAPTER`、`RECONCILE_REQUIRED`。
- `READY_FOR_REVIEW` 只能從 `REPORTING` 或 `REPORT_PENDING` 到達。
- 非法或未知事件:領取前的狀態轉為 `HELD`;領取後轉為 `RECONCILE_REQUIRED`(結果不確定,必須人工對帳)。
- B1 的 journal 從 `CLAIMED` 開始記錄;`PROPOSED`…`AUTHORIZED` 屬 B2 的準入與授權,B1 只定義轉換,不驅動它們。

## Executor 的順序

1. 本機閘門:`STOP`(含不安全的控制目錄)、`PAUSE`、quota breaker。這些在任何驗證副作用之前檢查。
2. 請求驗證(嚴格 key 集合)。`risk_level: high` 與任何未知值 → `REJECTED`,不領取。
3. 領取:nonce 以 `O_EXCL` 燒毀,`CLAIMED` 記錄 fsync。同一時間任何任務都只能有一個非終態 attempt;只要有 `RECONCILE_REQUIRED`,所有新領取都被擋下。
4. 建立工作區、拍基準快照、記錄 tripwire 雜湊;**`RUNNING` 在 adapter 啟動前先持久化**。
5. 在 supervisor 下執行 adapter;`STOP` 會中止子程序。
6. tripwire 先於所有其他結果:哨兵變動 → 寫入 `STOP` 標記並終止為 `STOPPED`。
7. 分類:`timeout`、`quota`、`denied`、`crashed`、`protocol_error`、行程群組無法確認結束等,各有獨立終態。
8. 範圍檢查;失敗則丟棄工作區並終止為 `FAILED_SCOPE`,不回報。
9. 回報;Reporter 失敗只會 `REPORT_PENDING`,**不會重跑任務**。

## 安全邊界

- **沒有任何路徑讓 task 資料變成命令。** supervisor 的 `command` 固定為 `process.execPath`,`args[0]` 必須是 fixture 根目錄直屬、非 symlink、`.js/.mjs` 的腳本,不接受 `-e/--eval` 等旗標、不接受名稱以 `agy` 開頭的腳本。Adapter 只能交出「腳本文字」,不能選命令。
- **fixture 根目錄**必須是 OS 暫存目錄的直屬子目錄、名稱形如 `zc-bridge-core-XXXXXX`、規範路徑(無 symlink)、`0700`、屬於目前使用者。Executor 拒絕任何其他根目錄,所以 B1 不可能碰到真實專案或 HOME。
- **`O_NOFOLLOW`** 是硬性前置:平台不支援時直接拒絕啟動(`NOFOLLOW_UNSUPPORTED`),不降級。
- **非對稱授權:** `STOP` / `PAUSE` 只能被建立,沒有清除函式;任何 `STOP` 同名項目(含 symlink、目錄)都算有效;不安全的控制目錄視為 STOP。遠端 task 文字不能解除。
- **`denied_actions` 非空但 exit 0、狀態 `SUCCESS`** 一律判定失敗(`FAILED_ADAPTER` / `DENIED_ACTIONS`)。這是針對 Lab G1-R3 觀察到的行為形狀所做的固定回歸(測試用的是合成事件,不含真實 ID 或路徑)。
- 子程序的 stderr 內容從不回傳,只回傳位元組數;錯誤訊息只輸出固定代碼。

## 測試

共 **151** 個測試,Node 22 與 Node 20 本機皆全數通過。涵蓋 Issue #119 指定的設計編號:

| 編號 | 內容 | 位置 |
|---|---|---|
| M07 | 重放與重複事件只處理一次 | executor、journal |
| M10 | 越權 diff(含受保護路徑、symlink、二進位、過大、可執行位元)→ `FAILED_SCOPE` | executor、scope-guard |
| M11 | 命令被拒、exit 0、`SUCCESS`、`denied_actions` 非空 → 失敗 | executor |
| M12 | 逾時、行程群組確實消失 | executor、supervisor |
| M13 | 領取後崩潰重啟 → `RECONCILE_REQUIRED` 且擋住後續領取 | executor、journal |
| M15 | 執行中 STOP、重啟後仍有效、task 文字不能解除 | executor、control |
| M17 | 配額失敗 → `FAILED_QUOTA` + breaker | executor、control |
| M20 | 靜態掃描(輔助)與 CI workflow 檢查 | executor |
| M21 | 哨兵變動 → `STOPPED` + 寫入 STOP | executor |
| M22 | 高風險提案 → `REJECTED` | executor |

靜態掃描只是輔助,不能取代行為測試與模組審查:它檢查 import 白名單(只有 supervisor 可 import `node:child_process`,且只能是 `spawn`)、無 `fetch`/`eval`/`process.env`/URL/`shell:true`,以及目錄中只有 Allowlist 的 7 個原始檔。

本機執行(僅限 fixture):

```
node --test test/zc-bridge-core-*.test.mjs
```

## 來源(設計參考,未直接複製)

- Lab `augusliang23-web/cc-h15a-claude-dispatch-lab` main `b577bbae9e26c8751db9fe389753c4dda1b5cdac`:`bridge/foundation.mjs`(轉換表概念)、`bridge/journal.mjs`(`writer.lock`、校驗和、`RECONCILE_REQUIRED` 概念)、`bridge/security.mjs`(canonical JSON、exact-key 概念)。其相依檔(`security.mjs`、`claims.mjs`、`foundation.mjs`)**未**複製,必要的小工具改放在 `state-machine.mjs`。
- Lab Draft PR #36(HOLD)`f8df9a24df…`:僅取 `supervisedRun` 的 process-group 逾時概念與環境白名單概念。**沒有**移植 CONTRACT、`--once`、真實 Agent 啟動、policy transaction、`inspectDenyPolicy`、`inspectAgYExecutable`。

## 與其他工作的契約差異(尚未整合,不宣稱相容)

### Command Center Draft PR #115(`tools/zc-bridge/`,HEAD `44740a0d37…`,2026-11-02 讀取)

| 項目 | #115 | B1 |
|---|---|---|
| 命名 | camelCase(`taskId`、`baseSha`、`paths`) | snake_case(`task_id`、`scope_paths`、`timeout_ms`) |
| 任務格式 | `zc.task/v1`(含 `goal`、`verificationSuite`、`limits{maxMinutes,maxTurns,maxRetries}`) | 內部 request 物件;**不解析 Issue**,不是 `zc.task` |
| `task_id` 格式 | `^zc-[a-z0-9]+(-[a-z0-9]+){1,7}$`,≤72 | 相同 |
| 路徑白名單 | `tools/`、`test/`、`docs/`;拒絕 `.github` 與隱藏路徑 | 相同前綴;另有受保護檔名清單(`package.json`、lockfile、`server.ts`、`CLAUDE.md` 等)且不分大小寫、拒絕大小寫重複 |
| 重試語意 | `maxRetries`(重試次數) | `max_attempts` 1–3(總嘗試次數);`maxRetries = max_attempts − 1`,整合時需明確換算 |
| 授權 | `zc.authorization/v1`,Ed25519,`nonce` 32 hex,`expiresAt` ≤ 60 分鐘 | **未實作授權驗證**;`nonce` 為相同形狀(32 hex),在 journal 中燒毀 |
| 狀態與持久化 | 無;所有輸出固定為 `dispatch: HOLD` | 有狀態機與 journal |
| 簽章序列化 | `JSON.stringify(grant)`(依插入順序) | 不涉及;B2 建議改用鍵排序的 canonical 序列化 |
| 逾時上限 | `maxMinutes ≤ 20` | `timeout_ms ≤ 1,200,000`(20 分鐘) |

B1 沒有修改 `tools/zc-bridge/` 或 #115 的任何檔案與分支。

### Lab Issue #45(Anti,Lab repo 的 Mock Bridge 候選,2026-11-02 讀取)

截至讀取時,#45 只有 Issue:`zc/zc-mvp-a-mac-local-bridge` 分支不存在,也沒有對應 PR。因此以下僅比較 Issue 文字,不比較實作。

| 項目 | Lab #45 | B1 |
|---|---|---|
| 位置與檔案 | Lab repo `bridge/zc-mock-bridge.mjs` 等 7 個檔案 | Command Center `tools/zc-bridge-core/` 等 15 個檔案 |
| 任務契約 | `zc.task/v1`(或相容契約),含 repo ID、base/head SHA、Issue/PR 身分、到期、上限、風險、成本 | 不含 repo/SHA 身分與到期,這些屬 B2 準入 |
| 授權 | 測試內獨立可信 fixture 的 Mock Authorization | 無 |
| Claim / Journal | 持久化 Mock claim/state journal | 有(校驗和、nonce、`RECONCILE_REQUIRED`) |
| Worker | 固定合成資料的 Mock Worker | Mock Adapter 驅動假子程序 |
| Scope Guard、Supervisor、STOP/PAUSE、quota breaker | 檔案清單中沒有對應項目 | 有 |
| 負向測試 | 至少 13 類 | 151 個測試;類別未逐項對照 |

兩者在 claim / journal / 狀態機 / Mock Worker 上有重疊。B1 沒有跨 repo 複製 Lab 實作,整合前不宣稱相容。

## 已知限制與 UNKNOWN

- **macOS process group 行為:** 本機(macOS arm64)Node 20 與 22 的 151 個測試通過,但 CI 在 Linux。macOS 上更廣泛的行為(睡眠喚醒、孤兒行程)**未驗證**。
- **持久性:** journal 使用 `fsync`(檔案與目錄)。macOS 的 `fsync` 不保證資料寫入磁碟快取之外(需要 `F_FULLFSYNC`,Node 沒有直接介面)。電源中斷下的持久性 **未驗證**;B1 只主張崩潰後狀態一致,不主張斷電安全。
- **同一使用者的惡意程序:** 目錄權限與 `O_NOFOLLOW` 擋不住以同一個 UID 執行的惡意程式(可直接改檔)。這不是安全邊界。
- **檢查時點:** 私有目錄與規範路徑的檢查有 TOCTOU 空窗,只能降低風險,不能消除。
- **dir 內容變更偵測:** 工作區快照比對的是檔案內容雜湊、模式與型別;目錄只比對存在與權限。
- **Mock 不證明真實 agent 的行為:** `denied_actions` 的事件形狀取自 Lab G1-R3 的本機證據,但真實 `agy` 的完整輸出協定未在此驗證。

## 仍未通過的 Gate(本 Issue 不處理)

- G1 沙盒驗證(含 R4 與檔案工具寫入測試)。
- 授權簽章驗證、`zc.task` 準入、reader、真實 Reporter(B2/B3)。
- Antigravity Adapter、`agy` 預檢、專屬專案設定。
- 分支保護與必要檢查。
- 獨立 exact-HEAD QA 與擁有者審查。

# 项目交接文档（给下一个 AI 会话）

> **用法**：把这份文档**完整**发给新的 AI 会话，作为上下文起点。它记录了这个项目的现状、约定、以及踩过的坑。
> 项目本身在 `C:\Users\lenovo\Desktop\React19`，已推到 GitHub。

---

## 1. 我是谁 / 我的水平和偏好

**我的情况**
- 在校大学生（大学/大专），非科班或刚入门
- 已经独立做完过这个项目（个人任务管理 + 学习打卡），React 19 + Express 5 + MySQL
- MySQL 是边做边学的，目前能写建表、增删改查、JOIN 还没碰过

**我期望的协作方式（重要）**
- **我自己写代码，你负责讲解、检查、指出问题。** 不要一上来就把整个功能写完 —— 先给我思路和骨架，我写完你 review
- 我明确说"不会写"的时候，**直接把代码给我**，别让我猜
- **解释"为什么"，而不是"怎么做"。** 我关心设计取舍，不关心语法手册
- **能用实测数据说明的，就实测。** 跑个脚本、打个接口、对比两种写法的输出 —— 这比讲道理有用得多
- **指出我的错误时要说清"会有什么后果"**，不要只说"这样不规范"
- **别重复讲我已经会的东西。** 同一个知识点讲过一次就够了，除非我又犯了
- 如果我说的和事实不符，**直接说"我错了"并给出证据** —— 我不介意被纠正，反而需要

**我的坏习惯（请帮我盯着）**
- 手抄代码时容易漏 `return`、拼错字段名、大小写不一致
- 容易把"看起来能跑"当成"真的对了"，忘记看数据库/终端
- 重构时容易顺手改逻辑（应该"只搬家、不改逻辑"）

---

## 2. 项目现状

**功能已全部完成并可正常使用**：

| 模块 | 内容 |
|---|---|
| 认证 | 注册 / 登录 / 退出 / 修改密码（bcrypt 存储，JWT 签发） |
| 权限 | 路由守卫、401 拦截器、所有数据按 `user_id` 隔离 |
| 任务管理 | 增删改查 + 三维度筛选（状态/时间/优先级）+ 过期自动标记 |
| 番茄钟 | 三模式、暂停继续、Web Audio 铃声、弹窗提醒、时长入库统计 |
| 学习打卡 | 每日打卡（数据库唯一约束）、连续天数、累计天数 |
| 今日概况 | 打卡状态 + ECharts 饼图（任务状态分布）+ 当日待办列表 |

**已完成的质量工作**
- 后端从 403 行的 `app.js` 拆成 `app.js` + 3 个路由文件
- 全项目无 `console.log` 残留、无死按钮
- README 完整（建表 SQL、接口表、实现要点、已知限制）
- git 仓库已建并推到 GitHub，`.env` 已忽略

**未做的（有意留的）**
- 番茄钟运行中切页面会中断计时（状态在组件内）
- 关闭浏览器时正在进行的专注不记录
- 手机号登录（明确决定不做）
- `tasks.completed_at` 字段已建未用
- 前端未做代码分割，首屏 JS 约 2MB
- 修改密码后旧 token 在有效期内仍可用（JWT 固有代价）

---

## 3. 技术栈与版本

**前端**（`first-program/`）
```
react 19.2 | vite 8 (rolldown) | react-router-dom 7 | @reduxjs/toolkit 2
antd 6 | echarts 6 | axios | dayjs | classnames
```
- **开启了 React Compiler**（`babel-plugin-react-compiler`）→ **不要手写 `useMemo` / `useCallback`**

**后端**（`server/`）
```
node 24.14 | express 5 | mysql2 | jsonwebtoken | bcryptjs | dayjs
```
- **Express 5**：通配符路由语法和 4.x 不同；`res.send(数字)` 不再当状态码

**数据库**：MySQL 26.7（端口 3306），库名 `task_app`，字符集 `utf8mb4`

---

## 4. 目录结构

```
React19/
├── README.md                    # 项目说明（建表 SQL 在这里）
├── first-program/               # 前端
│   ├── vite.config.js           # /api 代理 + allowedHosts + optimizeDeps
│   └── src/
│       ├── api/                 # 接口层：页面不直接写 axios
│       │   ├── request.js       # axios 实例 + 请求/响应拦截器 ★
│       │   └── auth.js / register.js / tasks.js / nowaday.js / study.js
│       ├── pages/               # login / register / home / nowaday / task / publish / study
│       ├── router/
│       │   ├── index.jsx        # 路由表
│       │   └── requireAuth.jsx  # 路由守卫
│       └── store/               # Redux：登录态 + localStorage 持久化
└── server/
    ├── app.js                   # 只负责组装（15 行）
    ├── db.js                    # mysql2 连接池（注意 dateStrings: true）
    ├── middleware.js            # auth 鉴权 + exprieOverdueTasks
    └── router/
        ├── auths.js             # 注册 / 登录 / me / 改密码
        ├── tasks.js             # 任务 CRUD + everyday
        └── stats.js             # 打卡 / 概览统计 / 番茄时长
```

---

## 5. 项目里必须遵守的约定

**接口约定**
- 所有接口以 `/api` 为前缀，**前缀只在 `app.js` 里加一次**（路由文件里写相对路径）
- 成功响应直接返回数据对象；**错误一律是 `{ tip: '给用户看的中文' }`**
- 状态码：400 参数错 / 401 未认证 / 404 资源不存在或不属于你 / 409 冲突 / 500 兜底
- **`401` 带 `code: 'TOKEN_INVALID'` 才是"登录过期"**（只有 `auth` 中间件会加）；不带的是"本次操作凭据错误"（登录密码错、改密码旧密码错）

**鉴权约定**
- `router/tasks.js` 和 `router/stats.js` 用 `router.use(auth)` 统一挂载 → **新增接口不可能漏鉴权**
- `router/auths.js` **不能**统一挂载（否则登录接口自己也要 token），只在 `/me` 和 `/password` 上单独挂

**数据隔离约定（最重要）**
- 查询/更新/删除任务，**SQL 必须带 `AND user_id = ?`**
- 新建时 `user_id` **一律取自 `req.user.id`**，绝不接受前端传入
- **多条件查询（`AND`/`OR` 混用）必须显式加括号** —— 踩过一次严重的数据泄露

**前端约定**
- 页面不直接 `import axios`，只调 `api/` 里的函数
- 组件里不写 `try/catch` 翻译错误 —— 拦截器已经翻译好了，直接 `message.error(err.message)`
- 跳转统一靠"改状态 + 守卫自动跳"，不手写 `navigate`（除非确实是事件驱动的跳转）
- 受控输入框的 `value` 永远不能是 `null`/`undefined`，用 `|| ''` 兜底
- **state 尽量单一数据源**：能从已有数据算出来的不要再存一份

**后端约定**
- 每个接口都要 `try/catch`，catch 里先 `console.error(err)`，再 `if (res.headersSent) return`
- **提前 `return res.status(...).json(...)`，不要只写 `res.status(...).json(...)`**
- SQL 一律用 `?` 占位符，绝不字符串拼接
- 需要"当前时间"时用数据库的 `NOW()` / `CURDATE()`，不用前端传时间

---

## 6. 踩过的坑（都真实发生过，别再犯）

**① 一个请求只能发一次响应**
`res.json()` / `res.send()` 之后必须 `return`。这个坑踩了 4 次（缺 return × 2、`res.send(201).json()` × 1、catch 里没判 `headersSent` × 1）。
症状：客户端看着正常，**服务端终端一片 `ERR_HTTP_HEADERS_SENT` 红字**。

**② `setState` 不改变当前作用域的变量（闭包快照）**
`setLeftSecond(t)` 之后，当前这次执行里的 `leftSeconds` 还是旧值。
- 在 `useEffect` / `setInterval` 回调里读 state 是**最危险的**
- 修复方式：把值当参数传进去，或者用 `e.target.value` 这类"现场取"的值

**③ `useEffect` 里建立的东西必须清理**
`setInterval` / `clearInterval`、`echarts.dispose()`、`AudioContext.close()`。
**清理函数必须写在 `return () => {}` 里** —— 写在 effect body 里等于"挂载时执行一次，卸载时啥也不做"。
`setIsSubmitting(true)` 这类也要放在所有校验**之后**，否则校验失败提前 return 会让 `finally` 跑不到，按钮永久卡死。

**④ 多条件 SQL 必须加括号**
`WHERE a >= ? or b IS NULL and user_id = ?` 因为 `AND` 优先级高于 `OR`，`user_id` 只管了 OR 的右半边 → **泄露了别人的数据**。
正确：`WHERE user_id = ? AND status = 0 AND (due_date IS NULL OR due_date >= ?)`
另外：**`= NULL` 永远为假，必须用 `IS NULL`**。

**⑤ `GROUP BY` 不返回空组**
某个状态一条数据都没有时，那一组不会出现 → 前端按下标取值会**静默算错**。
修复：后端先初始化 `{done:0, undone:0, overdue:0}`，再按行填充。

**⑥ 定时器不是时钟**
番茄钟**不用"每秒减 1"**，而是记"预计结束的绝对时刻"，每次 tick 用 `Date.now()` 反推剩余。
这样浏览器在后台标签页节流 `setInterval` 时，剩余时间**依然准确**。
（另外 `dayjs` 里 `hh` 是 12 小时制，`HH` 才是 24 小时制 —— 写错了不报错，只是值不对。）

**⑦ 前端校验和后端校验目的不同**
- 前端 = 用户体验（快速反馈）；后端 = 数据完整性
- 判断一条校验后端要不要做：**"前端被绕过后会怎样？"** → 出脏数据/安全漏洞就必须做；只是体验差就前端做够
- `confirmPassword` 这类**不该跨越信任边界**，前端校验即可，也别发给后端

**⑧ JWT 是签名不是加密**
payload 是 Base64 明文，任何人都能解开。别放敏感信息。
**改密码不会让旧 token 失效**（无状态），要真解决需要"密码修改时间 + token iat 比对"。

---

## 7. 环境信息（本机）

| 项 | 值 |
|---|---|
| 系统 | Windows 11 |
| Node | v24.14.1（装在 `D:\下载\nodejs`） |
| npm | 11.11.0 |
| MySQL | 26.7.0，服务名 `MySQL267`，装在 `C:\Program Files\MySQL\MySQL Server 26.7\` |
| **mysql.exe 不在 PATH** | 要用全路径，或用 MySQL Workbench |
| 后端端口 | 8080（`server/.env` 里配） |
| 前端端口 | 5173（dev）/ 4173（preview） |
| git 身份 | `yunyansz` / `zhangziyan11221@qq.com` |
| GitHub 仓库 | `https://github.com/yunyany/task-manager.git`，分支 `main` |

**⚠️ 环境上的两个特殊问题（排查网络/证书问题时先看这里）**

1. **装了 Steam++（Watt Toolkit）网络加速器**
   - 它会**监听 80/443**，并**改 hosts 把 50 多个域名指向 `127.0.0.1`**（github.com、google.com、steam 等）
   - 导致过：`git push` 报 `unable to get local issuer certificate`（已用 `git config --global http.sslBackend schannel` 解决）
   - 导致过：`npm` 报 `CERT_HAS_EXPIRED`
   - **关闭它要用它界面里的"停止加速"，直接强杀进程不会恢复 hosts**

2. **PowerShell 是 5.1（不是 7）**
   - 没有 `-SkipHttpErrorCheck`、`-NoProxy`
   - `curl.exe` 传 JSON body 时**双引号会被 PowerShell 吃掉**，复杂 JSON 要写进文件用 `-d "@文件"`
   - 输出中文可能乱码（控制台编码问题），脚本里判断用布尔值输出

---

## 8. 待办 / 下一步计划

**已完成**：所有功能开发、后端拆分、README、git 推送

**用户接下来想做的**：
1. **再写一个规模更大的项目**（练手 + 简历），倾向用 AI 辅助开发
2. 之后再做域名、云服务器、正式部署

**推荐的部署路径（已调研）**：
- 用户是在校学生 → **GitHub Student Developer Pack** 可以拿到免费云服务器额度，且不受"云厂商新用户"限制
- ⚠️ 申请时要**开着 Steam++**（`education.github.com` 在 hosts 里被指向 127.0.0.1）
- 免费内网穿透（localtunnel/cpolar）都试过，**不稳定**，已在收益递减点放弃
- 真部署方案：轻量应用服务器（Ubuntu 22.04） + Nginx + PM2 + MySQL；**无域名时用非 80 端口绕开备案**

---

## 9. 关于 deploy / 部署的已知结论

- **开发服务器不适合直接暴露到公网** —— Vite dev 模式下每个模块一个请求（数百个），隧道直接 502；生产构建只有 3 个文件
- **生产环境没有 Vite 代理**，`/api` 转发必须由 Nginx 接手（前端代码不用改，因为用的是相对路径）
- `vite preview` **会自动继承 `server.proxy` 和 `server.allowedHosts`**（源码：`preview?.proxy ?? server.proxy`）
- **`dist/` 不会自动更新** —— 改了代码必须重新 `npm run build`

# 切片 1 任务清单 —— 账号 + 项目 + 成员

> 目标：**多对多权限模型跑通，数据真的进 MySQL**。
> 不含：列表、卡片、拖拽、实时、Socket.IO。
> 写代码的是你，我只负责讲思路、给骨架、review。卡住了直接说"不会写"。

---

## 切片 1 的产出（做完这些算完成）

| # | 接口 | 新东西 |
|---|---|---|
| 1 | `POST /api/auth/register` | 无（复制） |
| 2 | `POST /api/auth/login` | 无（复制） |
| 3 | `GET  /api/auth/me` | 无（复制） |
| 4 | `POST /api/projects` | **事务** |
| 5 | `GET  /api/projects` | **JOIN** |
| 6 | `POST /api/projects/join` | **唯一键冲突 / 幂等** |
| 7 | `GET  /api/projects/:projectId` | **权限中间件** |

前端：登录 / 注册 / 项目列表页 + 两个弹窗。

---

## A. 搬家和脚手架（0 新知识，纯复制）

上个项目已经解决的问题**不要重解一遍**。从 `C:\Users\lenovo\Desktop\React19` 复制，只改库名和表名。

- [x] **A1** 后端骨架：`server/` 目录、`package.json`、`.env`、根目录 `.gitignore`
      → 已建好。依赖只装 **express / mysql2 / jsonwebtoken / bcryptjs**（`cors` 没用到，Vite 代理是同源；`dayjs` 上个项目只有 `stats.js` 用；**dotenv 不需要**，Node 24 用 `--env-file=.env`）
      → `.env` 从 React19 复制，`DB_NAME` 改成 `team_board`，`JWT_SECRET` 重新生成
- [x] **A2** `server/db.js`：mysql2 连接池（`dateStrings: true` 已实测生效：`NOW()` 返回字符串而非 Date）
- [x] **A3** 建库 `team_board` + `users` 表 —— 用 `npm run db:init`（`server/scripts/init-db.js`，可重复跑）
- [ ] **A4** `server/router/auths.js`：注册 / 登录 / me ← **你写**
- [ ] **A5** `server/middleware.js` 的 `auth` + `server/app.js` 挂载路由（`/api` 前缀**只在这里加一次**）
- [ ] **A6** 前端：`Task-manage/` 脚手架已建好、`vite.config.js` 的 `/api` 代理已配好 ✅
      还缺依赖：`react-router-dom`、`axios`、`@reduxjs/toolkit`、`react-redux`、`antd`
- [ ] **A7** `Task-manage/src/api/request.js`（axios 实例 + 拦截器）+ `api/auth.js`
- [ ] **A8** Redux auth slice + localStorage 持久化
- [ ] **A9** 路由表 + `requireAuth` 守卫 + Login / Register 页面

**验收 A**：注册 → 登录 → 刷新页面登录态不丢 → 退出后访问 `/projects` 被踢回 `/login`。
同时**必须**：终端没有 `ERR_HTTP_HEADERS_SENT` 红字，数据库 `users` 表里密码是 bcrypt 密文而不是明文。

---

## B. 建表（新知识：外键、复合主键、索引）

切片 1 **只建这两张**。`lists` / `cards` 留到切片 2——一次只验证一件事。

- [x] **B1** `projects` 表（注意 `invite_code` 的 `UNIQUE`）
- [x] **B2** `project_members` 表（复合主键 + `KEY idx_user` + 两个外键 `ON DELETE CASCADE`）
      → 已用 `npm run db:inspect` 确认：PK / idx_user / 两个外键全部到位
- [x] **B3** **验证外键真的生效** —— 已实测：删项目后成员行被级联清空（0 行）

```sql
-- 这一句应该报错。报 Cannot add or update a child row 才对。
INSERT INTO project_members (project_id, user_id, role) VALUES (99999, 1, 'member');
```

**验收 B**：`SHOW CREATE TABLE project_members;` 能看到三样东西——`PRIMARY KEY (project_id,user_id)`、`idx_user`、两个外键。
**并且** B3 报错。**不报错说明外键没建成**（比如两张表的字段类型不一致，MySQL 会静默忽略建表语句里的外键部分——这是最阴的一种失败）。

> 字段类型必须完全一致：`INT UNSIGNED` 对 `INT UNSIGNED`。
> 一边 `INT` 一边 `BIGINT`（或者 signed/unsigned 不一致）就会报 error 3780。所以 `users.id` 也得是 `INT UNSIGNED`。

---
             
## C. 后端接口（本切片的核心）

**C 的完整路由文件形状**（顺序有讲究，见 C6 的坑）：

```js
router.use(auth);                    // 整个文件统一鉴权
router.post('/join', ...);           // ← 必须在最前面！原因见 C6
router.post('/', ...);
router.get('/', ...);
router.use('/:projectId', requireProjectMember);   // ← 之后所有接口自动带权限
router.get('/:projectId', ...);
```

- [x] **C1** 邀请码生成 —— `utils/inviteCode.js`：`crypto.randomBytes` + `makeInviteCode` + `insertProject`（撞码重试、限 5 次）
- [x] **C2** `requireProjectMember` 中间件 —— 已写好并实测 5/5 通过
- [x] **C3** `POST /api/projects` —— 事务 + 撞码重试，实测 201 ✓
- [x] **C4** `GET /api/projects` —— 一条 JOIN 返回全部项目，实测 3 个项目全返回 ✓
- [x] **C5** `POST /api/projects/join` —— 200 / 409 / 404 三条路径实测通过
- [x] **C6** `GET /api/projects/:projectId`：返回项目详情（当前返回 `req.membership`，含 `invite_code` 待补）

> ⚠️ 遗留 2 处：`projects.js:16` 和 `:87` 直接 `name.trim()` / `invite_code.trim()`，
> 字段缺失（`undefined`）时会 TypeError → **500**，应为 400。见「待修」。<br>
> 另：参数校验目前发生在 `pool.getConnection()` **之后**，坏请求会白占一条池连接（池只有 10 条）。
> 校验前移即可。

### 为什么 `GET /api/projects` 的响应里带 `invite_code` 是安全的

因为这个接口只列出**我参与的项目**，能调用它的必然已经是成员；而权限矩阵里"查看邀请码"对 owner 和 member 都是 ✓。
省掉一个单独的查码接口，切片 1 更短。切片 2 做邀请码弹窗时直接复用。

### 验收 C：手工 curl 打一遍

⚠️ PowerShell 5.1 传 JSON 时双引号会被吃掉，**复杂 body 写进文件用 `-d "@body.json"`**。

- [ ] 注册两个账号 A、B
- [ ] A 建项目 → 数据库 `projects` 有 1 行、`project_members` 有 1 行且 `role='owner'`（**两行都必须在**，这是 C3 事务的验收点）
- [ ] `GET /api/projects` 用 A 的 token → 看到项目；用 B 的 token → **空数组**
- [ ] B 用 A 的邀请码 join → 200
- [ ] **B 再 join 一次同样的码** → 依然是 200，数据库里仍然只有 1 行 B 的记录
- [ ] **B 用 A 的 token 访问 `GET /api/projects/1`** → A 能拿到
- [ ] **B 用自己 token 访问 `GET /api/projects/1`**（B 已经是成员）→ 也能拿到
- [ ] **换个没加入的账号 C 访问 `GET /api/projects/1`** → **必须 404，不能是 403**

---

## D. 前端
 
- [ ] **D1** `src/api/projects.js`：4 个函数（create / list / join / detail）
- [ ] **D2** `src/pages/Projects.jsx`：列表 + 空状态（"还没有项目，点右上角新建"）+ 两个按钮
- [ ] **D3** `ProjectCard` 组件：项目名、成员数、我的角色徽章（owner/member）
- [ ] **D4** `CreateProjectModal`
- [ ] **D5** `JoinProjectModal`
- [ ] **D6** 联调 + 错误路径测试

**验收 D（关键）**：**开两个浏览器**——一个正常窗口当 A，一个**无痕窗口**当 B（无痕是为了不共享 localStorage，两个账号的登录态才能同时存在）。

- [ ] A 建项目 → 页面出现该项目
- [ ] A 把邀请码给 B（切片 1 先手工看数据库，切片 2 再做弹窗）
- [ ] B 用码加入 → **B 的项目列表里出现该项目**
- [ ] B 的项目列表里，该项目的角色徽章是 `member`
- [ ] 关掉 B 的浏览器再打开 → 登录态和项目都还在

---

## 本切片的新坑（每个都真实存在，且不会报错或报错很难懂）

### ① 事务必须用同一个 connection

```js
// ✓ 正确形状
const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  // ... 所有语句都用 conn.query，不能用 pool.query
  await conn.commit();
} catch (err) {
  await conn.rollback();
  throw err;
} finally {
  conn.release();          // ← 漏了这句会要命，见 ②
}
```

**为什么不能用 `pool.query`**：事务是**连接级**的状态。`pool.query` 每次都从池里拿一个连接，下次可能拿到别的。你以为开了事务，实际两条语句跑在两个互不知情的连接上——**事务完全不生效，且不报任何错**。

后果：A 建项目时，如果插成员那步失败，事务本该回滚；因为事务失效，`projects` 里留下一个没有 owner 的孤儿项目——**谁都无权删它、踢人、换码，而它占着所有人的项目列表**。

### ② `conn.release()` 漏了 = 服务假死

`finally` 里不 release，这条连接就永远不回池。mysql2 池默认 `connectionLimit: 10`。
**漏 10 次之后，第 11 个请求会永远挂住**——没有报错、没有超时提示，浏览器转圈，终端一片安静。

这是最难排查的一类故障：代码"看起来在跑"，服务"就是不动了"。

### ③ `ER_DUP_ENTRY` 是朋友，不是错误

C5 里**不要**写成"先 SELECT 查是否已加入，没有就 INSERT"：

```js
// ✗ 有竞态：查完之后、插入之前，另一个请求可能已经插进去了
const [rows] = await pool.query('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?', [...]);
if (rows.length) { /* 已加入 */ } else { /* INSERT */ }
```

正确做法是**直接 INSERT，靠复合主键兜底**，捕获 `ER_DUP_ENTRY`（`err.code === 'ER_DUP_ENTRY'`）当成"已加入"处理。

**为什么**：唯一索引是数据库层面的原子保证。两个人同时点"加入"，两个请求都通过了 SELECT 检查，然后都去 INSERT——**唯一索引会让第二条失败，而应用层的检查不会**。
而且这个设计天然幂等：B 点两次"加入"得到同样的结果，不产生第二条记录、不报错。

**返回 200，不是 409。** 重复加入不是用户做错了什么，不该弹红色报错。

### ④ JOIN 的起点决定了结果集

```sql
-- ✓ 从 project_members 出发：天然只可能返回"我参与的"
SELECT p.id, p.name, p.description, p.invite_code, pm.role,
       (SELECT COUNT(*) FROM project_members m2 WHERE m2.project_id = p.id) AS member_count
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id = ?
ORDER BY p.id DESC
```

如果写成 `FROM projects p ...` 再 `WHERE pm.user_id = ?`，**只要 WHERE 条件漏了或者写错，就会返回所有人的项目**。
从成员表出发，`WHERE pm.user_id = ?` 即使漏了也只会返回重复行、不会泄露别人的数据——**错误的方向变成了"多"，而不是"泄露"**。

> 这就是为什么安全设计偏爱"让错误发生在安全的一侧"。

`member_count` 用相关子查询就够，不用为了性能改成 `GROUP BY`——**这个数据量根本碰不到性能问题**。

### ⑤ `/join` 必须定义在 `/:projectId` 中间件之前

`router.use('/:projectId', requireProjectMember)` **对所有 HTTP 方法生效**。
如果它写在 `router.post('/join', ...)` 前面，那么 `POST /api/projects/join` 会先被它截住，此时 `req.params.projectId` 的值是**字符串 `'join'`**。

后果：中间件去查 `project_id = 'join'` 的成员关系 → 0 行 → 404。
**用户看到的是"邀请码明明是对的，却报项目不存在"**，而你盯着 join 接口的代码看半天也找不出问题——因为问题不在那个函数里。

⚠️ **Express 5 里不能用 `'/:projectId(\\d+)'` 这种内联正则来绕开**（path-to-regexp v8 已移除该语法，会直接报错）。正确解法就是**定义顺序**。

### ⑥ 权限中间件：404 而不是 403

```sql
SELECT pm.role, p.id, p.name
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.project_id = ? AND pm.user_id = ?
```

0 行 → `404 { tip: '项目不存在' }`，并把查到的 `role` 挂到 `req` 上（切片 2 判 owner 要用）。

返回 404 而不是 403 的理由见 `DESIGN.md` §4.2：**403 等于告诉攻击者"这个项目真实存在"**，遍历 ID 就能摸清所有项目。

---

## 完成标准（再说一次）

> **接口写完不算完成。数据真的进了 MySQL、终端没有红字、越权测试真的返回 404，才算完成。**

mock 只准存在于 `api/` 层，模块接口一接通立刻删掉 mock，禁止两套并存。

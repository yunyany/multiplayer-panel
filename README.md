# 团队协作看板

一个类 Trello 的多人协作面板：把项目分类管理、拖拽排序，成员之间实时评论。

- **分类 → 项目**：每个人有自己的一套分类（重要 / 不重要 / 可做可不做），分类和分类里的项目都能拖拽排序
- **多人协作**：用邀请码加入别人的项目，`owner` 管理项目、`member` 参与评论
- **实时评论**：所有成员都能在项目下评论，基于 WebSocket 推送，不用刷新

---

## 功能

| 模块 | 内容 |
|---|---|
| 认证 | 注册 / 登录 / 退出 / 修改密码（bcrypt 存储，JWT 签发） |
| 分类 | 增删改、拖拽排序、标记、批量标记列表内全部项目、每个用户一套（含不可删除的默认分类） |
| 项目 | 增删改、拖拽排序、跨分类移动、标记、邀请码加入、解散（owner）/ 退出（member）、按名称搜索 |
| 成员 | 两级角色（owner / member）、成员列表、移除成员（仅 owner）、退出项目、所有数据按 `project_id` + `user_id` 隔离 |
| 评论 | 发布 / 列表 / 删除，实时推送 |
| 邀请码 | 查看 / 一键复制 / 更换（仅 owner，换完旧码立刻失效） |

---

## 技术栈

**前端**（`Task-manage/`）

```
react 19.2          vite 8 (rolldown)      react-router-dom 7
@reduxjs/toolkit 2  antd 6                 axios
@dnd-kit 6          socket.io-client 4.8
```

开启了 **React Compiler**（`babel-plugin-react-compiler`）—— 因此代码里不手写 `useMemo` / `useCallback`。

**后端**（`server/`）

```
node 24    express 5    mysql2    jsonwebtoken    bcryptjs    socket.io 4.8
```

用 ESM（`"type": "module"`），配置读 `.env`（靠 Node 自带的 `--env-file`，没装 dotenv）。

**数据库**：MySQL 8.0+，InnoDB，`utf8mb4`

---

## 快速开始

### 1. 建库建表

```bash
cd server
npm install
npm run db:init      # 建库 + 建全部 5 张表（可以重复跑）
```

### 2. 配置 `.env`

在 `server/` 下新建 `.env`：

```ini
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的密码
DB_NAME=team_board
JWT_SECRET=随便一串够长的随机字符
```

### 3. 启动

前后端是两个进程，开两个终端：

```bash
# 终端 1
cd server && npm run dev

# 终端 2
cd Task-manage && npm install && npm run dev
```

打开 `http://localhost:5173`。

> 前端通过 Vite 的 proxy 把 `/api` 和 `/socket.io` 转发到 8080，
> 所以**前端代码里所有请求都用相对路径**，不写后端地址 —— 部署时换成 Nginx 转发，前端一行都不用改。

### 4. 自检

```bash
npm run db:inspect   # 在 server/ 下执行：打印所有表、字段、索引、外键、行数
```

改完代码不知道该看哪时，先跑这个 —— **很多 bug 是"代码看着对，但数据库里不是那样"。**

---

## 数据库设计

### ER 关系

```
users ──┬── project_groups      （分类：每个用户一套）
        │
        └── project_members ──── projects   （多对多：谁参与了哪个项目）
                    │
                    └── 同时记录 group_id / position
                        （这个项目在我的哪个分类里、排第几）

projects ──── comments              （评论挂在项目上）
```

### 建表 SQL

```sql
CREATE DATABASE IF NOT EXISTS team_board
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE team_board;

-- 用户
CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 项目
-- ⚠️ 这里【没有】sign。「标记」因人而异，它在 project_members 上（见下面的设计④）
CREATE TABLE projects (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(500) DEFAULT NULL,
  invite_code CHAR(8)      NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invite_code (invite_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 分类：每个用户自己一套
CREATE TABLE project_groups (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(50)  NOT NULL,
  position   INT          NOT NULL,
  is_default TINYINT(1)   NOT NULL DEFAULT 0,   -- 每个用户恰好一行 = 1，不可删
  sign       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_id_user (id, user_id),          -- 只为下面的复合外键服务
  KEY idx_user_pos (user_id, position),
  CONSTRAINT fk_pg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 成员关系：整个权限模型的地基
-- 「我在这个项目里是什么角色」+「我把它放在哪个分类、排第几、标没标记」都在这张表上
CREATE TABLE project_members (
  project_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('owner','member') NOT NULL DEFAULT 'member',
  group_id   INT UNSIGNED NOT NULL,
  position   INT          NOT NULL DEFAULT 0,
  sign       TINYINT(1)   NOT NULL DEFAULT 0,   -- ★ 我自己的标记，不是项目的属性
  joined_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  KEY idx_user (user_id),
  KEY idx_user_group (user_id, group_id, position),
  KEY fk_pm_group (group_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  -- ★ 复合外键：保证「只能把项目放进你自己的分类」，由数据库强制
  CONSTRAINT fk_pm_group   FOREIGN KEY (group_id, user_id)
    REFERENCES project_groups(id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 评论
CREATE TABLE comments (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED  NOT NULL,
  user_id    INT UNSIGNED  NOT NULL,
  content    VARCHAR(1000) NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_time (project_id, created_at),
  CONSTRAINT fk_comments_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 几个刻意的设计

**① `owner_id` 不放在 `projects` 上。**
"谁是 owner"只有 `project_members.role` 一个来源。放两处会出现 `projects.owner_id = 3` 但成员表里 `role='owner'` 是 7 的情况 —— 而这个字段决定的正是**最危险的操作**（删项目、踢人）。不一致不会报错，只会某天表现为"某人删了不该删的项目"。

**② `fk_pm_group` 是复合外键。**
`(group_id, user_id) → project_groups(id, user_id)` 让"把项目放进别人的分类"在**数据库层面不可能**，而不是靠代码记得检查。

⚠️ 它的 `ON DELETE` 不能写 `CASCADE`：删一个分类会把成员行一起删掉，等于**把你从项目里踢出去**。所以删分类必须在事务里先把项目移到默认分类，再删。

**③ "因人而异"的属性放在关系表上。**
`position`（排第几）、`group_id`（放哪个分类）和 `sign`（有没标星）都是**每个人自己的**，所以它们属于 `project_members`，不属于 `projects`。放 `projects` 上是全局共享，两个人会互相覆盖。

**④ `comments` 的索引是 `(project_id, created_at)`。**
查询永远是"某个项目的评论、按时间排"：`project_id` 是等值条件放前面，`created_at` 做排序放后面。不用把 `id` 写进去 —— InnoDB 的二级索引**自动带主键**。

**⑤ 每个用户恰好一个默认分类，`group_id` 是 `NOT NULL`。**
这样前端不需要"未分类"这种假状态。用 `is_default` 标记而不是"第一个分类"—— 因为分类可以拖动排序，用位置推断语义会被排序功能悄悄破坏。

---

## 接口

统一前缀 `/api`。成功直接返回数据，**错误一律是 `{ tip: '给用户看的中文' }`**。

状态码：`400` 参数错 / `401` 未认证 / `403` 角色不足 / `404` 不存在或不属于你 / `409` 冲突 / `500` 兜底。
`401` 且带 `code: 'TOKEN_INVALID'` 才是"登录过期"。

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | 注册（同时创建一个默认分类） |
| POST | `/api/login` | 登录，返回 `{ token, user }` |
| GET | `/api/me` | 当前用户 |
| PUT | `/api/password` | 修改密码 |
| GET | `/api/health` | 健康检查（含数据库连通性） |

### 分类

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/groups` | 我的分类 |
| POST | `/api/groups` | 新建（追加到末尾） |
| PUT | `/api/groups` | 改名 |
| PATCH | `/api/groups/order` | 拖动排序，body `{ ordered_ids: [...] }` |
| PATCH | `/api/groups/:groupId/sign` | 标记，body `{ sign: true/false }` |
| DELETE | `/api/groups/:groupId` | 删除（项目移到默认分类；默认分类不可删） |

### 项目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects` | 我参与的项目（带 `group_id` / `position` / `role` / `sign`） |
| POST | `/api/projects` | 新建，body `{ name, description, group_id }`。**返回结构和 GET 的每一行完全一致** |
| PUT | `/api/projects/:projectId` | 改名 / 改描述（仅 owner） |
| PATCH | `/api/projects/:projectId/sign` | 标记 / 取消，body `{ sign: true/false }`。**任何成员都能标自己那一份** |
| PATCH | `/api/projects/sign` | 批量标记整个分类，body `{ group_id, sign }`。只影响自己的行 |
| PATCH | `/api/projects/place` | 归位与排序，body `{ group_id, ordered_ids: [...] }` |
| POST | `/api/projects/join` | 用邀请码加入，body `{ invite_code }` |
| GET | `/api/projects/:projectId` | 项目详情 |
| DELETE | `/api/projects/:projectId` | **解散项目**（仅 owner）。成员和评论靠外键级联清掉，并广播 `project:deleted` |
| DELETE | `/api/projects/:projectId/members/me` | **退出项目**（member）。只删自己那一行；owner 调用返回 403 |

### 成员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/members` | 成员列表（owner / member 都能看，非成员 404） |
| DELETE | `/api/projects/:projectId/members/:userId` | **移除成员**（仅 owner）。不能移创建者，也不能移自己 |

> ⚠️ `/members/me` 和 `/members/:userId` 是**两个不同的东西**，别看混：
> 前者是「退出」（谁都能退自己），后者是「踢人」（只有 owner）。
> `me` 写死在路径里，所以它在结构上就不可能被拿来踢别人 ——
> 而 `:userId` 来自 URL，少一个 `AND project_id = ?` 就是越权。

### 邀请码

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/:projectId/code` | **更换邀请码**（仅 owner），返回 `{ invite_code }`；旧码立刻失效 |

> **查看邀请码没有单独的接口。** 码已经在 `GET /api/projects` 的每一行里，
> 前端弹窗直接读那个字段。同一份数据只留一个来源，才不会出现两处不一致。

### 评论

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/comments` | 评论列表（按时间正序） |
| POST | `/api/projects/:projectId/comments` | 发评论，body `{ content }` |
| DELETE | `/api/projects/:projectId/comments/:commentId` | 删评论（只能删自己的） |

### WebSocket 事件

| 事件 | 触发 | 载荷 |
|---|---|---|
| `comment:new` | 有人发了评论 | 一条完整评论（字段和 REST 返回的**完全一致**） |
| `comment:deleted` | 有人删了评论 | `{ id }` |
| `project:deleted` | 有人**解散**了项目 | `{ id }`。房间按项目分，所以只有成员收得到 |
| `member:added` | 有人用邀请码加入 | `{ user_id }`，客户端重拉成员列表 |
| `member:removed` | 有人**被移除**，或**自己退出** | `{ user_id }`。收到的人一看 id 是自己 → 说明被踢了 |

> **两类事件的载荷不一样，是刻意的：**
> `comment:new` 带完整对象 —— 它是往列表里**追加一条**，客户端必须能直接渲染。
> `member:added` / `member:removed` 只带 id —— 成员列表是个"整体重拉更省事"的小集合，
> 为了拼出 `username` 再 JOIN 一次不划算。
> 所以前者是**资源型**，后者是**通知型**（收到就重拉）。
>
> ⚠️ 被踢的人也在房间里（房间是 socket 连接时一次性 join 的，退项目不会自动退房），
> 所以他收得到 —— 这正是我们要的：他那边要立刻把项目从列表里去掉、把弹窗关掉。

---

## 实现要点

### 1. 权限：所有接口先回答"你和这个项目是什么关系"

每个涉及项目的请求，第一步都不是取数据，而是**一条 SQL 回答三个问题**：项目存在吗、我是成员吗、我是 owner 还是 member。

```sql
SELECT pm.role, p.id, p.name
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.project_id = ? AND pm.user_id = ?
```

返回 **0 行就是 404**（不是 403）。因为 403 等于告诉攻击者"这个项目真实存在"，遍历 ID 就能摸清所有项目。403 只用在"你已经是成员、但角色不够"的场合。

**非成员一律 404**，让"不存在"和"不属于你"从外部无法区分。

### 2. 拖拽排序：两层 draggable，用"不重叠"而不是"抢"

分类可以左右拖、项目可以在分类间拖。两层 draggable 如果**在几何上重叠**（比如整张卡片都可拖，而卡片里全是项目条目），就只能靠 `stopPropagation` 抢 —— 而被抢的那一边会变得"按下去完全没反应"。

所以：

```
卡片标题栏  → 拖分类（setActivatorNodeRef 挂在标题栏）
项目条目    → 拖项目
```

两者在 DOM 上不是父子关系，各自独立，不需要抢。

另外**碰撞检测按 id 前缀过滤**：拖分类时只和分类比，不然 dnd-kit 会认为你"压在了某个项目上"，`over` 拿到 `project-xx`，而分类重排只认 `group-xx`，于是什么都不会发生。

### 3. 排序的存储：发整个数组，不发"插到谁和谁之间"

```
PATCH /api/groups/order   { ordered_ids: [3, 1, 2] }
```

判断依据不是"哪种更高级"，而是**这个列表有多少人同时改、有多长**：分类只有几条到几十条、只有本人能改 → 整表重写最省事、几乎不可能错。

（看板那种"一列几百张卡、多人同时拖"的场景才需要算邻居位置 + 间隙管理。）

`position` 用稀疏整数（1000 / 2000 / …），中间插一个取中值，不用动别人的行。

### 4. 乐观更新 + 失败回滚

拖拽和发评论都是**先改本地 state（界面立刻变），再发请求**；失败就重新拉一遍真实数据。

```js
const next = arrayMove(group, from, to)
setGroup(next)                    // ① 界面立刻变
try {
    await reorderGroups(next.map(g => g.id))
} catch (err) {
    message.error(err.message)
    getData()                     // ③ 失败：把真实顺序拉回来，别让界面骗人
}
```

注意**不能用 `setGroup(prev => ...)`** —— 那个回调的返回值 React 会拿走，你自己拿不到 `next`，也就没法拿新顺序去发请求。

### 5. 实时：写走 REST，推送走 WebSocket，数据库是真源

```
① 用户发评论 → POST /api/... → 写库
② 写库成功   → io.to(`project-${id}`).emit('comment:new', comment)
③ 别人收到   → 追加到列表
```

**写不放在 WebSocket 上**有三个理由：REST 能用 curl 单独打、能直接复用权限中间件、失败能重试。

三个必须处理的问题：

- **握手鉴权**：浏览器**不能给 WebSocket 设自定义请求头**，`Authorization` 那套在 WS 上直接失效 → token 放 `handshake.auth`，在 `io.use()` 里验
- **回声去重**：自己发的那条会到两次（POST 响应 + 广播），而且**两者没有先后顺序** → 两处走同一个去重入口，按 `id` 判断
- **重连兜底**：断线那几秒别人发的你根本没收到，无从知道漏了哪些 → 重连后**整个重拉**，不做增量同步

**REST 返回的对象结构 == 广播推送的对象结构** —— 否则前端要维护两套状态更新逻辑。

---

## 已知限制

**有意不做的**

- 邀请码一个项目只有一个，没有过期时间（可以更换，换完旧码立刻失效）
- 评论没有楼中楼（回复某条评论）
- 只有 owner / member 两级角色，没有更细的权限
- 没有所有权转让（owner 不能退出项目，只能解散）
- 项目内部没有看板（Trello 那种"项目 → 列 → 卡片"的层级）
- 没有离线编辑、没有 CRDT

**当前实现上的**

- 修改密码后旧 token 在有效期内仍然可用（JWT 无状态，要真解决需要"密码修改时间 + token `iat` 比对"）
- 实时覆盖：评论增删、项目解散、成员加入 / 移除。
  **分类的新建改名排序、项目改名换码、批量标记还没有广播** —— 这些只有本人能改，别人刷新即可
- 成员被移除时，他过去的评论仍然保留（评论查询用 `LEFT JOIN`，作者已退出时不显示角色）
- 被移除的人，socket 仍然留在那个项目的房间里（房间是连接时一次性 join 的，没有退出机制）。
  项目已不在他的列表里，不会有任何数据再推给他，只是服务端多记一条空房间，刷新页面即干净
- 前端没有做代码分割

---

## 目录结构

```
desktop-dsh/
├── server/                      # 后端
│   ├── app.js                   # 组装：中间件 + 挂载路由 + 启动 HTTP server
│   ├── socket.js                # Socket.IO：握手鉴权 + 按项目分房间
│   ├── db.js                    # mysql2 连接池（注意 dateStrings: true）
│   ├── middleware.js            # auth（验 token）+ requireProjectMember（验关系）
│   ├── utils/inviteCode.js      # 邀请码生成 + 建项目（含撞码重试）
│   ├── router/
│   │   ├── auths.js             # 注册 / 登录 / me / 改密码
│   │   ├── groups.js            # 分类
│   │   └── projects.js          # 项目 + 评论
│   └── scripts/
│       ├── init-db.js           # 建库建表
│       ├── migrate-sign.js      # 一次性迁移：sign 从 projects 搬到 project_members
│       └── inspect.js           # 看数据库现状（表 / 字段 / 索引 / 外键 / 行数）
└── Task-manage/                 # 前端
    ├── vite.config.js           # /api 和 /socket.io 的代理
    └── src/
        ├── apis/                # 接口层：页面不直接写 axios
        │   ├── request.js       # axios 实例 + 拦截器（统一错误翻译 + 401 处理）
        │   ├── auth.js / groups.js / projects.js
        ├── hooks/
        │   └── useClickOutside.js   # 点区域外收起（三处在用）
        ├── pages/project/
        │   ├── Projects.jsx     # 面板页：数据、拖拽、搜索、弹窗、评论
        │   ├── Card.jsx         # 分类卡片（拖拽接线 + 三段布局）
        │   ├── ProjectItem.jsx  # 分类里的单个项目条目
        │   ├── CardPreview.jsx  # 拖动时的影子
        │   ├── ProjectSearch.jsx  # 顶部搜索框
        │   ├── ProjectInvite.jsx  # 邀请码：查看 / 复制 / 更换
        │   ├── MemberPanel.jsx    # 成员列表 + 移除成员
        │   └── CardSettings.jsx   # 分类的列表设置
        ├── router/              # 路由表 + 登录守卫
        ├── store/               # Redux：登录态 + localStorage 持久化
        └── utils/
            ├── autoSize.js      # textarea 跟着内容长高
            └── socket.js        # 全站共用的 Socket.IO 连接
```

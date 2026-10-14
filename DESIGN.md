# 团队协作看板 —— 设计文档（阶段 0）

> 状态：**进行中**。已完成 ① 表结构 ② 权限矩阵。
> 待做 ③ 接口清单 ④ WS 事件清单。
> 未确认的决策标了 ⚠️。

---

## 1. 这个项目最本质的变化 

上个项目：每条数据的可见性 = `AND user_id = ?` 一句话搞定（一对一）。
这个项目：可见性变成**关系**，存储在 `project_members` 表里（多对多）。

推论（后面所有设计都由此展开）：

1. 每个接口的**第一步不是取数据，而是回答"你和这个项目是什么关系"**。
2. 权限判断必须写成**一条 SQL**，而不是"先查资源、再查权限"两句（原因见 §4）。
3. 同一份数据会被多人同时改 → 需要**版本号**，这是上个项目完全没有的问题。

---

## 2. 表结构

数据库名建议 `team_board`，字符集 `utf8mb4`，引擎 InnoDB（外键必需）。
`users` 表沿用上个项目，不重做。

### 2.1 projects

```sql
CREATE TABLE projects (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100)    NOT NULL,
  description VARCHAR(500)    NULL,
  invite_code CHAR(8)         NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invite_code (invite_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**决策：这张表故意没有 `owner_id`。** 理由见 §3.1。

### 2.2 project_members（整个权限模型的地基）

```sql
CREATE TABLE project_members (
  project_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('owner','member') NOT NULL DEFAULT 'member',
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  KEY idx_user (user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**⚠️ `KEY idx_user (user_id)` 不是可选项。** 复合主键 `(project_id, user_id)` 的索引最左前缀是 `project_id`，所以 `WHERE user_id = ?`（"列出我参与的项目"）**用不上主键索引**，会全表扫描。
这张表有 idx_user，查询走索引；没有，人一多就慢。删掉 idx_user 跑 `EXPLAIN` 能直接看到 `type: ALL`。

### 2.3 lists（看板的列）

```sql
CREATE TABLE lists (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id INT UNSIGNED NOT NULL,
  title      VARCHAR(100) NOT NULL,
  position   INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_pos (project_id, position),
  CONSTRAINT fk_lists_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.4 cards

```sql
CREATE TABLE cards (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  list_id     INT UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT NULL,
  position    INT NOT NULL,
  version     INT UNSIGNED NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_list_pos (list_id, position),
  CONSTRAINT fk_cards_list FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**决策：cards 故意不存 `project_id`。** 理由见 §3.2。

级联链：`projects` → `lists` → `cards`，删项目会一路清空到卡片，不需要写一行删除卡片的代码。

---

## 3. 关键设计决策与理由

### 3.1 为什么不给 projects 放 owner_id

**方案 A**：`projects.owner_id` 记录谁是 owner，`project_members` 只存普通成员。
**方案 B（本设计采用）**：`project_members.role` 是"谁是 owner"的唯一来源。

选 B 的唯一理由：**单一数据源**。

方案 A 出现了两个事实来源。它们可能不一致：`projects.owner_id = 3`，但 `project_members` 里 `role='owner'` 的那行是 `user_id=7`。
而"谁是 owner"决定的正是**最危险的操作**（删项目、踢人）。这种不一致不会报错，只会在某天表现为"某人删了不该删的项目"。

代价：查 owner 要 JOIN 一次。但这个 JOIN 本来就要做——判断请求者是不是项目成员，查的就是同一张表，加一个 `role` 字段是免费的。
另外"每个项目恰好一个 owner"这个约束数据库无法直接表达，改由代码保证（建项目时插一行 owner；转让所有权时在一个事务里换两行的 role）。

### 3.2 为什么 cards 不存 project_id

存了的好处：卡片操作鉴权少一跳 JOIN。
存的代价：`cards.project_id` 和 `cards.list_id → lists.project_id` 是同一事实的两份拷贝。卡片一旦跨项目移动（正常流程不允许，但代码有 bug 时会发生），二者就不一致。

不存，鉴权多一跳；存了，多一个可能不一致的字段。**这个问题上"少一跳 JOIN"不值这份风险。**
代价可接受：反正鉴权本来就要 JOIN `project_members`。

### 3.3 position 用稀疏整数，且不要加 UNIQUE

取值 `1000, 2000, 3000...`，插到中间取中值，插入永远只改一行。
间隙耗尽（比如 1000 和 1001）时整列重编号为 `1000, 2000, 3000...`——**这一步是多行更新，必须开事务**。

**不要给 position 加 UNIQUE。** 重编号时行的 position 是逐条改的，中途会出现两行同值；有唯一约束就会在重编号过程中报 `ER_DUP_ENTRY`，而重编号本意是修数据，却先把自己弄崩了。
排序一律写 `ORDER BY position, id`（加 id 是为了同值时顺序稳定，否则 MySQL 返回顺序无保证）。

### 3.4 version 用整数，不要用 updated_at

乐观锁的判据是 `UPDATE ... WHERE id = ? AND version = ?`，影响行数为 0 就是冲突。

**不能用 `updated_at` 当版本号**：`DATETIME` 默认精度是**秒**。同一秒内的两个请求，后一个读到的 `updated_at` 和前一个写入的完全相同 → `WHERE updated_at = ?` 命中 → 更新被接受，**前一个人的修改被静默覆盖且不报任何错**。
`version` 是自增整数，不存在这个问题。

### 3.5 邀请码放 projects 表，不单开一张表

MVP 一个项目只需要一个长期有效的码。单开 `project_invites` 表支持多码、过期、撤销——那是后续迭代的事。
代价：**码一旦泄露就永久可用**（除非 owner 换码，换码 = 覆盖这一列）。写进"已知限制"。

生成必须用 `crypto.randomBytes`，**不能用 `Math.random`**（可预测）。字符表建议去掉易混的 `0 O 1 I L`。
`uk_invite_code` 唯一索引保证不重复，插入撞车时捕获 `ER_DUP_ENTRY` 重试。

---

## 4. 权限矩阵

四种身份：**owner** / **member** / **非成员（已登录）** / **未登录**。

### 4.1 矩阵

| 操作 | owner | member | 非成员 | 未登录 |
|---|---|---|---|---|
| 查看项目 / 看板 | ✓ | ✓ | **404** | 401 |
| 查看成员列表 | ✓ | ✓ | **404** | 401 |
| 重命名项目 | ✓ | ✓ | **404** | 401 |
| 建 / 改 / 删 列表 | ✓ | ✓ | **404** | 401 |
| 建 / 改 / 删 / 移动 卡片 | ✓ | ✓ | **404** | 401 |
| 查看邀请码 | ✓ | ✓ | **404** | 401 |
| 用邀请码加入 | — | — | ✓ | 401 |
| 移除成员 | ✓ | **403** | 404 | 401 |
| 更换邀请码 | ✓ | **403** | 404 | 401 |
| 删除项目 | ✓ | **403** | 404 | 401 |
| 退出项目 | **403**（owner 不能退） | ✓ | 404 | 401 |

### 4.2 非成员一律 404，不是 403（安全决策，不是风格问题）

如果对"项目存在但你不是成员"返回 403，就等于**告诉攻击者这个项目真实存在**。
攻击者遍历 `/api/projects/1,2,3...`，靠 404/403 的差异就能把所有项目 ID 和它们的存续关系摸出来。

返回 404 时，"不存在"和"不属于你"无法区分，这条信息渠道就断掉了。
这跟你上个项目的约定是同一个原则——`404 资源不存在或不属于你`——只是在上个项目里它没这么关键（因为只有你自己能访问）。

403 只用在**你已经是成员、但角色不够**的场合（member 想删项目）。这时项目对你本来就不保密，返回 403 不泄露任何东西。

### 4.3 权限分配的原则：只有不可逆的操作才需要 owner

删除项目、移除成员、换邀请码是 owner 独有；重命名、建列表、改卡片，member 都能做。

理由：重命名是可逆的，收权限只会让协作变烦，并不能真的保护数据。
把权限收得过紧，是新手常见的"看起来更安全"的错误——它牺牲了可用性，却没换来安全。

### 4.4 owner 不能退出项目

如果 owner 能直接退出，项目就会变成一个没有任何 owner 的孤儿：**谁都无权删它、无权踢人、无权换码，而它占据着项目列表**。
MVP 里 owner 只能"删除项目"，转让所有权留到后续。

---

## 5. 鉴权写成一条 SQL（本项目最重要的实现模式）

### 5.1 模式

不要写成两句：

```js
// ✗ 先查资源，再查权限 —— 两次查询之间有竞态，且中间态可能被利用
const [rows] = await pool.query('SELECT * FROM cards WHERE id = ?', [cardId]);
if (!rows.length) return res.status(404)...
const [m] = await pool.query('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [rows[0].project_id, uid]);
if (!m.length) return res.status(404)...
```

写成一句：**鉴权查询返回 0 行 = 404，返回 1 行 = 通过，且顺带把后续要用的数据带回来。**

### 5.2 ⚠️ 一个必须避开的越权陷阱

为了让中间件能像上个项目的 `auth` 一样统一挂载，URL 设计成嵌套的：

```
/api/projects/:projectId/lists
/api/projects/:projectId/lists/:listId/cards
/api/projects/:projectId/cards/:cardId
```

好处：`router.use('/:projectId', auth, requireProjectMember)` 一处挂载，**新增接口不可能漏鉴权**（沿用你上个项目最得意的那个设计）。

**但这个嵌套带来一个陷阱**：URL 里 `projectId` 和 `cardId` 是两个独立参数，前端可以传任意组合。
如果鉴权只查了 `projectId`：

```sql
-- ✗ 只验证了"你是这个项目的成员"
SELECT role FROM project_members WHERE project_id = ? AND user_id = ?
```

随后用 `cardId` 去 UPDATE：

```sql
-- ✗ 这个 cardId 可能属于别人的项目
UPDATE cards SET title = ? WHERE id = ?
```

**攻击方式**：传自己的 `projectId`（鉴权通过）+ 别人的 `cardId`（照改不误）。**鉴权查的是项目，改的是卡片，这两者从头到尾没有被关联起来。**

正确写法——一条查询同时绑定 `cardId`、`projectId`、`userId` 三者：

```sql
SELECT c.id, c.list_id, c.version, l.project_id, pm.role
FROM cards c
JOIN lists l ON l.id = c.list_id
JOIN project_members pm ON pm.project_id = l.project_id
WHERE c.id = ? AND l.project_id = ? AND pm.user_id = ?
```

0 行 → 404。`AND l.project_id = ?` 这个条件就是"两者必须一致"，缺了它漏洞就成立。

这跟你上个项目踩的 `AND`/`OR` 括号坑是同一类问题：**多条件查询里，少一个条件不会报错，只会静默地放过不该放过的东西。**

---

## 6. 接口清单（草案，待补全）

统一前缀 `/api`（只在 `app.js` 加一次）。错误一律 `{ tip: '中文' }`。
状态码沿用：400 参数错 / 401 未认证 / 403 角色不足 / 404 不存在或不属于你 / 409 冲突 / 500 兜底。
`401 + code:'TOKEN_INVALID'` 才是登录过期。

```
POST   /api/projects                      建项目（同时插入 owner 行）
GET    /api/projects                      我参与的项目列表
GET    /api/projects/:projectId           项目详情
PATCH  /api/projects/:projectId           重命名
DELETE /api/projects/:projectId           删除（owner）
POST   /api/projects/join                 用邀请码加入
GET    /api/projects/:projectId/code      查看邀请码
POST   /api/projects/:projectId/code      更换邀请码（owner）
GET    /api/projects/:projectId/members   成员列表
DELETE /api/projects/:projectId/members/:userId   移除成员（owner）
DELETE /api/projects/:projectId/members/me        退出项目
GET    /api/projects/:projectId/board     整个看板（一次 JOIN 查完）
... 列表 / 卡片的 CRUD 与移动
```

**`GET /board` 一次 JOIN 查完**：不要"先查 lists，再对每个 list 查一次 cards"——那是 N+1，10 个列就是 11 次查询。一条 JOIN 查出来，在 JS 里按 `list_id` 分组。

---

## 7. WS 事件清单（草案，阶段 4 才实现，阶段 0 只需定形）

硬性规则：**REST 返回的对象结构 == WS 广播事件里的对象结构**。否则前端要维护两套状态更新逻辑。

事件名（`board:xxx`）与需广播的接口一一对应：列表增删改移、卡片增删改移、成员加入退出、项目重命名删除。

要处理的四件事（阶段 4 展开）：
1. 房间：按 `projectId` 分房
2. 握手鉴权：浏览器 WebSocket 不支持自定义 header，token 走 Socket.IO 的 `auth` 字段，在 `io.use()` 里验
3. 回声去重：乐观更新 + 自己发的广播会重复应用
4. 重连兜底：重连后**重新拉一次 `/board`**，不做增量同步

---

## 8. 项目分类（后加的一层，实现排在切片 2 之后）

### 8.1 名词先统一（重要）

`card` 这个词在本项目已经有三个意思，必须区分：

| 叫什么 | 是什么 | 出现位置 |
|---|---|---|
| **分类**（`group`） | "重要任务 / 不重要 / 可做可不做" 这种横向容器 | 项目列表页，**每人自己一套** |
| **项目**（`project`） | `projects` 表里的一行 | 分类里面 |
| **卡片**（`card`） | 看板里的任务卡片，`cards` 表 | 项目内部，切片 2 才做 |

⚠️ **数据库表名绝不能叫 `card`**，CSS 类名也把 `.card` 让给看板卡片。分类用 `.group`。

### 8.2 关键判断：属性"因人而异"就属于关系表

- **顺序**：A 把"毕业设计"排第一，B 想排最后 → 因人而异 → `project_members.position`
- **分类**：A 分到"重要"，B 分到"可做可不做" → 因人而异 → `project_members.group_id`

分类本身（"重要"这个名字、它在横向上的位置）也是每人的 → 自己的表，挂 `user_id`。

**放 `projects` 表是错的**：那是全局共享，两个人会互相覆盖。

### 8.3 DDL

```sql
-- 分类：每人一套
CREATE TABLE project_groups (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(50)  NOT NULL,
  position   INT          NOT NULL,
  is_default TINYINT(1)   NOT NULL DEFAULT 0,   -- 每个用户恰好一行 = 1
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_id_user (id, user_id),        -- 只为下面的复合外键服务
  KEY idx_user_pos (user_id, position),
  CONSTRAINT fk_pg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- project_members 加两列
ALTER TABLE project_members
  ADD COLUMN group_id INT UNSIGNED NOT NULL,  -- 一定有分类（见 8.6）
  ADD COLUMN position INT NOT NULL DEFAULT 0,
  ADD KEY idx_user_group (user_id, group_id, position),
  ADD CONSTRAINT fk_pm_group FOREIGN KEY (group_id, user_id)
      REFERENCES project_groups(id, user_id);
```

### 8.6 默认分类：消灭 NULL

**不变量：每个用户恰好有一个 `is_default = 1` 的分类，`group_id` 永不为 NULL。**

| 时机 | 做什么 |
|---|---|
| 注册成功 | 建一个「未分类」，`is_default = 1`（和 users 插入同一个事务） |
| 用邀请码加入项目 | 放进该用户的默认分类（`WHERE user_id = ? AND is_default = 1`） |
| 删除分类 | 先把里面的项目**移到默认分类**，再删。同一事务 |
| 删除默认分类本身 | **拒绝**（400）。这是唯一的特殊规则 |

**为什么用 `is_default` 标记，而不是"第一个分类"**：
分类是可以拖动排序的。如果默认 = `position` 最小的那个，用户把别的分类拖到最前面，
**默认分类就悄悄换人了** —— 加进来的项目跑去另一个分类，而且不报错。

**收益**：`group_id` 可以是 `NOT NULL`，前端不需要"未分类"分支，`projects[g.id]` 永远有值。
**代价**：一条规则（不能删默认分类）+ 注册时多一次 INSERT。

> 通用原则：**假状态越少，bug 越少。**
> "未分类"本来就是个分类，那就让它当一个真分类，别让它当一种特例。

### 8.4 那个复合外键是干什么的

`FOREIGN KEY (group_id, user_id) REFERENCES project_groups(id, user_id)` 保证
**你只能把项目放进你自己的分类** —— 数据库层面强制，不靠代码自觉。

但它外键的 `ON DELETE` 不能乱写：

| 写法 | 后果 |
|---|---|
| `ON DELETE SET NULL` | 报错。它会把外键的**两列都置空**，而 `user_id` 是主键的一部分、NOT NULL |
| `ON DELETE CASCADE` | **灾难**。删分类会把这批 `project_members` 行一起删掉 = 把你从项目里踢出去 |
| 不写（默认 RESTRICT）| 可以，但分类下有项目时删不掉，需要应用层先处理 |

所以删分类必须在事务里手动先置空：

```js
await conn.beginTransaction()
await conn.query('UPDATE project_members SET group_id = NULL WHERE user_id = ? AND group_id = ?', [uid, gid])
await conn.query('DELETE FROM project_groups WHERE id = ? AND user_id = ?', [gid, uid])
await conn.commit()
```

> 记一条：**`ON DELETE CASCADE` 在多对多关系表上经常是错的。**
> 它看起来省事，实际语义是"删掉父行，把这些关系也删掉"，
> 而关系表的行往往代表"某人参与某事"，删掉 = 剥夺权限。

### 8.5 接口

```
GET    /api/groups                     我的分类（含每个分类里的项目，一次 JOIN 查完）
POST   /api/groups                     新建分类
PATCH  /api/groups/:groupId            改名 / 换位置
DELETE /api/groups/:groupId            删分类（项目变成未分类，不删项目）
PATCH  /api/groups/order               分类左右排序
PATCH  /api/projects/:projectId/place  把项目放进某分类 / 在分类内排序
```

**顺序用「发整个数组」而不是「发邻居」：**

| | 发邻居（看板用） | 发整个顺序（这里用） |
|---|---|---|
| 改动量 | O(1) | O(n) |
| 复杂度 | 位置算法 + 间隙耗尽 + 事务 | 一个 for 循环 |

判断依据不是"哪个高级"，是**这个列表有多少人同时改、有多长**。
项目列表 n 只有几条到几十条、且只有本人能改 → 整表重写最省事、几乎不可能错。
等切片 3 做看板（一列几百张卡、多人同时拖）才轮到位置算法上场。

**越权防护**：`PATCH .../place` 的每条 UPDATE 都带 `AND user_id = ?`。
传别人的 projectId 进来也没用 —— `user_id` 不匹配，影响 0 行。

⚠️ `router.patch('/order', ...)` 必须定义在 `router.use('/:groupId', ...)` **之前**（老坑）。

---

## 9. 待确认

| # | 事项 | 我的默认 |
|---|---|---|
| 1 | 是否用 TypeScript | 阶段 0 不受影响，阶段 1 开始前必须定 |
| 2 | position 稀疏整数 + 偶尔重编号 | 采用 |
| 3 | 非成员返回 404 | 采用 |
| 4 | owner 不能退出项目 | 采用 |
| 5 | 邀请码放 projects 表 | 采用 |

---

## 10. 已知限制（MVP 有意不做，写进 README）

- 邀请码永久有效，一个项目只有一个码
- 卡片只有标题 + 描述，无评论 / 附件 / 标签 / 截止日期 / 指派
- 无所有权转让（owner 不能退出）
- 注释掉用户注销的级联删除：`fk_pm_user` 是 `ON DELETE CASCADE`，删用户会让项目可能失去 owner。MVP 无注销功能，属潜在问题
- 无离线编辑、无 CRDT
- 无操作审计日志

import express from 'express'
import auth, { requireProjectMember } from '../middleware.js'
import { makeInviteCode, insertProject } from '../utils/inviteCode.js'
import pool from '../db.js'

const router = express.Router()

router.use(auth)

// 建项目
router.post('/', async (req, res) => {
    // ── 先取参数、先校验 ──
    // 参数不对的请求不该去借连接（池只有 10 条）
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null
    const groupId = req.body?.group_id

    if (!name) {
        return res.status(400).json({ tip: '标题不可为空' })
    }
    if (name.length > 100) {
        return res.status(400).json({ tip: '标题不能超过 100 个字符' })
    }
    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({ tip: '请选择分类' })
    }

    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()

        const { inviteCode, projectId } = await insertProject(conn, name, description)

        // ★ 放进这个分类的末尾
        // ⚠️ MAX 的作用范围必须是 user_id + group_id 两个条件。
        //    漏掉 group_id，位置会在「所有分类之间」连续排 —— 不报错，只是数字越来越大。
        const [[{ nextPos }]] = await conn.query(
            `SELECT COALESCE(MAX(position), 0) + 1000 AS nextPos
             FROM project_members
             WHERE user_id = ? AND group_id = ?`,
            [req.user.id, groupId]
        )

        // 第二条不成功的话，第一条就会变成无主的数据，所以先在连接里进行操作，都完成后就提交
        await conn.query(
            `INSERT INTO project_members (project_id, user_id, role, group_id, position)
             VALUES (?, ?, 'owner', ?, ?)`,
            [projectId, req.user.id, groupId, nextPos]
        )

        await conn.commit()

        // ★ 返回结构和 GET /projects 的每一行完全一致
        //    （同一个资源，不管从哪个接口出来，字段名和数量都要一样）
        res.status(201).json({
            project: {
                id: projectId,
                name,
                description,
                invite_code: inviteCode,
                group_id: groupId,
                position: nextPos,
                role: 'owner'
            }
        })
    }
    catch (err) {
        await conn.rollback()

        // ★ 传了不存在的 / 别人的分类 → 复合外键 (group_id, user_id) 会拦下
        //    这里不用额外查一次，数据库已经保证了"只能放进自己的分类"
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(404).json({ tip: '分类不存在' })
        }

        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
    finally {
        conn.release()
    }
})

// 搜索我参与过的项目
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.id, p.name, p.description, p.invite_code, p.created_at,p.sign,
                    pm.role, pm.group_id, pm.position
             FROM project_members pm
             JOIN projects p ON p.id = pm.project_id
             WHERE pm.user_id = ?
             ORDER BY pm.group_id, pm.position, p.id`,
            [req.user.id]
        )

        res.status(200).json({ projects: rows })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
})

// 用邀请码加入项目
router.post('/join', async (req, res) => {
    const conn = await pool.getConnection()
    try {
        // ⚠️ 字段名必须和前端发的对得上（前端 apis/projects.js 发的是 invite_code）
        const inviteCode = typeof req.body?.invite_code === 'string' ? req.body.invite_code.trim() : ''

        if (!inviteCode) {
            return res.status(400).json({ tip: '邀请码不可为空' })
        }

        await conn.beginTransaction()

        const [rows1] = await conn.query(
            'SELECT id FROM projects WHERE invite_code = ?',
            [inviteCode]
        )

        if (rows1.length === 0) {
            await conn.rollback()
            return res.status(404).json({ tip: '邀请码无效' })
        }

        const projectId = rows1[0].id

        // 找到我的默认分类（DESIGN.md §8.6：邀请来的项目都放这里）
        const [defRows] = await conn.query(
            'SELECT id FROM project_groups WHERE user_id = ? AND is_default = 1',
            [req.user.id]
        )
        if (defRows.length === 0) {
            await conn.rollback()
            console.error(`user ${req.user.id} 没有默认分类`)
            return res.status(500).json({ tip: '账号数据异常，请联系管理员' })
        }
        const groupId = defRows[0].id

        const [[{ nextPos }]] = await conn.query(
            `SELECT COALESCE(MAX(position), 0) + 1000 AS nextPos
             FROM project_members
             WHERE user_id = ? AND group_id = ?`,
            [req.user.id, groupId]
        )

        // ★ 不用"先查再加入"：直接插，靠复合主键 (project_id, user_id) 兜底。
        //    唯一索引是数据库层面的原子保证，应用层的"先查再插"有竞态。
        try {
            await conn.query(
                `INSERT INTO project_members (project_id, user_id, role, group_id, position)
                 VALUES (?, ?, 'member', ?, ?)`,
                [projectId, req.user.id, groupId, nextPos]
            )
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                await conn.rollback()
                return res.status(409).json({ tip: '已经加入当前项目组' })
            }
            throw err
        }

        await conn.commit()
        res.status(200).json({ ok: true })
    }
    catch (err) {
        await conn.rollback()
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
    finally {
        conn.release()
    }
})


// ══════════════════════════════════════════════════════════════
// 把一批项目放进某个分类，并按数组顺序排好
//
// 一个接口同时管两件事：
//   分类内排序 → ordered_ids 是重排后的完整列表
//   跨分类移动 → ordered_ids 是目标分类的新列表（包含刚搬过来的那个）
// 所以不用为「跨分类」再写一个接口。
//
// 发整个列表而不是「插到谁和谁之间」，理由和 /groups/order 一样：
// 你自己的项目没几条、也只有本人能改，整表重写最省事也最不容易错。
//
// ⚠️ 路径 '/place' 是单段路径，必须定义在 router.use('/:projectId', ...) 之前。
//    写在后面的话会被 :projectId 截住，projectId 变成字符串 'place'
//    → 中间件去查 project_id = 'place' 的成员关系 → 0 行 → 404。
// ══════════════════════════════════════════════════════════════
router.patch('/place', async (req, res) => {
    const groupId = Number(req.body?.group_id)
    const raw = req.body?.ordered_ids

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({ tip: '参数错误' })
    }
    if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ tip: '参数错误' })
    }

    const ids = raw.map(Number)
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
        return res.status(400).json({ tip: '参数错误' })
    }

    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()

        for (let i = 0; i < ids.length; i++) {
            const [r] = await conn.query(
                `UPDATE project_members SET group_id = ?, position = ?
                 WHERE user_id = ? AND project_id = ?`,
                [groupId, (i + 1) * 1000, req.user.id, ids[i]]
            )

            // 和 /groups/order 一样：WHERE 带了 user_id 就改不到别人的，
            // 但不检查影响行数的话，"传了别人的项目 id"会静默跳过，
            // 结果是位置改了一半 —— 不报错，但顺序是错的。
            if (r.affectedRows === 0) {
                await conn.rollback()
                return res.status(404).json({ tip: '项目不存在' })
            }
        }

        await conn.commit()
        return res.json({ ok: true })
    }
    catch (err) {
        await conn.rollback()

        // 复合外键 (group_id, user_id) 会拦下「放进别人的分类」
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(404).json({ tip: '分类不存在' })
        }

        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
    finally {
        conn.release()
    }
})


// ↓↓↓ 这一行之后的所有接口，都自动带上"必须是该项目成员"的检查 ↓↓↓
// ⚠️ 它只对「路径里有 :projectId」的路由生效。
//    路径写成 '/' 的话中间件根本不会跑，req.membership 就是 undefined。
router.use('/:projectId', requireProjectMember)

//标记项目
router.patch('/:projectId/sign',async (req,res)=>{
    try {
        // sign 是「项目」的属性（全局的），按你定的规则 member 不能改项目
        if (req.membership.role !== 'owner') {
            return res.status(403).json({ tip: '只有创建者能标记项目' })
        }

        const { sign } = req.body
        if (typeof sign !== 'boolean') {
            return res.status(400).json({ tip: '参数错误' })
        }

        // id 取自 req.membership（源头是 URL 参数），不从 body 取
        await pool.query(
            'UPDATE projects SET sign = ? WHERE id = ?',
            [sign ? 1 : 0, req.membership.projectId]
        )
        return res.json({ ok: true })
    } catch (err) {
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
})

// 修改项目
// ★ 路径带 :projectId —— 上面的中间件才会执行，req.membership 才有值
router.put('/:projectId', async (req, res) => {
    try {
        if (req.membership.role !== 'owner') {
            return res.status(403).json({ tip: '只有创建者能修改项目' })
        }

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
        const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null

        if (!name) {
            return res.status(400).json({ tip: '项目名不能为空' })
        }
        if (name.length > 100) {
            return res.status(400).json({ tip: '项目名不能超过 100 个字符' })
        }

        // ★ projectId 一律取自 req.membership（它的源头是 URL 参数，经过中间件验证）
        //    绝不能从 req.body 里取 —— body 是客户端随便传的，
        //    那样会出现"验的是 A 项目、改的是 B 项目"的越权（DESIGN.md §5.2）
        await pool.query(
            'UPDATE projects SET name = ?, description = ? WHERE id = ?',
            [name, description, req.membership.projectId]
        )

        res.json({ ok: true })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
})

// 项目详情
router.get('/:projectId', async (req, res) => {
    try {
        // req.membership 是 requireProjectMember 查出来的，这里直接用，不再查一遍。
        // 这就是「一次查询解决多件事」的收益。
        return res.json({ project: req.membership })
    } catch (err) {
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
})

export default router

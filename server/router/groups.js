import express from "express";
import auth from "../middleware.js";
import pool from "../db.js";

const router = express.Router()
router.use(auth)

// 我的分类
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query(`
        SELECT id, title, position,is_default,sign
        FROM project_groups
        WHERE user_id = ?
        ORDER BY position, id
            `, [req.user.id])

        res.status(200).json({ groups: rows })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
})

// 新建分类
router.post('/', async (req, res) => {
    try {
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
        if (!title) {
            return res.status(400).json({ tip: "标题不可为空" })
        }
        await pool.query(`
            INSERT INTO project_groups (user_id, title, position)
            SELECT ?, ?, COALESCE(MAX(position), 0) + 1000
            FROM project_groups
            WHERE user_id = ?
            `, [req.user.id, title, req.user.id])

        res.status(201).json({ ok: true })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
})

// ══════════════════════════════════════════════════════════════
// 分类排序（拖拽后调用）
//
// 设计决定：发「整个新顺序」的 id 数组，不发「邻居」。
//
//   发邻居（插到 A 和 B 之间）→ 要算中点、要处理间隙耗尽 → 那是看板才需要的
//   发整个数组             → 按下标重写，一个 for 循环
//
// 判断依据不是「哪个高级」，是「这个列表有多少人同时改、有多长」：
// 分类只有几条到几十条、且只有本人能改 → 整表重写最省事、几乎不可能错。
//
// ⚠️ 这个路径必须定义在所有 '/:groupId' 之前。
//    Express 按定义顺序匹配，写在后面的话，'order' 会被当成 :groupId 的值。
//    （现在 PATCH 只有 '/:groupId/sign' 是两段路径，暂时不会撞，
//      但以后你加一个 PATCH '/:groupId' 就会踩到 —— 所以现在就放前面。）
// ══════════════════════════════════════════════════════════════
router.patch('/order', async (req, res) => {
    const raw = req.body?.ordered_ids

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
                'UPDATE project_groups SET position = ? WHERE id = ? AND user_id = ?',
                [(i + 1) * 1000, ids[i], req.user.id]
            )

            // ★ 这个检查不能省。
            //   WHERE 带了 user_id —— 别人的分类改不到（这是对的）。
            //   但如果不检查影响行数，"传了别人的 id"就会静默跳过，
            //   结果是位置改了一半 —— 不报错，但顺序是错的。
            if (r.affectedRows === 0) {
                await conn.rollback()
                return res.status(404).json({ tip: '分类不存在' })
            }
        }

        await conn.commit()
        return res.json({ ok: true })
    }
    catch (err) {
        await conn.rollback()
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
    finally {
        conn.release()
    }
})

// 删除分类
router.delete('/:groupId', async (req, res) => {
    const groupId = Number(req.params.groupId)
    if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(404).json({ tip: '分类不存在' })
    }

    const conn = await pool.getConnection()

    try {
        await conn.beginTransaction()
        // ★ 用一条 SQL 同时确认"是我的"和"是不是默认的"
        const [rows] = await conn.query(
            'SELECT id, is_default FROM project_groups WHERE id = ? AND user_id = ?',
            [groupId, req.user.id]
        )
        if (rows.length === 0) {
            await conn.rollback()
            return res.status(404).json({ tip: '分类不存在' })
        }
        if (rows[0].is_default === 1) {
            await conn.rollback()
            return res.status(400).json({ tip: '默认分类不能删除' })
        }

        const [[defGroup]] = await conn.query(
            'SELECT id FROM project_groups WHERE user_id = ? AND is_default = 1',
            [req.user.id]
        )

        // ★ 必须放在 DELETE 之前 —— 否则外键会拦下删除（DESIGN.md §8.4）
        await conn.query(
            'UPDATE project_members SET group_id = ?, position = position + 100000 WHERE user_id = ? AND group_id = ?',
            [defGroup.id, req.user.id, groupId]
        )

        await conn.query('DELETE FROM project_groups WHERE id = ? AND user_id = ?', [groupId, req.user.id])

        await conn.commit()
        return res.json({ ok: true })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
    finally {
        conn.release()
    }
})

// 修改分类（只改名字）
//
// ★ 这里不碰 sign —— sign 有自己独立的接口 PATCH /:groupId/sign
//
//   原来这里是无条件 `set title = ?, sign = ?`。调用方只传 title 时，
//   body 里没有 sign → 解构出来是 undefined → mysql2 把 undefined 转成 NULL
//   → 列是 NOT NULL → ER_BAD_NULL_ERROR。
//
//   ⚠️ 反过来说，这个 NOT NULL 救了命：如果 sign 允许 NULL，
//      那"改个名字"就会把星标悄悄清掉 —— 不报错，只是数据没了。
router.put('/', async (req, res) => {
    const { title, groupId } = req.body

    const t = typeof title === 'string' ? title.trim() : ''
    if (!t) {
        return res.status(400).json({ tip: '标题不可为空' })
    }
    if (t.length > 50) {
        return res.status(400).json({ tip: '标题不能超过 50 个字符' })
    }

    const gid = Number(groupId)
    if (!Number.isInteger(gid) || gid <= 0) {
        return res.status(404).json({ tip: '分类不存在' })
    }

    try {
        // 参数顺序和占位符一一对应：[title, user_id, id]
        // user_id 放在 SQL 里做隔离，不靠代码记得检查
        const [result] = await pool.query(`
            update project_groups set title = ?
            where user_id = ? and id = ?
            `, [t, req.user.id, gid])

        if (result.affectedRows === 0) {
            return res.status(404).json({ tip: '分类不存在' })
        }
        // 改一个已有的资源是 200，不是 201
        res.json({ ok: true })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
})

// 标记分类
router.patch('/:groupId/sign', async (req, res) => {
    try {
        const sign = req.body.sign
        const groupId = Number(req.params.groupId)

        if (!Number.isInteger(groupId) || groupId <= 0) {
            return res.status(404).json({ tip: '分类不存在' })
        }
        if (typeof sign !== 'boolean') {
            return res.status(400).json({ tip: '参数错误' })
        }

        // sign 传的是「目标值」而不是「切换」——
        // 目标值是幂等的：请求重试、双击都不会把状态翻错
        const [result] = await pool.query(`
            update project_groups set sign = ? 
            where user_id = ? and id = ?
            `, [sign ? 1 : 0, req.user.id, groupId])

        if (result.affectedRows === 0) {
            return res.status(404).json({ tip: '分类不存在' })
        }

        res.json({ ok: true })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
})

export default router
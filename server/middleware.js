import jwt from 'jsonwebtoken'
import pool from './db.js'


/**
 * 认证中间件：检查请求头里的 token 有没有效
 *
 * 【什么是 Express 中间件】
 * 签名固定是 (req, res, next) 的函数。用法：
 *     app.get('/api/me', auth, 处理函数)
 * 请求会先流经 auth，只有 auth 放行了，才轮到后面的处理函数。
 * 所以中间件就是"关卡"，可以串很多个：app.get(路径, 关卡1, 关卡2, 处理函数)
 */
const auth = (req, res, next) => {
    // 约定的传法：前端把 token 放在请求头里，格式是 HTTP 标准
    //     Authorization: Bearer eyJhbGciOi...
    // 注意 'Bearer ' 结尾有一个空格，总共 7 个字符，slice(7) 就是把前缀切掉取 token 本体
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''

    // 情况一：压根没带 token —— 就是没登录
    // 这里必须 return，否则代码会继续往下走到 verify，白白抛一次异常
    if (!token) {
        return res.status(401).json({ tip: '未登录', code: 'TOKEN_INVALID' })
    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        req.user = payload

        next()
    } catch (err) {
        // 情况二：token 被篡改 / 已过期 / 格式不对
        // 统一返回 401，前端看到 401 就知道该把用户请回登录页了。
        // 不给用户看具体是哪种错（防止有人靠错误信息试探）
        return res.status(401).json({ tip: '登录已过期，请重新登录', code: 'TOKEN_INVALID' })
    }
}

/**
 * 项目成员中间件：判断「当前登录用户」和「URL 里的项目」是什么关系
 *
 * 【和 auth 的分工】
 *   auth                  —— 回答"你是谁"，依据是 token（有签名，伪造不了）
 *   requireProjectMember  —— 回答"你和这个项目什么关系"，依据是数据库现查
 *
 * 【为什么关系必须现查，哪怕上次查过】
 * 关系是会变的：你昨天是成员，今天可能被踢了。
 * token 只是"签发那一刻的快照"，拿它判断权限，等于用三天前的照片认人。
 */
export const requireProjectMember = async (req, res, next) => {
    try {
        // req.params 里拿到的永远是字符串。
        // /api/projects/abc 这种要显式挡掉，返回干净的 404，
        // 而不是把 'abc' 丢给 MySQL 让它悄悄转成 0 再去查。
        const projectId = Number(req.params.projectId)
        if (!Number.isInteger(projectId) || projectId <= 0) {
            return res.status(404).json({ tip: '项目不存在' })
        }

        // 一条 JOIN 同时回答三件事：
        //   1. 项目存在吗  2. 我是成员吗  3. 我是 owner 还是 member
        // 拆成两条 SQL 会有竞态（第一条查完、第二条查之前项目被删了），
        // 而且 handler 还得再查一次才能拿到项目名 —— 那是 N+1 的雏形。
        const [rows] = await pool.query(
            `SELECT pm.role, p.id, p.name
             FROM project_members pm
             JOIN projects p ON p.id = pm.project_id
             WHERE pm.project_id = ? AND pm.user_id = ?`,
            [projectId, req.user.id]
        )

        // 0 行有两种可能：项目不存在 / 你不是成员。
        // 故意不区分 —— 区分开就等于告诉攻击者"这个项目真实存在"（DESIGN.md §4.2）
        if (rows.length === 0) {
            return res.status(404).json({ tip: '项目不存在' })
        }

        // 挂到 req 上往下传（和 auth 挂 req.user 一个道理：req 是接力棒）。
        // 挂的是「查出来的数据」，handler 拿到就能直接用，不用再查一遍。
        //`
        // ⚠️ 字段名写成 projectId / projectName 而不是 id / name，
        //    是因为这个对象不是某一张表的行，而是 JOIN 的结果：
        //      projectId   ← projects.id
        //      projectName ← projects.name
        //      role        ← project_members.role
        //    叫 id / name 的话，看 req.membership.id 根本分不清是谁的 id。
        req.membership = {
            projectId: rows[0].id,
            projectName: rows[0].name,
            role: rows[0].role
        }

        next()
    } catch (err) {
        console.error(err)
        if (res.headersSent) return
        return res.status(500).json({ tip: '服务器出错了' })
    }
}


export default auth


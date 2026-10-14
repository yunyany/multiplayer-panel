import express from 'express'
import pool from './db.js'
import authRouter from './router/auths.js'
import projectsRouter from './router/projects.js'
import groupRouter from './router/groups.js'

const app = express()

// 解析 JSON 请求体。没有这一句，POST 请求里的 req.body 是 undefined，
// 然后你会看到「解构 undefined」的报错，却不知道错在哪。
app.use(express.json())

/**
 * 健康检查 —— 用来自测「HTTP → 连接池 → MySQL」这条链路是通的
 *
 * 暂时放在这里，等 router/ 目录建起来后会挪进自己的路由文件。
 */
app.get('/api/health', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT 1 AS ok, DATABASE() AS db, NOW() AS now'
        )
        return res.json(rows[0])
    } catch (err) {
        // 约定：catch 里先 console.error 打日志（给自己看），再给用户一句中文提示
        console.error(err)
        // 约定：可能已经发过响应了就别再发一次，否则终端一片 ERR_HTTP_HEADERS_SENT
        if (res.headersSent) return
        return res.status(500).json({ tip: '数据库连接失败' })
    }
})


// 所有接口统一以 /api 开头，且这个前缀只在 app.js 里加一次。
// 路由文件里写相对路径（比如 '/' 就是 '/api'，'/login' 就是 '/api/login'）。
// 好处：改前缀只改这一行。
app.use('/api',authRouter)

// 项目路由挂在自己的前缀上：
//   router 里的 '/'      → /api/projects
//   router 里的 '/join'  → /api/projects/join
//   router 里的 '/:projectId' → /api/projects/:projectId
// 前缀依然只在 app.js 出现，路由文件里不写死 /api。
app.use('/api/projects', projectsRouter)


app.use('/api/groups',groupRouter)


app.listen(Number(process.env.PORT), () => {
    console.log(`server running at: http://127.0.0.1:${process.env.PORT}`)
})

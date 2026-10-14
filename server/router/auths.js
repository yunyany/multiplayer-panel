import express from 'express'
import auth from '../middleware.js';
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import pool from '../db.js';

const router = express.Router()
//登录请求 ok
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        res.status(400).json({
            tip: '密码或用户名不能为空'
        })
        return;
    }

    try {
        const sqlstr = 'SELECT id, username, password_hash FROM users WHERE username = ?';
        const [rows] = await pool.query(sqlstr, [username]);
        //用户不存在
        if (rows.length === 0) {
            //提示词要全用一句话 
            return res.status(401).json({
                tip: '用户名或密码错误'
            })
        }
        // rows的格式为
        // [{ id:* ,username:*,pwd_hash:*}]
        const user = rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({
                tip: '用户名或密码错误'
            })
        }

        // 【签发 token】
        // jwt.sign(payload, 密钥, 选项) 三个参数：
        //   payload —— 想装进 token 的数据，之后能用 verify 原样读回来。
        //              ⚠️ JWT 只是"签名"不是"加密"，payload 是 Base64 明文，
        //                 任何人拿去 jwt.io 都能解开看，所以别放密码等敏感信息！
        //   密钥    —— 相当于"印章"，只有拿着它的人才能签发和验证。
        //              泄露了别人就能伪造任意用户的 token，所以放在 .env 里不进 git
        //   选项    —— expiresIn: '3d' 表示 3 天后过期。
        //              必须有！永不过期的 token 一旦泄露就是永久后门
        const token = jwt.sign(
            {
                id: user.id, username: user.username
            },
            process.env.JWT_SECRET,
            { expiresIn: '3d' }//token失效期
        )

        // 只返回需要的字段，绝不能把整个 user 丢出去（那样 password_hash 就泄露了）
        res.json({
            token,
            user: { id: user.id, username: user.username }
        })
    } catch (err) {
        console.error(err)
        // 因为响应已经发出去了，再发一次会抛 ERR_HTTP_HEADERS_SENT
        if (res.headersSent) return;
        res.status(500).json({ tip: '服务器出错了' })
    }
})

// 获取用户数据
router.get('/me', auth, async (req, res) => {
    try {
        // req.user.id 来自 auth 中间件解析出来的 token payload
        // 注意列名是 created_at，别拼错
        const sqlstr = 'select id,username,created_at from users where id = ?'
        const [rows] = await pool.query(sqlstr, [req.user.id])

        // token 有效不代表用户还在 —— token 是 7 天前签发的，这期间账号可能已被删除。
        // 所以涉及数据的操作要回查数据库，不能只信 token 里的旧信息
        if (rows.length === 0) {
            return res.status(401).json({ tip: '用户不存在' })
        }
        res.json({ user: rows[0] })
    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return;
        res.status(500).json({ tip: '服务器出错了' })
    }
})

// 注册
router.post('/register', async (req, res) => {
    const conn = await pool.getConnection()
    try {
        const { username, password } = req.body
        const _username = String(username).trim()
        if (!_username || !password) {
            return res.status(400).json({ tip: '用户名和密码不能为空' })
        }
        if (_username.length > 50) {
            return res.status(400).json({ tip: '用户名不能超过 50 个字符' })
        }
        if (password.length < 6) {
            return res.status(400).json({ tip: '密码至少 6 位' })
        }

        await conn.beginTransaction()

        const hash = await bcrypt.hash(password, 10)
        const [r] = await conn.query(
            'insert into users(username,password_hash) values(?,?)',
            [_username, hash]
        )
        //首次注册自带的默认列
        await conn.query(`
            insert into project_groups(user_id,title,position,is_default)
            values(?,?,1000,1)
            `, [r.insertId, '未分类'])

        await conn.commit()
        res.status(201).json({ ok: true })
    }
    catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ tip: '用户名已被占用' })
        }
        console.error(err);
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
    finally{
        conn.release()
    }
})

// 修改密码
router.put('/password', auth, async (req, res) => {
    try {
        const { newPassword, oldPassword } = req.body
        if (!newPassword || !oldPassword) {
            return res.status(400).json({ tip: '密码不能为空' })
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ tip: '新密码至少需要6位' })
        }

        const [rows] = await pool.query(`
        SELECT password_hash FROM users WHERE id = ?
            `, [req.user.id]);
        if (rows.length === 0) {
            return res.status(401).json({ tip: '用户不存在' })
        }
        const user = rows[0];

        const ok = await bcrypt.compare(oldPassword, user.password_hash);
        if (!ok) {
            return res.status(401).json({
                tip: '输入旧密码错误'
            })
        }
        const isSame = await bcrypt.compare(newPassword, user.password_hash)
        if (isSame) {
            return res.status(400).json({ tip: '新密码不能与旧密码相同' })
        }

        const password_hash = await bcrypt.hash(newPassword, 10)

        await pool.query(`
        update users set password_hash = ? where id = ?
        `, [password_hash, req.user.id])

        res.json({ ok: true })

    }
    catch (err) {
        console.error(err)
        if (res.headersSent) return
        res.status(500).json({ tip: '服务器出错了' })
    }
})

export default router;
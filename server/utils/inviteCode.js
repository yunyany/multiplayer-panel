import crypto from 'node:crypto'


// 去掉容易看错的 0 O 1 I L（用户要手抄给别人）
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'   // 31 个字符

export const makeInviteCode = (len = 8) => {
    // ⚠️ 必须用 crypto.randomBytes，不能用 Math.random
    // Math.random 是可预测的伪随机，别人能推出你还没发出去的邀请码
    const bytes = crypto.randomBytes(len)
    let code = ''
    for (let i = 0; i < len; i++) {
        code += ALPHABET[bytes[i] % ALPHABET.length]
    }
    return code
}

// 在事务里插项目，自动避开邀请码碰撞
export const insertProject = async (conn, name, description)=> {
    for (let i = 0; i < 5; i++) {
        const code = makeInviteCode()
        try {
            const [r] = await conn.query(
                'INSERT INTO projects (name, description, invite_code) VALUES (?, ?, ?)',
                [name, description, code]
            )
            return { projectId: r.insertId, inviteCode: code }
        } catch (err) {
            // 撞码：唯一索引拦下了，换一个再试
            if (err.code === 'ER_DUP_ENTRY') continue
            // ⚠️ 别的错误必须原样抛出去，不能一起吞掉重试
            throw err
        }
    }
    // 连撞 5 次不是"运气不好"，是系统出问题了，不能再循环下去
    throw new Error('邀请码生成失败：连续 5 次都撞码')
}
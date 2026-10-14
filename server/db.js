import mysql from 'mysql2/promise'

/**
 * MySQL 连接池
 *
 * 【为什么是"池"而不是"一个连接"】
 * 建一条 MySQL 连接要经历 TCP 握手 + 认证，几十毫秒起步。
 * 如果每个请求都新建一条、用完关掉，全花在握手上了。
 * 连接池的做法是：启动时建好一批连接放着，谁来借谁用，用完还回去。
 *
 * 【为什么用 pool.query() 就够了】
 * pool.query() 会自动「借一条 → 执行 → 还回去」，一行搞定。
 * 但事务不行 —— 事务要求多条语句跑在「同一条」连接上，必须自己借还。
 * 见 DESIGN.md §5 / TASKS.md 坑①：事务里用 pool.query() 会让事务静默失效。
 */
const pool = mysql.createPool({
    host: process.env.DB_HOST,

    // .env 里读出来的全是字符串。不转数字的话端口会变成 '3306' 字符串，
    // 大多数情况 mysql2 能容错，但别赌 —— 显式转。
    port: Number(process.env.DB_PORT),

    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // 池里连接被别人借光了的时候，新来的请求是「排队等」还是「直接报错」。
    // true = 排队等（正确选择）
    waitForConnections: true,

    // 池里最多同时存在 10 条连接。
    // ⚠️ 这个数字和「借了连接忘记 conn.release()」是配套的：
    //    漏还 10 次之后，第 11 个请求会永远卡在排队里。
    //    而且因为下面 queueLimit 是 0，它不会报错、不会超时，就是静默地永不返回。
    connectionLimit: 10,

    // 0 = 排队人数无上限。
    // 这是「服务假死」这个症状的直接原因：异常发生时不会报错，只是越来越慢，最后全卡住。
    queueLimit: 0,

    charset: 'utf8mb4',

    // 关键配置：让 DATETIME 以字符串（'2026-10-04 16:44:16'）返回，
    // 而不是转成 JS 的 Date 对象。
    // 原因是 Date 对象带时区语义，MySQL 存的却是「裸时间」，两边一换算就可能差 8 小时。
    // 设成字符串，数据库里是什么，前端就收到什么，中间不会有任何隐式转换。
    dateStrings: true
})

export default pool

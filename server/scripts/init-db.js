import mysql from 'mysql2/promise'

/**
 * 初始化数据库：建库 + 建 users 表
 *
 * 用法：npm run db:init
 *
 * 这个脚本可以重复跑（都用了 IF NOT EXISTS），不会重复建、也不会清数据。
 *
 * 【为什么不复用 db.js 的连接池】
 * 池在创建时就绑定了 database，而这个时候库还不存在 —— 连上去会直接报
 * ER_BAD_DB_ERROR。所以这里单独建一条不指定库的连接。
 */

const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
    // 故意不写 database
})

const dbName = process.env.DB_NAME

// ⚠️ 库名/表名不能用 ? 占位符。
// 占位符替换的是「值」，而库名是「标识符」，MySQL 在解析阶段就需要知道它是什么，
// 轮不到参数绑定的环节。
// 这里拼的是 .env 里的值（自己写的），不是用户输入，所以拼接是安全的。
// 反过来说：任何来自用户的表名/字段名，都绝不能这样拼。
await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`
     DEFAULT CHARACTER SET utf8mb4
     DEFAULT COLLATE utf8mb4_unicode_ci`
)

await conn.query(`USE \`${dbName}\``)

// users 表从上个项目原样复制。
// 注意 id 是 INT UNSIGNED —— 后面所有引用 users.id 的字段都必须是 INT UNSIGNED，
// 类型不一致会导致外键建不上（error 3780）。
await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username      VARCHAR(50)  NOT NULL,
        password_hash VARCHAR(100) NOT NULL,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`)

const [tables] = await conn.query('SHOW TABLES')
console.log(`[ok] 库 \`${dbName}\` 就绪`)
console.log('[ok] 现有表：', tables.map((row) => Object.values(row)[0]).join(', '))

// 用完必须关，否则这个脚本跑完进程不会退出（连接还开着，事件循环不空）
await conn.end()

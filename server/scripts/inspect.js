import mysql from 'mysql2/promise'

/**
 * 看数据库现状：表、字段、索引、外键、行数
 *
 * 用法：npm run db:inspect
 *
 * 【为什么要专门写个工具】
 * "把看起来能跑当成真的对了"最典型的来源，就是只信终端不信数据库。
 * 这个脚本让你一条命令看清楚：表建对没有、外键真的生效没有、数据真的写进去没有。
 */

const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // ⚠️ 连接级配置：这里不写的话，DATETIME 会变成 JS 的 Date 对象
    dateStrings: true
})

const db = process.env.DB_NAME

const [tables] = await conn.query('SHOW TABLES')
const names = tables.map((r) => Object.values(r)[0])

if (names.length === 0) {
    console.log(`库 ${db} 里还没有表`)
    await conn.end()
    process.exit(0)
}

for (const t of names) {
    const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``)
    console.log(`\n═══ ${t}  (${cnt} 行) ═══`)

    const [cols] = await conn.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [db, t]
    )
    for (const c of cols) {
        const key = c.COLUMN_KEY === 'PRI' ? ' PK' : c.COLUMN_KEY === 'UNI' ? ' UNI' : c.COLUMN_KEY === 'MUL' ? ' MUL' : ''
        console.log(`  ${c.COLUMN_NAME.padEnd(14)} ${c.COLUMN_TYPE.padEnd(15)}${c.IS_NULLABLE === 'NO' ? ' NOT NULL' : ''}${key}`)
    }

    const [idx] = await conn.query(`SHOW INDEX FROM \`${t}\``)
    const idxNames = [...new Set(idx.map((i) => i.Key_name))]
    console.log(`  索引: ${idxNames.join(', ')}`)

    const [fks] = await conn.query(
        `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [db, t]
    )
    if (fks.length === 0) {
        console.log('  外键: (无)')
    } else {
        for (const f of fks) {
            console.log(`  外键: ${f.COLUMN_NAME} → ${f.REFERENCED_TABLE_NAME}.${f.REFERENCED_COLUMN_NAME}  [${f.CONSTRAINT_NAME}]`)
        }
    }
}

await conn.end()

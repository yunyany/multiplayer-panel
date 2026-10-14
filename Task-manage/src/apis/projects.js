import request from './request.js'

// ★ 这里就是「前端 camelCase」和「后端 snake_case」的翻译边界。
//   页面里用 JS 习惯的驼峰，发出去时转成后端/数据库的字段名。
//   两边不一致的 bug 不会报错（只会是 undefined），所以转换只在这一个地方做，好排查。

// 创建项目
const createProject = async (name, description, groupId) => {
    const { data } = await request.post('/projects', {
        name,
        description,
        group_id: groupId
    })
    return data
}

// 个人项目(当前用户参与过的项目)
const getList = async () => {
    const { data } = await request.get('/projects')
    return data
}

// 加入项目
const joinProject = async (inviteCode) => {
    const { data } = await request.post('/projects/join', {
        invite_code: inviteCode
    })
    return data
}

// 项目详情
const detailProject = async (projectId) => {
    const { data } = await request.get(`/projects/${projectId}`)
    return data
}

// 修改项目
const updateProject = async (name, description, projectId) => {
    const { data } = await request.put(`/projects/${projectId}`, {
        name,
        description
    })
    return data
}

//标记项目
const patchProject = async (projectId,sign)=>{
    const { data } = await request.patch(`/projects/${projectId}/sign`,{sign})
    return data
}

// 把一批项目放进某个分类，并按数组顺序排好
// ★ 一个接口同时管「分类内排序」和「跨分类移动」
const placeProjects = async (groupId, orderedIds) => {
    const { data } = await request.patch('/projects/place', {
        group_id: groupId,
        ordered_ids: orderedIds
    })
    return data
}

export { createProject, getList, joinProject, detailProject, updateProject, patchProject, placeProjects }

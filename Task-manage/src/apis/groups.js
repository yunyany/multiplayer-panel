import request from "./request";

const createGroup = async (title) => {
    const { data } = await request.post('/groups', { title })
    return data
}

// 获取我的分类
const getGroup = async () => {
    const { data } = await request.get('/groups')
    return data
}

// 归档列表
const deleteGroup = async (groupId) => { 
    const { data } = await request.delete(`/groups/${groupId}`)
    return data
}

// 修改分类
const updateGroup = async (title, groupId) => {
    const { data } = await request.put('/groups', { title, groupId })
    return data
}

// 标记分类
const patchGroup = async (groupId,sign) => {
    const { data } = await request.patch(`groups/${groupId}/sign`,{sign})
    return data
}

// 分类排序（拖拽后调用）
// ★ 发的是「整个新顺序」的 id 数组，不是「插到谁和谁之间」
const reorderGroups = async (orderedIds) => {
    const { data } = await request.patch('/groups/order', { ordered_ids: orderedIds })
    return data
}

export { createGroup, getGroup, deleteGroup, updateGroup, patchGroup, reorderGroups }
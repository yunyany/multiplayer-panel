import { useState, useEffect, useRef } from 'react'
import { message, Modal } from 'antd'

import './Projects.css'
import { getList, updateProject, patchProject, joinProject, placeProjects } from '../../apis/projects'
import { createGroup, getGroup, reorderGroups } from '../../apis/groups'
import autoSize from '../../utils/autoSize'
import Card, { CardPreview } from './Card'
import classNames from 'classnames'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'

const Projects = () => {
    // 分组数据
    const [group, setGroup] = useState([])
    // 用户数据,格式:{groupid1:projects,groupid2:projects}
    const [projects, setProjects] = useState({})
    // 用户的选择
    const [select, setSelect] = useState(false)

    /**
     * 拖拽传感器
     *
     * ★ activationConstraint 不能省。
     *   没有它，「点一下」也会被当成一次拖动 ——
     *   卡片上任何点击操作（打开弹窗、点按钮）都会和拖拽打架。
     *   distance: 8 的意思是「指针移动超过 8px 才算拖」。
     */
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    )

    const getData = async () => {
        try {
            // ① 两个请求并行，不是串行 —— 少一次往返
            const [groupData, projectData] = await Promise.all([getGroup(), getList()])

            // ② 分桶。null / undefined 统一进 'ungrouped'
            const buckets = { ungrouped: [] }
            for (const g of groupData.groups) buckets[g.id] = []
            for (const p of projectData.projects) {
                const key = p.group_id == null ? 'ungrouped' : p.group_id   // 注意是 == 不是 ===
                if (!buckets[key]) buckets[key] = []      // 兜底：分类被删了但项目还挂着
                buckets[key].push(p)
            }

            // ③ 两个 setState 在同一个同步块里 → React 批处理 → 只渲染一次
            //    → 中间那个"group 有值、projects 还是 null"的状态不会再出现
            setGroup(groupData.groups)
            setProjects(buckets)
        } catch (err) {
            message.error(err.message)
        }
    }

    useEffect(() => {
        getData()
    }, [])


    // 修改当前项目标题
    const [name, setName] = useState(select?.name || '')
    // 修改当前项目描述
    const [description, setDescription] = useState(select?.description || '')

    const alterProject = async () => {
        try {
            const _name = name.trim() || select.name
            if (_name !== name) setName(_name)

            await updateProject(_name || '', description || '', select.id)

            setSelect(null)
            getData()
        }
        catch (err) {
            message.error(err.message)
        }
    }
    // 修改项目标记
    const alterProjectPatch = async () => {
        try {
            await patchProject(select.id, !select?.sign)
            getData()
            if (!select?.sign) {
                setSelect({ ...select, sign: 1 })
            }
            else {
                setSelect({ ...select, sign: 0 })
            }
        }
        catch (err) {
            message.error(err.message)
        }
    }

    useEffect(() => {
        setDescription(select?.description || '')
        setName(select?.name || '')
    }, [select])


    // 添加列元素
    const [buildGroup, setBuildGroup] = useState(false)
    const [gTitle, setGTitle] = useState('')
    const buildRef = useRef(null)
    // 添加新列
    const addGroup = async () => {
        try {
            if (!gTitle) return
            await createGroup(gTitle)
            setBuildGroup(false)
            setGTitle('')
            getData()
        }
        catch (err) {
            message.error(err.message)
        }
    }

    useEffect(() => {
        const handleClick = (e) => {
            if (buildRef.current && !buildRef.current.contains(e.target)) {
                setBuildGroup(false)
            }
        }
        document.addEventListener('click', handleClick)
        return () => {
            document.removeEventListener('click', handleClick)
        }
    }, [])

    // 使用邀请码加入
    const [openInvite, setOpenInvite] = useState(false)
    const [invite, setInvite] = useState('')
    const inputInvite = async () => {
        try {
            if (!invite) return

            await joinProject(invite)
            message.success("添加成功")
            setInvite('')
            setOpenInvite(false)
            getData()
        }
        catch (err) {
            message.error(err.message)
        }
    }

    const [activeId, setActiveId] = useState(null)
    const activeGroup = group.find(g => `group-${g.id}` === activeId)
    // 正在拖的项目（给 DragOverlay 画影子用的）
    const activeProject = activeId
        ? Object.values(projects).flat().find(p => `project-${p.id}` === activeId)
        : null

    /**
     * 拖动结束 —— 分类和项目走同一个入口
     *
     * dnd-kit 只有一个 DndContext，所以要靠 id 前缀判断拖的是哪个。
     *（id 加 'group-' / 'project-' 前缀的另一个原因：两个 id 来自不同的表，
     *  都从 1 开始，不加前缀根本分不清。）
     *
     * 乐观更新：先改本地 state（界面立刻变，不等网络），再发请求；
     * 失败就把真实数据重新拉回来。
     */
    const handleDragEnd = async ({ active, over }) => {
        // over 为 null：拖到空白处松手，什么也不做
        if (!over || active.id === over.id) return

        const id = String(active.id)
        if (id.startsWith('group-')) await onGroupDragEnd(active, over)
        else if (id.startsWith('project-')) await onProjectDragEnd(active, over)
    }

    // 分类左右排序
    const onGroupDragEnd = async (active, over) => {
        const from = group.findIndex((g) => `group-${g.id}` === active.id)
        const to = group.findIndex((g) => `group-${g.id}` === over.id)
        if (from < 0 || to < 0) return

        // ★ 先用 arrayMove 算出新数组，再 setState。
        //   不要写成 setGroup(prev => { ...发请求... }) ——
        //   那个回调的返回值 React 会拿走，你自己拿不到 next，
        //   也就没法拿新顺序去发请求。
        const next = arrayMove(group, from, to)
        setGroup(next)

        try {
            await reorderGroups(next.map((g) => g.id))
        } catch (err) {
            message.error(err.message)
            getData()
        }
    }

    // 存一次某个分类里项目的顺序
    const persistList = async (groupId, list) => {
        try {
            await placeProjects(groupId, list.map((p) => p.id))
        } catch (err) {
            message.error(err.message)
            getData()
        }
    }

    /**
     * 项目拖动结束
     *
     * 两种情况：
     *   同一个分类内 → 换位置
     *   跨分类       → 从源分类删掉，插进目标分类
     *
     * 落点 over 有两种可能：
     *   project-xx  → 压在某个项目上，插到它的位置
     *   group-xx    → 压在分类上（空分类、或分类的空白处），追加到末尾
     */
    const onProjectDragEnd = async (active, over) => {
        //当前移动的project的id
        const pid = Number(String(active.id).slice('project-'.length))
        if (!Number.isInteger(pid) || pid <= 0) return

        const fromGroup = group.find((g) => (projects[g.id] ?? []).some((p) => p.id === pid))
        if (!fromGroup) return
        
        //落点的project-id字符串
        const overId = String(over.id)


        // ── 落点一：压在某个项目上 ──
        if (overId.startsWith('project-')) {
            const oid = Number(overId.slice('project-'.length))
            const toGroup = group.find((g) => (projects[g.id] ?? []).some((p) => p.id === oid))
            if (!toGroup) return

            
            const srcList = projects[fromGroup.id] ?? []
            const dstList = projects[toGroup.id] ?? []

            if (fromGroup.id === toGroup.id) {
                // 同一个分类：只换位置
                const from = srcList.findIndex((p) => p.id === pid)
                const to = srcList.findIndex((p) => p.id === oid)
                if (from < 0 || to < 0) return

                const next = arrayMove(srcList, from, to)
                setProjects({ ...projects, [fromGroup.id]: next })
                await persistList(fromGroup.id, next)
            }
            else {
                // 跨分类：插到 oid 那个位置
                const to = dstList.findIndex((p) => p.id === oid)
                if (to < 0) return

                const moved = srcList.find((p) => p.id === pid)
                const newSrc = srcList.filter((p) => p.id !== pid)
                const newDst = [...dstList]
                newDst.splice(to, 0, moved)

                setProjects({ ...projects, [fromGroup.id]: newSrc, [toGroup.id]: newDst })
                // ★ 只存目标分类那一列。源分类剩下的项目位置不动，
                //   稀疏整数中间留个空档没关系（DESIGN.md §3.3）
                await persistList(toGroup.id, newDst)
            }
            return
        }

        // ── 落点二：压在分类上（空分类 / 分类的空白处）→ 追加到末尾 ──
        if (overId.startsWith('group-')) {
            const toGroupId = Number(overId.slice('group-'.length))
            if (!group.some((g) => g.id === toGroupId)) return
            if (fromGroup.id === toGroupId) return      // 没动，不用管

            const srcList = projects[fromGroup.id] ?? []
            const dstList = projects[toGroupId] ?? []

            const moved = srcList.find((p) => p.id === pid)
            const newSrc = srcList.filter((p) => p.id !== pid)
            const newDst = [...dstList, moved]

            setProjects({ ...projects, [fromGroup.id]: newSrc, [toGroupId]: newDst })
            await persistList(toGroupId, newDst)
        }
    }

    /**
     * 碰撞检测：按 id 前缀筛掉「不该参与比较」的落点
     *
     * ★ 这个不能省，它是这一版能不能跑起来的关键。
     *   项目条目在卡片内部，位置天然更靠近指针 ——
     *   不筛的话，拖分类时 dnd-kit 会认为你「压在了某个项目上」，
     *   over 拿到的是 project-xx，而分类重排只认 group-xx，于是什么都不会发生。
     *
     *   拖分类：只和分类比
     *   拖项目：和项目比（插到某个位置）+ 和分类比（放进空分类 / 追加末尾）
     */
    const collisionDetection = (args) => {
        const isGroup = String(args.active.id).startsWith('group-')

        const containers = args.droppableContainers.filter((c) => {
            const id = String(c.id)
            if (isGroup) return id.startsWith('group-')
            return id.startsWith('project-') || id.startsWith('group-')
        })

        return closestCenter({ ...args, droppableContainers: containers })
    }

    return (
        <div className='projects-container'>
            {/* 顶部导航栏 */}
            <header className='projects-header'>
                <div className='projects-nav-left'>
                    <span>我的面板</span>
                    <span>views</span>
                </div>

                <div className='projects-nav-center'></div>

                <div className='projects-nav-right'>
                    <span title='查询自己的项目'>查询</span>
                    <span

                        title='加入别人的项目'
                        onClick={() => setOpenInvite(true)}
                    >加入</span>
                    <span>其它</span>
                </div>
            </header>

            {/* 内容区：横向排列 */}
            <div className='projects-body'>
                {/*
                  ↓↓↓ 以后接 dnd-kit 时，<SortableContext> 只包这一段 ↓↓↓
                */}
                <DndContext
                    sensors={sensors}
                    collisionDetection={collisionDetection}
                    onDragStart={({ active }) => setActiveId(active.id)}
                    onDragEnd={(e) => { setActiveId(null); handleDragEnd(e) }}
                    onDragCancel={() => setActiveId(null)}
                >
                    <SortableContext
                        items={group.map((g) => `group-${g.id}`)}
                        strategy={horizontalListSortingStrategy}
                    >
                        {
                            group.map((p) => (
                                <Card
                                    groupId={p.id}
                                    initialTitle={p.title}
                                    key={p.id}
                                    projects={projects[p.id]}
                                    setSelect={setSelect}
                                    getData={getData}
                                    groupSign={p.sign}
                                />
                            ))
                        }
                    </SortableContext>
                    <DragOverlay dropAnimation={null}>
                        {activeGroup
                            ? <CardPreview
                                title={activeGroup.title}
                                projects={projects[activeGroup.id]}
                            />
                            : activeProject
                                ? <div className='project-item is-preview'>{activeProject.name}</div>
                                : null}
                    </DragOverlay>
                </DndContext>

                {/*
                  ↑↑↑ SortableContext 到这里结束 ↑↑↑
                  ★ 下面这张卡在 SortableContext 外面 → 永远不会被拖走。
                    它排在数组渲染之后，靠 flex 的 source order 自然落在最右边。
                */}
                {
                    buildGroup ?
                        <div ref={buildRef}
                            className='card-add'
                            style={{
                                flexDirection: 'column',
                                backgroundColor: 'rgb(32, 32, 32)',
                                padding: '6px'
                            }}
                        >
                            <textarea
                                onChange={(e) => {
                                    setGTitle(e.target.value)
                                    autoSize(e.target)
                                }}
                                value={gTitle}
                                rows={2}
                                className='list-content' placeholder='输入标题' />
                            <div
                                style={{ display: 'flex' }}>
                                <button
                                    onClick={() => addGroup()}
                                    className='list-confirm-btn'
                                >添加列表</button>
                                <button
                                    className='list-cancel-btn'
                                    onClick={() => {
                                        setBuildGroup(false)
                                        setGTitle('')
                                    }}
                                >x</button>
                            </div>

                        </div>
                        :
                        <div
                            onClick={() => setBuildGroup(true)}
                            className='card-add'>+ 新建列表
                        </div>
                }


            </div>
            {/* 项目操作 */}
            <Modal
                open={!!select}
                width={"75vw"}
                title={
                    <div style={{ display: "flex", flexDirection: 'row' }}>
                        <h3 >修改项目内容</h3>
                        <span
                            className={classNames('project-titleA', select?.role === 'member' ? 'isMember' : '')}
                            onClick={() => alterProjectPatch()}
                        >{select?.sign ? "取消标记" : "标记"}</span>
                        <span
                            className={classNames('project-titleA', select?.role === 'member' ? 'isMember' : '')}
                            onClick={() => {
                                message.info(select.invite_code)
                            }}
                        >邀请码</span>
                    </div>
                }
                onCancel={() => {
                    setSelect(null)
                }}
                onOk={() => alterProject()}
                footer={select?.role === 'member' ? null : undefined}
            >
                <div style={{ display: 'flex', flexDirection: 'row' }}>
                    <div style={{ flex: 1 }}>
                        <div>
                            <h3>标题</h3>
                            <textarea
                                className='project-name'
                                onChange={(e) => {
                                    setName(e.target.value)
                                    autoSize(e.target)
                                }}
                                value={name}
                            ></textarea>
                        </div>

                        <div>
                            <h3>描述</h3>
                            <textarea
                                className='project-description'
                                onChange={(e) => {
                                    setDescription(e.target.value)
                                    autoSize(e.target)
                                }}
                                value={description}
                                placeholder='添加详细描述吧...'
                            >
                            </textarea>
                        </div>
                    </div>
                    <div style={{ flex: 1, marginLeft: '10px', borderLeft: 'dotted 2px black', paddingLeft: '10px' }}>
                        评论区
                    </div>
                </div>

            </Modal>

            {/* 邀请码 */}
            <Modal
                open={!!openInvite}
                onCancel={() => { setInvite(''), setOpenInvite(false) }}
                onOk={() => inputInvite()}
                title={'输入邀请码'}
                width={400}
            >
                <input
                    className='invite_code'
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    placeholder='邀请码'
                >
                </input>
            </Modal>
        </div>
    )
}

export default Projects

import { useState, useEffect, useRef } from 'react'
import { message, Modal } from 'antd'
import classnames from 'classnames'

import { createProject } from '../../apis/projects'
import { deleteGroup, updateGroup, patchGroup } from '../../apis/groups'
import autoSize from '../../utils/autoSize'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

// Card 用到的 .card / .card-title / .trello-title / .project-display /
// .project-item / .card-content / .add-card / .card-modal-setting 都定义在这里。
// 理想情况下这些样式应该拆成 Card.css，等以后 Card 被别处复用时再拆。
import './Projects.css'

/**
 * 单个项目条目（卡片里的一行）
 *
 * ⚠️ 必须抽成独立组件 —— useSortable 是 hook，
 *    hook 不能在循环里调用（每循环一次调一遍，React 会报错）。
 *
 * 【为什么这里不需要 stopPropagation】
 * 分类的拖动监听挂在 .card-title 上，而 .card-title 并不是这个元素的祖先——
 * 两套监听在 DOM 上是分开的，互不干扰，谁也抢不到谁。
 *
 * 上一版失败就是因为把分类监听挂在整张 .card 上：
 * .project-item 是 .card 的后代，两套监听在 DOM 上重叠，
 * 只能靠 stopPropagation 抢，而被抢的那一边会「按下去完全没反应」。
 */
const ProjectItem = ({ project, onSelect }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: `project-${project.id}` })

    return (
        <div
            ref={setNodeRef}
            className={classnames('project-item', isDragging ? 'is-dragging' : '')}
            style={{
                // 和卡片一样：手写 translate，只要位移不要 scale（否则拖动时会被缩放变形）
                transform: transform
                    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
                    : undefined,
                transition
            }}
            {...attributes}
            {...listeners}
            onClick={() => onSelect(project)}
        >
            {project.sign ? <span>⭐ </span> : null}
            {project.sign
                ? <span style={{ fontWeight: '500', color: 'rgb(220, 223, 228)' }}>{project.name}</span>
                : project.name}
            {project.role === 'member'
                ? <span
                    style={{
                        position: 'absolute',
                        right: '0px',
                        color: 'rgb(249, 183, 128)'
                    }}
                    title={'你是项目成员'}
                >成员</span>
                : null}
        </div>
    )
}

/**
 * 一个分类卡片
 *
 * 内部是「头固定 / 中间滚 / 脚固定」三段式：
 *   .card-title      分类标题    —— 永远在最上面
 *   .project-display 项目列表    —— 唯一会滚的地方
 *   .add-card        + 添加      —— 永远钉在最下面
 *
 * ⚠️ 这三段要生效，父级 .card 必须是 display:flex + flex-direction:column。
 *    少了它，下面三个 flex 属性全是废的（flex 只对 flex 容器的直接子元素生效）。
 *
 * 【props】
 *   groupId      分类 id（建项目、改名、标记都要用它）
 *   initialTitle 分类标题的初始值
 *   projects     这个分类里的项目数组
 *   groupSign    分类是否已标记（0 / 1，从接口来）
 *   setSelect    点某个项目时，把那个项目对象交给父组件（用来开弹窗）
 *   getData      让父组件重新拉一遍数据（增删改之后都要调）
 */
const Card = ({ initialTitle, projects, setSelect, getData, groupId, groupSign }) => {
    /**
     * 把自己变成「可拖拽排序」的
     *
     * ⚠️ id 必须加前缀 'group-'。
     *    分类 id 和项目 id 来自两张不同的表，各自都从 1 开始 ——
     *    不区分的话，分类 1 和项目 1 会撞成同一个 id，dnd-kit 就认错了。
     *
     * 返回值分四类：
     *   setNodeRef         绑在「会移动的那个元素」上（整张卡片）
     *   setActivatorNodeRef 绑在「按住才能拖的那个把手」上
     *   listeners          把指针事件接上（没有它，按住不动）
     *   transform/transition 拖动时 dnd-kit 算出来的位移，要写进 style
     */
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: `group-${groupId}` })

    /**
     * 拦下 pointerdown，别让它冒泡到标题栏的拖动监听上
     *
     * 拖动监听 { ...listeners } 挂在 .card-title 上（按住标题栏才能拖），
     * 而标题栏里还有输入框、「设置」这些要正常点击/编辑的东西 ——
     * 所以它们各自把 pointerdown 拦住。
     *
     * ⚠️ 必须是 onPointerDown，不是 onClick。
     *    拖动是在 pointerdown 那一刻开始的，等 onClick 已经太晚了。
     */
    const stopDrag = (e) => e.stopPropagation()

    // 分类标题（本地可编辑，失焦时提交）
    const [title, setTitle] = useState(initialTitle)
    // 项目标题（添加表单）
    const [pTitle, setPTitle] = useState('')
    // 项目描述（添加表单）
    const [description, setDescription] = useState('')
    // 是否展开"添加项目"表单
    const [add, setAdd] = useState(false)
    const addRef = useRef(null)
    // 列表设置弹窗是否打开
    const [openSetting, setOpenSetting] = useState(false)
    // 添加项目
    const addProject = async () => {
        setAdd(false)
        try {
            await createProject(pTitle, description, groupId)
            setPTitle('')
            setDescription('')
        }
        catch (err) {
            message.error(err.message)
        }

        //拉数据
        getData()
    }

    // 修改列表标题
    const onBlurSubmit = async () => {
        try {
            const next = title.trim() || initialTitle
            if (next !== title) setTitle(next)
            await updateGroup(next, groupId)
            getData()
        }
        catch (err) {
            message.error(err.message)
        }
    }

    // 标记列表
    const alterGroupPatch = async () => {
        try {
            await patchGroup(groupId, !groupSign)
            getData()
        }
        catch (err) {
            message.error(err.message)
        }
    }

    useEffect(() => {
        const handleClick = (e) => {
            if (addRef.current && !addRef.current.contains(e.target)) {
                setAdd(false)
            }
        }
        document.addEventListener('click', handleClick)
        return () => {
            document.removeEventListener('click', handleClick)
        }
    }, [])

    return (
        <div
            ref={setNodeRef}
            className={classnames('card', groupSign ? 'sign-card' : '', isDragging ? 'is-dragging' : '')}
            style={{
                /*
                 * ★ 手写 transform，不用 CSS.Transform / CSS.Translate
                 *
                 * CSS.Transform.toString() 会附带 scaleX / scaleY，而 useSortable
                 * 里的 scale 是 initial.width / current.width —— 元素尺寸一变
                 * 就会被缩放，那就是"变形"的来源。
                 *
                 * 这里只输出 translate3d，元素永远保持原始大小。
                 * 为什么手写而不用库的 helper：为了拿掉"helper 内部到底返回了什么"
                 * 这个不确定因素 —— 出问题时一眼能看懂这行在干什么。
                 */
                transform: transform
                    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
                    : undefined,
                transition
            }}
        >
            {/*
              ★ 两个 ref 分工不同，别搞混：

                setNodeRef          → 挂在「会移动的那个元素」上 = 整张卡片
                                       dnd-kit 量它的位置、把位移写在它身上

                setActivatorNodeRef → 挂在「按住才能拖的那块区域」上 = 标题栏
                                       只有在这里按下才会开始拖

              为什么不把整张卡片都当拖动区（原来那样）：
              .project-item 占了卡片绝大部分面积，以后它自己也要能拖（上下排序）。
              两个 draggable 在几何上重叠时，只能靠 stopPropagation 抢，
              而被抢的那一边会变得「按下去完全没反应」。
              把「按哪里」和「谁移动」拆开，就不会有争抢了。
            */}
            <div
                ref={setActivatorNodeRef}
                className='card-title'
                {...attributes}
                {...listeners}
            >
                <textarea
                    className='trello-title'
                    onPointerDown={stopDrag}
                    ref={autoSize}                     /* 挂载时先按初始内容撑一次 */
                    value={title}
                    placeholder='无标题'                /* ★ 用 placeholder，不要拿 value 当占位符 */
                    onChange={(e) => {
                        setTitle(e.target.value)
                        autoSize(e.target)
                    }}
                    onBlur={() => onBlurSubmit()}
                    rows={1}
                />
                <span
                    className='project-number'
                    datatip={"当前项目数量"}
                >{projects?.length ?? 0}</span>

                <span
                    className='card-setting'
                    title='列表操作'
                    onPointerDown={stopDrag}
                    onClick={() => setOpenSetting(true)}
                >{" 设置"}</span>

            </div>

            <div className='project-display'>
                {/* SortableContext 自己不渲染 DOM，不影响 .project-display 的 flex 布局 */}
                <SortableContext
                    items={(projects ?? []).map((p) => `project-${p.id}`)}
                    strategy={verticalListSortingStrategy}
                >
                    {projects?.map((p) => (
                        <ProjectItem key={p.id} project={p} onSelect={setSelect} />
                    ))}
                </SortableContext>
            </div>

            {
                !add ? <div
                    onPointerDown={stopDrag}
                    onClick={() => setAdd(true)}
                    className='add-card'>+ 添加
                </div> :
                    <div
                        ref={addRef}
                        style={{
                            padding: "10px 0px 10px 0px",
                            transition: "all .1s"
                        }}
                    >
                        <textarea
                            onPointerDown={stopDrag}
                            onChange={(e) => {
                                setPTitle(e.target.value)
                                autoSize(e.target)
                            }}
                            value={pTitle}
                            rows={2}
                            className='card-content' placeholder='输入标题' />
                        <textarea
                            onPointerDown={stopDrag}
                            onChange={(e) => {
                                setDescription(e.target.value)
                                autoSize(e.target)
                            }}
                            value={description}
                            className='card-content'
                            placeholder='输入项目描述' />
                        <div
                            onPointerDown={stopDrag}
                            style={{
                                display: 'flex',
                                marginTop: '10px'
                            }}
                        >
                            <button
                                onClick={() => addProject()}
                                className='card-confirm-btn'
                            >添加卡片</button>
                            <button
                                className='card-cancel-btn'
                                onClick={() => {
                                    setAdd(false)
                                    setDescription('')
                                    setPTitle('')
                                }}
                            >x</button>
                        </div>

                    </div>
            }

            {/* 列表设置 */}
            <Modal
                className='card-modal-setting'
                open={openSetting}
                title={"列表设置"}
                width={300}
                style={{ display: 'flex', flexDirection: 'column', userSelect: 'none' }}
                onOk={() => setOpenSetting(false)}
                onCancel={() => setOpenSetting(false)}
            >
                <div
                    className='setting'
                    onClick={() => {
                        Modal.confirm({
                            content: '确认删除当前列表',
                            onOk: async () => {
                                try {
                                    await deleteGroup(groupId)
                                    getData()
                                    setOpenSetting(false)
                                }
                                catch (err) {
                                    message.error(err.message)
                                }
                            },
                            okText: '删除列表',
                            cancelText: '取消'
                        })
                    }}
                >删除列表</div>
                <div
                    className='setting'
                >将列表内的项目归档 <span>未完成</span></div>
                <div
                    onClick={() => alterGroupPatch()}
                    className='setting'>
                    {!groupSign ? "标记列表" : "取消标记"}
                </div>
                <div className='setting'>批量标记</div>
                <div className='setting'>批量解除标记</div>
            </Modal>
        </div>
    )
}

/**
 * 拖拽时那个「跟手的影子」（给 DragOverlay 用）
 *
 * ⚠️ 必须是纯展示的 —— 不能直接把 Card 塞进 DragOverlay。
 *
 *    因为 Card 里面有 useSortable({ id: `group-${groupId}` })，
 *    而 overlay 里那份的 groupId 和正在拖的那张卡一模一样 ——
 *    等于把同一个 id 注册两遍，dnd-kit 的注册表会被覆盖，
 *    原来那张卡片反而可能丢掉拖动能力。
 *
 *    所以这里只画样子，一个 hook 都不挂。
 */
const CardPreview = ({ title, projects }) => (
    <div className='card is-preview'>
        <div className='card-title'>
            <span className='preview-title'>{title}</span>
            <span className='project-number'>{projects?.length ?? 0}</span>
        </div>
        <div className='project-display'>
            {projects?.map((p) => (
                <div className='project-item' key={p.id}>
                    {p.sign ? <span>⭐ </span> : null}
                    {p.name}
                </div>
            ))}
        </div>
    </div>
)

export default Card
export { CardPreview }

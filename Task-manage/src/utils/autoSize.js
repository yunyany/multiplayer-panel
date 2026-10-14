/**
 * 让 textarea 跟着内容长高
 *
 * 先设 auto 再读 scrollHeight，是为了让它能「缩回去」——
 * 直接读 scrollHeight 的话它只会越撑越高，删字不会变矮。
 *
 * 用法有两种：
 *   ref={autoSize}                 挂载时先按初始内容撑一次
 *   onChange={(e) => autoSize(e.target)}   输入时重新撑
 *
 * ⚠️ 不要用在 antd Modal 里面的 textarea 上。
 *    Modal 是懒挂载的，元素刚 mount 那一刻还没完成布局，
 *    scrollHeight 读到 0，于是写进去 height: 0px —— 输入框会缩成一条线。
 *    而且「打开后打几个字就好了」（onChange 又调了一次），所以看着像偶发。
 *    弹窗里的输入框用固定高度 + resize: vertical 就行，见 .project-name / .project-description
 */
const autoSize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
}

export default autoSize

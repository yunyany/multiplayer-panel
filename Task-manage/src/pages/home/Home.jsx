import { Outlet, useNavigate } from 'react-router-dom';
import { Dropdown, Modal,message } from 'antd';
import { useDispatch } from 'react-redux';
import { clearUser } from '../../store/modules/user';
import './Home.css'


const Home = () => {
    const dispatch = useDispatch()
    const navigate = useNavigate()
    const items = [
        {
            label: <div
                onClick={() => {
                    Modal.confirm({
                        title: "是否要退出登录?",
                        content: "退出登录后需要重新登录",
                        closable: true,
                        centered: true,
                        okText: "往里豪^v^",
                        cancelText: "反悔了",
                        onOk() {
                            dispatch(clearUser())
                            navigate('/login')
                            message.success('登出成功')
                        },
                        onCancel() {
                            message.info("取消成功")
                        }
                    })
                }}
            >退出登录</div>,
            key: '1'
        }
    ]

    return (
        <div className='container'>
            {/* 对于面板的操作 */}
            <header className='top-nav'>
                {/* 左侧 */}
                <div className='nav-left'>
                    <span>主页</span>
                    <span>切换面板</span>
                </div>

                {/* 中间大标题 */}
                <div className='nav-center'>
                    <input
                        className='home-ipt'
                        placeholder='搜索'
                    ></input>
                    <button>创建</button>
                </div>

                {/* 右侧 */}
                <div className='nav-right'>
                    <span>通知</span>
                    <Dropdown
                        menu={{ items }} trigger={['click']}
                    >
                        <span>用户</span>
                    </Dropdown>

                </div>
            </header>

            {/* 面板内操作 */}
            <Outlet />
        </div>
    );
}

export default Home
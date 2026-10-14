import { useState } from 'react';
import './Login.css'
import { login } from '../../apis/auth';
import classNames from 'classnames';
import { message } from 'antd';
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { setUser } from '../../store/modules/user'


const Login = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [selectUl, setSelectUl] = useState(1);
    const [ipt1, setIpt1] = useState('');
    const [ipt2, setIpt2] = useState('');
    const [showError1, setShowError1] = useState('')
    const [showError2, setShowError2] = useState('')
    const [btnVal, setBtnVal] = useState({
        val: '登录', isexit: true
    })

    const reset = () => {
        setIpt1(''), setIpt2('');
        setBtnVal({
            val: '登录', isexit: true
        })
    }

    // 表单验证
    const formSubmit = async (e) => {
        e.preventDefault();
        //前端初判
        if (!ipt1) {
            setShowError1(true)
            return;
        }
        setShowError1('')
        if (!ipt2) {
            setShowError2(true)
            return;
        }
        setShowError2('');

        setBtnVal({ val: 'Loading...', isexit: false })

        try {
            const res = await login(ipt1,ipt2)
            message.open({
                type: 'success',
                content: '登录成功',
                duration: 2
            })

            dispatch(setUser({
                token: res.token,
                username: res.user.username
            }))

            navigate('/')
        } catch (err) {
            message.open({
                type: 'error',
                content: '登录失败: ' + err.message,
                duration: 2
            })
        }

        //重置表单和按钮  用户被压力管我开发者什么事😂
        reset()
    }

    if (localStorage.getItem('token')) {
        return <Navigate to='/' replace />
    }
 
    return (
        <div className='login-container'>
            <div className='login'>
                <ul className='login-select-ul'>
                    <li
                        onClick={() => setSelectUl(1)}
                        className={selectUl ? 'active' : ''}
                    >密码登录</li>
                </ul>
                {
                    selectUl ?
                        <form className='login-form' onSubmit={(e) => formSubmit(e)}>
                            <div className='form-item'>
                                <input
                                    value={ipt1}
                                    onChange={(e) => setIpt1(e.target.value)}
                                    type='text'
                                    placeholder='请输入用户名'
                                />
                                {showError1 && <span className={
                                    classNames('error-msg',
                                        showError1 ? 'error-glow' : ''
                                    )}>请输入用户名</span>}
                            </div>

                            <div className='form-item'>
                                <input
                                    value={ipt2}
                                    onChange={(e) => setIpt2(e.target.value)}
                                    type='password'
                                    placeholder='请输入密码'
                                />
                                {showError2 && <span className={
                                    classNames('error-msg',
                                        showError2 ? 'error-glow' : ''
                                    )
                                }>请输入合法的密码</span>}
                            </div>

                            <button
                                disabled={!btnVal.isexit}
                                className={classNames('login-btn',
                                    btnVal.isexit ? '' : 'suspend-btn'
                                )} type='submit'>{btnVal.val}</button>
                        </form>
                        :
                        null
                }
                <span>还没有账号?
                    <Link 
                    to={'/register'}
                    style={{
                        color:'red'
                    }}
                    >
                    去注册</Link>
                </span>
            </div>
        </div>
    )
}

export default Login;
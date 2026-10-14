import { useState } from 'react';
import './Register.css';
import { Link } from 'react-router-dom';
import { message } from 'antd';
import { postRegister } from '../../apis/register'


const Register = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!confirm || !password || !username.trim()) {
            return message.info('数据不可为空')
        }
        if (confirm !== password) {
            return message.info('请保证确认密码和密码相同')
        }
        if (password.length < 6) return message.info('密码的长度不小于6位')
        try {
            await postRegister( username.trim(), password)
            message.success('注册成功，请登录')
        }
        catch (err) {
            message.error(err.message)
        }
    };

    return (
        <div className='register-container'>
            <form className='register-form' onSubmit={handleSubmit}>
                <h2 className='register-title'>注册</h2>

                <div className='register-item'>
                    <input
                        type='text'
                        placeholder='请输入用户名'
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div className='register-item'>
                    <input
                        type='password'
                        placeholder='请输入密码'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <div className='register-item'>
                    <input
                        type='password'
                        placeholder='请确认密码'
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                    />
                </div>

                <button className='register-btn' type='submit'>
                    注册
                </button>
                <span>
                    已有密码?
                    <Link to={'/login'}>
                        去登陆</Link>
                </span>
            </form>
        </div>
    );
};

export default Register;
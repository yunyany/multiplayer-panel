import axios from "axios";
import store from '../store'
import {message} from 'antd'
import { clearUser } from '../store/modules/user.js'


const request = axios.create({
    baseURL:'/api', 
    timeout:10000
})

// 请求拦截器   config:配置对象{url,method,headers,data,params,...}
request.interceptors.request.use(
    (config) => {
        // 非组件代码读 store 用 store.getState()
        const token = store.getState().user.token

        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }

        return config
    },
    (err) => {
        return Promise.reject(err)
    }) 

// ── 响应拦截器：统一的错误处理 ──
request.interceptors.response.use(
    (res) => res,   // 直接返回完整的response对象{data,status,headers,config(上一个拦截器返回的),...}，只用解构出data就行

    (err) => {
        // 401跳登录页，500弹提示
        if (err.response) {
            const { status, data } = err.response

            if (status === 401 && data?.code === 'TOKEN_INVALID') {
                store.dispatch(clearUser())
                message.error('登录已过期，请重新登录')
            }
            if ([502, 503, 504].includes(status)) {
                return Promise.reject(new Error('服务器暂时不可用'))
            }

            //约定服务器返回的data提示是{tip:...}!!!
            return Promise.reject(new Error(data?.tip || `请求失败 (${status})`))
        }

        // 情况二：请求根本没到服务器（后端没启动、断网、代理挂了）
        return Promise.reject(new Error('网络异常，请检查后端是否启动'))
    }
)

export default request
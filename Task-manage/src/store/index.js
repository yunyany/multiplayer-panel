import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./modules/user";

const store = configureStore({
    reducer:{
        user:userReducer
    }
})

// 把 store 的变化同步回 localStorage（单一数据源 → 外部持久化）
store.subscribe(() => {
    const { token, username } = store.getState().user
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
})

export default store;
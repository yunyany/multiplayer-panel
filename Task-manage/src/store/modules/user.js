import { createSlice } from "@reduxjs/toolkit";

const userSlice = createSlice({
    name: 'user',
    initialState: {
        token: localStorage.getItem('token') || '',
        username: localStorage.getItem('username') || '',
        
    },
    reducers: {
        setUser(state, action) {
            state.token = action.payload.token
            state.username = action.payload.username
        },
        clearUser(state) {
            state.token = ''
            state.username = ''
        }
    }

})

const { setUser, clearUser } = userSlice.actions
const userReducer = userSlice.reducer

export { setUser, clearUser };
export default userReducer;
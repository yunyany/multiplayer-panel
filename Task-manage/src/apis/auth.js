import request from "./request";

const login = async (username,password) => {
    const { data } = await request.post('/login', {username,password})
    return data
}

export { login }
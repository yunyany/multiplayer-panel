import request from "./request";

const postRegister = async (username,password) => {
    const { data } = await request.post('/register', {username,password})
    return data
}

export { postRegister }
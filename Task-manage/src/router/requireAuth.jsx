import { Outlet, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

const RequireAuth = ()=>{
    // 钩子触发的是引用比较,所以不能写{token: i.user.token},but直接获取i.user对象可以
    const token = useSelector(i => i.user.token)

    if(!token){
        return <Navigate to={'/login'} replace/>
    }

    return <Outlet/>
}

export default RequireAuth;
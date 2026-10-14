import { createBrowserRouter } from 'react-router-dom'
import Login from '../pages/login/Login'
import Register from '../pages/register/Register'
import RequireAuth from './requireAuth'
import Home from '../pages/home/Home'
import Projects from '../pages/project/Projects'

const router = createBrowserRouter([
    {
        path: '/login',
        element: <Login />
    },
    {
        path: '/register',
        element: <Register />
    },
    {
        element: <RequireAuth />,
        children: [{
            path: '/',
            element: <Home />,
            children: [
                { index:true, element: <Projects /> }
            ]
        }]
    }
])

export default router 
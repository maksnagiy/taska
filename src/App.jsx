import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import LoginPage    from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import TasksPage    from './pages/TasksPage.jsx'
import TaskPage     from './pages/TaskPage.jsx'
import TaskFormPage from './pages/TaskFormPage.jsx'
import { Toaster } from 'react-hot-toast'
import NotificationsListener from './components/NotificationsListener.jsx' 
import { supabase } from './store.js'

// Only what's in scope:
// Auth (36), Tasks CRUD (16-18,20), Subtasks (3),
// Priority/Status/Due/Desc/CreatedAt/ID (6-12 minus Author),
// Recurring (14), Dependencies (15),
// Filter + Search (23,26), LLM x4 (38-41)

function AuthGate({ requireAuth }) {
  const location = useLocation()
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    let active = true

    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data?.user ?? null)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (user === undefined) {
    return null
  }

  if (requireAuth && !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (!requireAuth && user) {
    return <Navigate to="/tasks" replace />
  }

  return <Outlet />
}

export default function App() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <>
      <Toaster
        position={isMobile ? 'bottom-right' : 'top-right'}
        gutter={8}
        containerStyle={{
          ...(isMobile ? { bottom: 56 } : { top: 56 }),
          right: 12,
          zIndex: 10010,
        }}
      />
      <NotificationsListener />
      <Routes>
        <Route path="/" element={<Navigate to="/tasks" replace />} />

        <Route element={<AuthGate requireAuth={false} />}>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route element={<AuthGate requireAuth />}>
          <Route path="/tasks"          element={<TasksPage />} />
          <Route path="/tasks/new"      element={<TaskFormPage />} />
          <Route path="/tasks/:id"      element={<TaskPage />} />
          <Route path="/tasks/:id/edit" element={<TaskFormPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>
    </>
  )
}

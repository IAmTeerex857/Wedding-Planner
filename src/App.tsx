import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AuthGate } from './components/AuthGate'
import { WorkspaceProvider } from './components/WorkspaceProvider'

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const BudgetPage = lazy(() => import('./pages/BudgetPage').then((module) => ({ default: module.BudgetPage })))
const CeremoniesPage = lazy(() => import('./pages/CeremoniesPage').then((module) => ({ default: module.CeremoniesPage })))
const GuestsPage = lazy(() => import('./pages/GuestsPage').then((module) => ({ default: module.GuestsPage })))
const AttirePage = lazy(() => import('./pages/AttirePage').then((module) => ({ default: module.AttirePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const ModulePage = lazy(() => import('./pages/ModulePage').then((module) => ({ default: module.ModulePage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })))
const TraditionalRequirementsPage = lazy(() => import('./pages/TraditionalRequirementsPage').then((module) => ({ default: module.TraditionalRequirementsPage })))
const SeatingPage = lazy(() => import('./pages/SeatingPage').then((module) => ({ default: module.SeatingPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const FilesPage = lazy(() => import('./pages/FilesPage').then((module) => ({ default: module.FilesPage })))
const RecycleBinPage = lazy(() => import('./pages/RecycleBinPage').then((module) => ({ default: module.RecycleBinPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))

const modules = [
  ['calendar', 'Calendar'],
  ['itineraries', 'Itineraries'],
  ['vendors', 'Vendors'],
  ['venues', 'Venues'],
  ['food-drinks', 'Food & drinks'],
  ['wedding-party', 'Wedding party'],
  ['packing', 'Packing'],
  ['gifts', 'Gifts'],
  ['honeymoon', 'Honeymoon'],
] as const

function App() {
  return (
    <Suspense fallback={<main className="route-loading"><span /></main>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGate><WorkspaceProvider><AppShell /></WorkspaceProvider></AuthGate>}>
          <Route index element={<Dashboard />} />
          <Route path="ceremonies" element={<CeremoniesPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="guests" element={<GuestsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="attire" element={<AttirePage />} />
          <Route path="traditional-requirements" element={<TraditionalRequirementsPage />} />
          <Route path="seating" element={<SeatingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="recycle-bin" element={<RecycleBinPage />} />
          <Route path="reports" element={<ReportsPage />} />
          {modules.map(([path, title]) => (
            <Route key={path} path={path} element={<ModulePage title={title} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App

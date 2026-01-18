import { BrowserRouter, Routes, Route } from "react-router-dom"
import DashboardPage from "./pages/DashboardPage"
import ServersPage from "./pages/ServersPage"
import ConsolePage from "./pages/ConsolePage"
import ServerDetailsPage from "./pages/ServerDetailsPage"
import BackupsPage from "./pages/BackupsPage"
import PlayersPage from "./pages/PlayersPage"
import SettingsPage from "./pages/SettingsPage"
import LoginPage from "./pages/LoginPage"
import { AuthProvider, RequireAuth } from "@/lib/auth"

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/servers"
            element={
              <RequireAuth>
                <ServersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/servers/:id"
            element={
              <RequireAuth>
                <ServerDetailsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/console"
            element={
              <RequireAuth>
                <ConsolePage />
              </RequireAuth>
            }
          />
          <Route
            path="/players"
            element={
              <RequireAuth>
                <PlayersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/backups"
            element={
              <RequireAuth>
                <BackupsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

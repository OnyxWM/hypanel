import { BrowserRouter, Routes, Route } from "react-router-dom"
import DashboardPage from "./pages/DashboardPage"
import ServersPage from "./pages/ServersPage"
import ConsolePage from "./pages/ConsolePage"
import ServerDetailsPage from "./pages/ServerDetailsPage"
import BackupsPage from "./pages/BackupsPage"
import PlayersPage from "./pages/PlayersPage"
import SettingsPage from "./pages/SettingsPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/:id" element={<ServerDetailsPage />} />
        <Route path="/console" element={<ConsolePage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/backups" element={<BackupsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}

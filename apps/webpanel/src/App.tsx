import { BrowserRouter, Routes, Route } from "react-router-dom"
import DashboardPage from "./pages/DashboardPage"
import ServersPage from "./pages/ServersPage"
import ConsolePage from "./pages/ConsolePage"
import ServerDetailsPage from "./pages/ServerDetailsPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/:id" element={<ServerDetailsPage />} />
        <Route path="/console" element={<ConsolePage />} />
      </Routes>
    </BrowserRouter>
  )
}

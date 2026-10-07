import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Studio from "./pages/Studio";
import BotSetup from "./pages/BotSetup";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/bot" element={<BotSetup />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

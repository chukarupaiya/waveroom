import { AnimatePresence } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Background from "./components/Background.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import Login from "./pages/Login.jsx";
import Lobby from "./pages/Lobby.jsx";
import Room from "./pages/Room.jsx";

function RequireName({ children }) {
  const name = localStorage.getItem("jamsync_name");
  return name ? children : <Navigate to="/" replace />;
}

export default function App() {
  const location = useLocation();
  return (
    <ToastProvider>
      <Background />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Login />} />
          <Route
            path="/lobby"
            element={
              <RequireName>
                <Lobby />
              </RequireName>
            }
          />
          <Route
            path="/room/:roomId"
            element={
              <RequireName>
                <Room />
              </RequireName>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </ToastProvider>
  );
}

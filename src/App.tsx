import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AppLayout } from './components/Layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import { ComingSoon } from './pages/ComingSoon';
import { SettingsPage } from './pages/SettingsPage';
import { IMPage } from './pages/IMPage';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:sessionId" element={<ChatPage />} />
            <Route path="im" element={<IMPage />} />
            <Route path="im/:conversationId" element={<IMPage />} />
            <Route path="tasks" element={<ComingSoon title="待办" />} />
            <Route path="calendar" element={<ComingSoon title="日程" />} />
            <Route path="literature" element={<ComingSoon title="文献" />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;

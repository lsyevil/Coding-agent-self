import { Layout, Avatar, Dropdown, Typography, theme } from 'antd';
import { Outlet, useNavigate } from 'react-router-dom';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { SideNav } from './SideNav';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

export function AppLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { token } = theme.useToken();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Sider
        theme="light"
        width={200}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            fontWeight: 600,
            fontSize: 16,
            color: token.colorPrimary,
          }}
        >
          办公助手平台
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SideNav />
        </div>
        <div
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            padding: 12,
          }}
        >
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: handleLogout,
                },
              ],
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />}>
                {user?.displayName?.[0] || 'U'}
              </Avatar>
              <Text ellipsis style={{ maxWidth: 110 }}>
                {user?.displayName || user?.username || '未登录'}
              </Text>
            </div>
          </Dropdown>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Content style={{ overflow: 'hidden', background: token.colorBgLayout }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

export default AppLayout;

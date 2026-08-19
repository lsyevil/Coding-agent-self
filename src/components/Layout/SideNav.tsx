import { Menu } from 'antd';
import {
  MessageOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  CalendarOutlined,
  ReadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';

const items = [
  { key: '/chat', icon: <MessageOutlined />, label: 'AI 对话' },
  { key: '/im', icon: <TeamOutlined />, label: 'IM 会话' },
  { key: '/tasks', icon: <UnorderedListOutlined />, label: '待办' },
  { key: '/calendar', icon: <CalendarOutlined />, label: '日程' },
  { key: '/literature', icon: <ReadOutlined />, label: '文献' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

export function SideNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const selected = '/' + (location.pathname.split('/')[1] || 'chat');

  return (
    <Menu
      mode="inline"
      selectedKeys={[selected]}
      items={items}
      style={{ borderRight: 0, height: '100%' }}
      onClick={({ key }) => navigate(key)}
    />
  );
}

export default SideNav;

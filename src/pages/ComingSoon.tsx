import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export function ComingSoon({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        icon={<span style={{ fontSize: 48 }}>🚧</span>}
        title={title}
        subTitle="该模块将在后续 Phase 实现（实时聊天 / 看板 / 日历 / 文献库）。"
        extra={
          <Button type="primary" onClick={() => navigate('/chat')}>
            返回 AI 对话
          </Button>
        }
      />
    </div>
  );
}

export default ComingSoon;

import { useState } from 'react';
import { Input, Select, Button, Empty, Spin, Space } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { usePaperStore } from '../../stores/paperStore';
import { PaperCard } from './PaperCard';
import type { Paper } from '../../stores/paperStore';

interface Props {
  papers: Paper[];
  loading: boolean;
  onAdd: () => void;
}

export function PaperList({ papers, loading, onAdd }: Props) {
  const selectPaper = usePaperStore((s) => s.selectPaper);
  const currentPaperId = usePaperStore((s) => s.currentPaperId);
  const fetchPapers = usePaperStore((s) => s.fetchPapers);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const handleSearch = () => {
    fetchPapers({ status: statusFilter, search: search || undefined });
  };

  const handleStatusChange = (val: string | undefined) => {
    setStatusFilter(val);
    fetchPapers({ status: val, search: search || undefined });
  };

  return (
    <div style={{ width: 360, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Input
            placeholder="搜索文献..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ flex: 1 }}
              value={statusFilter}
              onChange={handleStatusChange}
              options={[
                { label: '未读', value: 'unread' },
                { label: '阅读中', value: 'reading' },
                { label: '已读完', value: 'finished' },
              ]}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              添加
            </Button>
          </div>
        </Space>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : papers.length === 0 ? (
          <Empty description="暂无文献" />
        ) : (
          papers.map((paper) => (
            <PaperCard
              key={paper.id}
              paper={paper}
              selected={paper.id === currentPaperId}
              onClick={() => selectPaper(paper.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

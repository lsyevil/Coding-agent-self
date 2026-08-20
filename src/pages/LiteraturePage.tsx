import { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { usePaperStore } from '../stores/paperStore';
import { PaperList } from '../components/Literature/PaperList';
import { PaperDetailDrawer } from '../components/Literature/PaperDetailDrawer';
import { AddPaperModal } from '../components/Literature/AddPaperModal';

const { Title } = Typography;

export function LiteraturePage() {
  const { papers, loading, fetchPapers } = usePaperStore();
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 24px 0' }}>
        <Title level={4} style={{ margin: 0 }}>文献管理</Title>
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PaperList papers={papers} loading={loading} onAdd={() => setAddOpen(true)} />
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }} />
      </div>
      <PaperDetailDrawer />
      <AddPaperModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

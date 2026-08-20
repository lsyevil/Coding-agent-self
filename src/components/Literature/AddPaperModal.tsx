import { useState, useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Select, message } from 'antd';
import { usePaperStore } from '../../stores/paperStore';
import { apiFetch } from '../../api/http';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface SearchResult {
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  doi: string | null;
  year: number | null;
  venue: string | null;
  source: string;
}

export function AddPaperModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mode, setMode] = useState<'manual' | 'search'>('manual');
  const createPaper = usePaperStore((s) => s.createPaper);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setResults([]);
      setMode('manual');
    }
  }, [open, form]);

  const handleSearch = async () => {
    const query = form.getFieldValue('searchQuery');
    if (!query?.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch('/api/papers/search', {
        method: 'POST',
        body: JSON.stringify({ query, maxResults: 5 }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {}
    setSearching(false);
  };

  const handleSelectResult = (r: SearchResult) => {
    form.setFieldsValue({
      title: r.title,
      authors: r.authors.join(', '),
      year: r.year,
      url: r.url,
      abstract: r.abstract,
      doi: r.doi,
    });
    setResults([]);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const authors = typeof values.authors === 'string'
        ? values.authors.split(',').map((s: string) => s.trim()).filter(Boolean)
        : values.authors || [];
      await createPaper({
        title: values.title,
        authors,
        year: values.year || null,
        url: values.url || null,
        abstract: values.abstract || null,
        doi: values.doi || null,
        tags: values.tags || [],
        source: 'manual',
      });
      message.success('文献已添加');
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('添加失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加文献"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="添加"
      cancelText="取消"
      confirmLoading={loading}
      width={640}
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        <Select
          value={mode}
          onChange={(v) => { setMode(v); setResults([]); }}
          style={{ width: 160 }}
          options={[
            { label: '手动录入', value: 'manual' },
            { label: '搜索 arXiv', value: 'search' },
          ]}
        />
      </div>

      {mode === 'search' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="输入关键词搜索 arXiv..."
              onChange={(e) => form.setFieldValue('searchQuery', e.target.value)}
              onPressEnter={handleSearch}
            />
            <button onClick={handleSearch} disabled={searching} style={{ padding: '4px 16px' }}>
              {searching ? '搜索中...' : '搜索'}
            </button>
          </div>
          {results.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 6 }}>
              {results.map((r, i) => (
                <div
                  key={i}
                  onClick={() => handleSelectResult(r)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                >
                  <div style={{ fontWeight: 500 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{r.authors.slice(0, 3).join(', ')} ({r.year || '?'})</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Form form={form} layout="vertical">
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="authors" label="作者（逗号分隔）">
          <Input placeholder="例如：Zhang San, Li Si" />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item name="year" label="年份">
            <InputNumber style={{ width: '100%' }} min={1900} max={2030} />
          </Form.Item>
          <Form.Item name="doi" label="DOI / arXiv ID">
            <Input />
          </Form.Item>
        </div>
        <Form.Item name="url" label="链接">
          <Input />
        </Form.Item>
        <Form.Item name="abstract" label="摘要">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" placeholder="输入后回车添加" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

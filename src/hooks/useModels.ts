import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

export interface ModelInfo {
  modelId: string;
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string;
  error?: string;
}

/**
 * 获取后端可用模型列表。
 * 返回 { models, defaultModel, loading }。
 */
export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch('/api/models')
      .then((res) => res.json())
      .then((data: ModelsResponse) => {
        if (!mounted) return;
        setModels(data.models || []);
        setDefaultModel(data.defaultModel || '');
      })
      .catch((e) => {
        console.error('Failed to fetch models:', e);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return { models, defaultModel, loading };
}
